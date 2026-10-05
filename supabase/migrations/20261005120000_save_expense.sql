-- Atomic expense save with edit-conflict detection.
--
-- The client saved an expense as up to five requests (delete splits, delete
-- payers, update the row, insert payers, insert splits), each its own
-- transaction. Two members editing the same expense seconds apart therefore
-- ended one of two ways: the second save silently overwrote every field
-- from its stale form, or — when the first had changed the amount — it died
-- half-way with a raw sum-check error and the expense left un-split. And a
-- request failing in the middle left the row in a state the form had to
-- special-case on retry.
--
-- `save_expense` does the whole save in one transaction and refuses it when
-- the row has changed since the form was opened:
--
--   * SECURITY INVOKER. Every RLS policy, `guard_expense_update`, the
--     activity triggers and the deferred sum triggers apply exactly as they
--     do to the client's direct writes; the function adds no authority. It
--     is only the five statements, in order, behind one commit.
--   * The caller passes the `updated_at` it loaded. The row is locked
--     (`select … for update` — RLS applies the UPDATE policy's USING to it,
--     so a non-editor finds no row) and compared; a mismatch raises
--     SQLSTATE **PT409** ("Arihant changed this expense while you were
--     editing.", the last editor read from `group_activity`). A row that is
--     gone raises PT409 too; a row the caller may no longer edit raises
--     **PT403**. PostgREST turns a `PTnnn` SQLSTATE into that HTTP status
--     and always hands the code to the client as `error.code`, which is
--     what the form keys on. Null `_expected_updated_at` means create.
--   * `updated_at` always moves. The UPDATE statement runs even when only
--     the split or payer rows changed, so `expenses_set_updated_at` bumps
--     it and a concurrent editor's stale form is caught either way (before,
--     a split-only edit left the row's timestamp untouched).
--   * The deferred constraint triggers (migrations 004 and 008) fire at the
--     commit PostgREST issues after the function returns, so a bad sum
--     fails the whole save and nothing persists.
--
-- The activity trail (migration 013) is unchanged: its merge rule folds the
-- entries the five statements write into one 'edited' line whether they
-- come in five transactions or one (`now()` is the transaction's start,
-- `created_at` uses `clock_timestamp()`, and the two-minute window holds
-- trivially). An unchanged re-save logs nothing (delete then insert of the
-- same rows cancel out), but still bumps `updated_at`.
--
-- Payments get the same guard the cheap way: `settlements.updated_at` plus
-- the existing `set_updated_at` trigger. The client's edit adds
-- `.eq("updated_at", …)` to its UPDATE and treats zero rows as a conflict;
-- the column is readable through the table-wide SELECT grant and not in
-- migration 010's column-level UPDATE grant, so only the trigger writes it.


-- ---------------------------------------------------------------------------
-- 1. settlements.updated_at
-- ---------------------------------------------------------------------------

alter table public.settlements
  add column updated_at timestamptz not null default now();

-- Existing rows: "last changed" = "recorded" (nothing has edited them that
-- the trail would not show). The activity trigger sees no logged field
-- change and writes nothing.
update public.settlements set updated_at = created_at;

comment on column public.settlements.updated_at is
  'Bumped by trigger on every update. The client sends the value it loaded with its edit and treats zero rows as an edit conflict.';

create trigger settlements_set_updated_at
  before update on public.settlements
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 2. Group moves with rows present
-- ---------------------------------------------------------------------------
--
-- Migrations 004 and 008 refused a group change while split or payer rows
-- existed at commit ("Remove the split before moving…"), because the rows
-- had been validated against the old group and the client committed the
-- group change before writing new rows. In one transaction the rows the
-- save inserts *after* the update are there at commit, so that rule would
-- refuse every atomic move into a group that is split or has several
-- payers. The rule becomes the invariant it stood for: on a group change,
-- every row's user must be a member of the group the expense now belongs
-- to. The RPC's rows already pass (the insert policies check membership
-- against the updated row's group); a direct UPDATE of group_id with rows
-- present is now allowed exactly when it leaves no outsider behind. Rows on
-- a personal expense are still refused by the sum asserts.

create or replace function public.check_expense_matches_splits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.group_id is distinct from new.group_id
     and new.group_id is not null
     and exists (
       select 1
       from public.expense_splits s
       where s.expense_id = new.id
         and not private.is_group_member(new.group_id, s.user_id)
     )
  then
    raise exception
      'Everyone who shares this expense must be a member of the group it moves to.';
  end if;

  perform private.assert_expense_splits(new.id);

  return null;
end;
$$;

comment on function public.check_expense_matches_splits() is
  'Deferred: keeps a split expense''s amount and group consistent with its splits; a group change needs every participant in the new group.';

create or replace function public.check_expense_matches_payers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.group_id is distinct from new.group_id
     and new.group_id is not null
     and exists (
       select 1
       from public.expense_payers p
       where p.expense_id = new.id
         and not private.is_group_member(new.group_id, p.user_id)
     )
  then
    raise exception
      'Everyone who paid this expense must be a member of the group it moves to.';
  end if;

  perform private.assert_expense_payers(new.id);

  return null;
end;
$$;

comment on function public.check_expense_matches_payers() is
  'Deferred: keeps a multi-payer expense''s amount, group and user_id consistent with its payer rows; a group change needs every payer in the new group.';


-- ---------------------------------------------------------------------------
-- 3. save_expense
-- ---------------------------------------------------------------------------
--
-- _expense  {id?, user_id, group_id, category_id, amount_minor_units,
--            currency, expense_date, description} — every key but `id`
--            is required (null where nullable). On create a missing `id`
--            is minted here; the client mints its own today and may keep
--            doing so.
-- _payers   [{user_id, amount_minor_units}] — empty = `user_id` paid it all.
-- _splits   [{user_id, amount_minor_units}] — empty = not split.
-- _expected_updated_at  null = create; else the `updated_at` the form
--            loaded, which must still match.
--
-- Returns the saved row as the caller may see it.

create or replace function public.save_expense(
  _expense             jsonb,
  _payers              jsonb default '[]'::jsonb,
  _splits              jsonb default '[]'::jsonb,
  _expected_updated_at timestamptz default null
)
returns public.expenses
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _caller  uuid := (select auth.uid());
  _id      uuid;
  _current timestamptz;
  _actor   uuid;
  _name    text;
  _count   integer;
  _row     public.expenses%rowtype;
begin
  if _caller is null then
    raise exception 'You must be signed in.' using errcode = 'PT401';
  end if;

  if jsonb_typeof(_expense) is distinct from 'object' then
    raise exception 'save_expense: _expense must be a JSON object'
      using errcode = 'invalid_parameter_value';
  end if;
  _payers := coalesce(_payers, '[]'::jsonb);
  _splits := coalesce(_splits, '[]'::jsonb);
  if jsonb_typeof(_payers) <> 'array' or jsonb_typeof(_splits) <> 'array' then
    raise exception 'save_expense: _payers and _splits must be JSON arrays'
      using errcode = 'invalid_parameter_value';
  end if;

  if _expected_updated_at is null then
    -- Create. created_by is the caller; the INSERT policy checks the rest.
    _id := coalesce((_expense ->> 'id')::uuid, gen_random_uuid());

    insert into public.expenses
      (id, user_id, created_by, group_id, category_id, amount_minor_units,
       currency, expense_date, description)
    values
      (_id,
       (_expense ->> 'user_id')::uuid,
       _caller,
       (_expense ->> 'group_id')::uuid,
       (_expense ->> 'category_id')::uuid,
       (_expense ->> 'amount_minor_units')::bigint,
       _expense ->> 'currency',
       (_expense ->> 'expense_date')::date,
       _expense ->> 'description');
  else
    -- Edit. Lock the row first: concurrent saves queue here, and the one
    -- that waited re-reads the committed row, so its stale version is
    -- caught below. RLS applies the UPDATE policy to FOR UPDATE, so a row
    -- the caller may not edit is simply not found.
    _id := (_expense ->> 'id')::uuid;
    if _id is null then
      raise exception 'save_expense: _expense.id is required to edit'
        using errcode = 'invalid_parameter_value';
    end if;

    select e.updated_at into _current
    from public.expenses e
    where e.id = _id
    for update;

    if not found then
      if exists (select 1 from public.expenses e where e.id = _id) then
        raise exception 'You can no longer edit this expense.'
          using errcode = 'PT403';
      end if;
      raise exception 'This expense was deleted while you were editing.'
        using errcode = 'PT409';
    end if;

    if _current is distinct from _expected_updated_at then
      -- Name the last editor if the trail knows them and the caller may
      -- see their profile (co-members can). Personal expenses have no
      -- trail; the only other editor there is the caller elsewhere.
      select a.actor_id into _actor
      from public.group_activity a
      where a.entity_kind = 'expense'::public.activity_entity
        and a.entity_id = _id
      order by a.created_at desc
      limit 1;

      if _actor = _caller then
        raise exception 'You changed this expense elsewhere while you were editing.'
          using errcode = 'PT409';
      end if;

      select coalesce(nullif(btrim(p.display_name), ''), p.email) into _name
      from public.profiles p
      where p.id = _actor;

      if _name is null then
        raise exception 'This expense was changed while you were editing.'
          using errcode = 'PT409';
      end if;
      raise exception '% changed this expense while you were editing.', _name
        using errcode = 'PT409';
    end if;

    -- The five writes, in the order the client used: rows out, row, rows
    -- in. The deferred sum triggers judge the result at commit.
    delete from public.expense_splits s where s.expense_id = _id;
    delete from public.expense_payers p where p.expense_id = _id;

    update public.expenses e
    set user_id            = (_expense ->> 'user_id')::uuid,
        group_id           = (_expense ->> 'group_id')::uuid,
        category_id        = (_expense ->> 'category_id')::uuid,
        amount_minor_units = (_expense ->> 'amount_minor_units')::bigint,
        currency           = _expense ->> 'currency',
        expense_date       = (_expense ->> 'expense_date')::date,
        description        = _expense ->> 'description'
    where e.id = _id;

    get diagnostics _count = row_count;
    if _count <> 1 then
      -- Cannot happen after a successful FOR UPDATE, but never save half.
      raise exception 'You can no longer edit this expense.'
        using errcode = 'PT403';
    end if;
  end if;

  insert into public.expense_payers (expense_id, user_id, amount_minor_units)
  select _id, r.user_id, r.amount_minor_units
  from jsonb_to_recordset(_payers) as r(user_id uuid, amount_minor_units bigint);

  insert into public.expense_splits (expense_id, user_id, amount_minor_units)
  select _id, r.user_id, r.amount_minor_units
  from jsonb_to_recordset(_splits) as r(user_id uuid, amount_minor_units bigint);

  select e.* into strict _row
  from public.expenses e
  where e.id = _id;

  return _row;
end;
$$;

comment on function public.save_expense(jsonb, jsonb, jsonb, timestamptz) is
  'Saves an expense with its payer and split rows in one transaction, as the caller (RLS and triggers apply). Null _expected_updated_at creates; otherwise the row is locked and must still carry that updated_at, else PT409 (changed or deleted) / PT403 (no longer editable). Always bumps updated_at.';

alter function public.save_expense(jsonb, jsonb, jsonb, timestamptz) owner to postgres;

revoke execute on function public.save_expense(jsonb, jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.save_expense(jsonb, jsonb, jsonb, timestamptz) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _fn   text := 'public.save_expense(jsonb, jsonb, jsonb, timestamptz)';
  _priv text;
  _src  text;
begin
  -- The two deferred checks now test membership in the new group and no
  -- longer refuse a move outright; still SECURITY DEFINER, postgres-owned,
  -- behind their constraint triggers.
  foreach _priv in array array[
    'public.check_expense_matches_splits()',
    'public.check_expense_matches_payers()'
  ] loop
    select p.prosrc into _src from pg_proc p where p.oid = _priv::regprocedure;
    if _src not like '%private.is_group_member(new.group_id%' or _src like '%Remove the%' then
      raise exception '% still refuses group moves outright', _priv;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = _priv::regprocedure) then
      raise exception '% must be SECURITY DEFINER', _priv;
    end if;
    if (select p.proowner::regrole::text from pg_proc p where p.oid = _priv::regprocedure) <> 'postgres' then
      raise exception '% must be owned by postgres', _priv;
    end if;
  end loop;
  foreach _priv in array array['expenses_check_splits', 'expenses_check_payers'] loop
    if not exists (
      select 1 from pg_trigger t
      where t.tgname = _priv and t.tgrelid = 'public.expenses'::regclass
        and t.tgdeferrable and t.tginitdeferred
    ) then
      raise exception 'constraint trigger % missing or not deferred', _priv;
    end if;
  end loop;

  -- settlements.updated_at: present, not null, readable, not client-writable.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'settlements'
      and column_name = 'updated_at' and data_type = 'timestamp with time zone'
      and is_nullable = 'NO'
  ) then
    raise exception 'settlements.updated_at missing or wrong shape';
  end if;
  if exists (select 1 from public.settlements where updated_at <> created_at) then
    raise exception 'settlements.updated_at backfill did not match created_at';
  end if;
  if not has_column_privilege('authenticated', 'public.settlements', 'updated_at', 'select') then
    raise exception 'authenticated cannot read settlements.updated_at';
  end if;
  if has_column_privilege('authenticated', 'public.settlements', 'updated_at', 'update') then
    raise exception 'authenticated must not update settlements.updated_at directly';
  end if;
  foreach _priv in array array['select', 'update'] loop
    if has_column_privilege('anon', 'public.settlements', 'updated_at', _priv) then
      raise exception 'anon must not have % on settlements.updated_at', _priv;
    end if;
  end loop;
  if not exists (
    select 1 from information_schema.triggers
    where event_object_schema = 'public'
      and event_object_table = 'settlements'
      and trigger_name = 'settlements_set_updated_at'
      and action_timing = 'BEFORE'
      and event_manipulation = 'UPDATE'
      and action_orientation = 'ROW'
  ) then
    raise exception 'settlements_set_updated_at trigger missing or wrong shape';
  end if;

  -- save_expense: SECURITY INVOKER, empty search_path, callable only by
  -- authenticated, owned by postgres.
  if (select p.prosecdef from pg_proc p where p.oid = _fn::regprocedure) then
    raise exception '% must be SECURITY INVOKER', _fn;
  end if;
  if not exists (
    select 1 from pg_proc p
    where p.oid = _fn::regprocedure
      and p.proconfig @> array['search_path=""']
  ) then
    raise exception '% must set search_path to empty', _fn;
  end if;
  if not has_function_privilege('authenticated', _fn, 'execute') then
    raise exception 'authenticated lacks EXECUTE on %', _fn;
  end if;
  if has_function_privilege('anon', _fn, 'execute') then
    raise exception 'anon must not have EXECUTE on %', _fn;
  end if;
  if exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = _fn::regprocedure and a.grantee = 0
  ) then
    raise exception '% still has a PUBLIC grant', _fn;
  end if;
  if (select p.proowner::regrole::text from pg_proc p where p.oid = _fn::regprocedure) <> 'postgres' then
    raise exception '% must be owned by postgres', _fn;
  end if;
  if (select p.prorettype from pg_proc p where p.oid = _fn::regprocedure) <> 'public.expenses'::regtype then
    raise exception '% must return public.expenses', _fn;
  end if;
end;
$$;
