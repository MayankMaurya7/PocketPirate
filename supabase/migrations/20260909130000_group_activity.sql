-- Activity trail: who changed what in a group, and when.
--
-- Now that any member may edit or delete a group's expenses and payments
-- (migration 012), the group needs a record of it. `group_activity` is an
-- append-only log written by triggers on expenses, expense_splits,
-- expense_payers and settlements; members can read their group's entries
-- and nobody can write, edit or remove one through the API.
--
-- One entry per change, not per statement. The client saves an expense as
-- up to five requests (delete splits, delete payers, update, insert payers,
-- insert splits), each its own transaction, and a per-statement log would
-- show a single edit as five lines. So an 'edited' entry is **merged** into
-- the previous 'edited' entry for the same row when it is by the same actor
-- and less than two minutes old: each changed field keeps its original
-- `from` and takes the latest `to`, and a field that ends up back where it
-- started is dropped (an entry left with no changes is removed). The
-- split/payer rows written right after the row was 'created' by the same
-- actor fold into the creation instead of appearing as an edit (a field
-- change that soon is still its own edit). Two minutes is a heuristic
-- for "the same save"; a genuinely separate edit a minute later merges too,
-- which is harmless (one line, combined changes).
--
-- Only group rows are logged. Personal expenses have no audience — and an
-- expense moved between personal and a group is logged as 'deleted' in the
-- group it left and 'created' in the one it joined.
--
-- Shape of an entry:
--   entity_kind  expense | settlement
--   entity_id    the row's id — no FK, so the entry survives the row
--   action       created | edited | deleted
--   changes      {field: {from, to}} for 'edited', else {}
--                expense fields: amount, currency, date, description,
--                paid_by (user_id), category (ids; private per user, so
--                the client may only be able to say "changed"), split and
--                payers (the full row sets before and after)
--                settlement fields: amount, date, note
--   snapshot     the row after the change (before it, for 'deleted'), so a
--                deleted expense can still be named and priced
--   actor_id     auth.uid() at the time; null for a migration/dashboard
--                change, or once that profile is deleted


-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create type public.activity_entity as enum ('expense', 'settlement');
create type public.activity_action as enum ('created', 'edited', 'deleted');

create table public.group_activity (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  entity_kind public.activity_entity not null,
  entity_id   uuid not null,
  action      public.activity_action not null,
  changes     jsonb not null default '{}'::jsonb,
  snapshot    jsonb not null default '{}'::jsonb,
  -- clock_timestamp(), not now(): several entries can be written in one
  -- transaction (an RPC, a cascade) and "the latest entry" must be strict.
  created_at  timestamptz not null default clock_timestamp()
);

comment on table public.group_activity is
  'Append-only trail of changes to a group''s expenses and payments, written by triggers. Members read; nobody writes through the API.';

create index group_activity_group_created_idx
  on public.group_activity (group_id, created_at desc);

create index group_activity_entity_idx
  on public.group_activity (entity_kind, entity_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 2. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.group_activity enable row level security;

-- Default privileges grant ALL on new public tables to anon and
-- authenticated. Start from nothing: members may only read.
revoke all on public.group_activity from public, anon, authenticated;
grant select on public.group_activity to authenticated;

create policy "group_activity_select_member"
  on public.group_activity for select to authenticated
  using (private.is_group_member(group_id, (select auth.uid())));


-- ---------------------------------------------------------------------------
-- 3. Snapshots
-- ---------------------------------------------------------------------------

create or replace function private.expense_snapshot(e public.expenses)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'description', e.description,
    'amount_minor_units', e.amount_minor_units,
    'currency', e.currency,
    'expense_date', e.expense_date,
    'user_id', e.user_id,
    'created_by', e.created_by
  );
$$;

create or replace function private.settlement_snapshot(s public.settlements)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'amount_minor_units', s.amount_minor_units,
    'currency', s.currency,
    'settled_on', s.settled_on,
    'from_user_id', s.from_user_id,
    'to_user_id', s.to_user_id,
    'note', s.note,
    'created_by', s.created_by
  );
$$;


-- ---------------------------------------------------------------------------
-- 4. The writer
-- ---------------------------------------------------------------------------
--
-- Reached only from the trigger functions below (all SECURITY DEFINER,
-- owned by postgres); EXECUTE is revoked from the API roles.

create or replace function private.log_activity(
  _group_id  uuid,
  _kind      public.activity_entity,
  _entity_id uuid,
  _action    public.activity_action,
  _changes   jsonb,
  _snapshot  jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _actor    uuid := (select auth.uid());
  _existing public.group_activity%rowtype;
  _merged   jsonb;
  _key      text;
  _old      jsonb;
  _new      jsonb;
begin
  -- A cascade: the group is going away in this transaction. Nothing to
  -- record (and the FK would refuse the row).
  if not exists (select 1 from public.groups g where g.id = _group_id) then
    return;
  end if;

  -- Same for the actor's own profile (account deletion).
  if _actor is not null
     and not exists (select 1 from public.profiles p where p.id = _actor)
  then
    _actor := null;
  end if;

  if _action = 'edited'::public.activity_action then
    if _changes = '{}'::jsonb then
      return;
    end if;

    select * into _existing
    from public.group_activity a
    where a.entity_kind = _kind
      and a.entity_id = _entity_id
      and a.actor_id is not distinct from _actor
      and a.created_at > now() - interval '2 minutes'
    order by a.created_at desc
    limit 1;

    if found and _existing.action = 'created'::public.activity_action then
      -- The split/payer rows written straight after the creation are part
      -- of creating it — but only those: a field change (amount, date …)
      -- right after creating is a real edit and gets its own entry.
      if (
        select bool_and(key in ('split', 'payers') and value -> 'from' = '[]'::jsonb)
        from jsonb_each(_changes)
      ) then
        update public.group_activity
        set snapshot = _snapshot
        where id = _existing.id;
        return;
      end if;
    end if;

    if found and _existing.action = 'edited'::public.activity_action then
      _merged := _existing.changes;
      for _key, _new in select key, value from jsonb_each(_changes) loop
        _old := _merged -> _key;
        if _old is null then
          _merged := _merged || jsonb_build_object(_key, _new);
        elsif (_old -> 'from') = (_new -> 'to') then
          -- Back to where it started: not a change any more.
          _merged := _merged - _key;
        else
          _merged := _merged || jsonb_build_object(
            _key, jsonb_build_object('from', _old -> 'from', 'to', _new -> 'to')
          );
        end if;
      end loop;

      if _merged = '{}'::jsonb then
        delete from public.group_activity where id = _existing.id;
      else
        update public.group_activity
        set changes = _merged, snapshot = _snapshot
        where id = _existing.id;
      end if;
      return;
    end if;
  end if;

  insert into public.group_activity
    (group_id, actor_id, entity_kind, entity_id, action, changes, snapshot)
  values
    (_group_id, _actor, _kind, _entity_id, _action, _changes, _snapshot);
end;
$$;

comment on function private.log_activity(uuid, public.activity_entity, uuid, public.activity_action, jsonb, jsonb) is
  'Appends a group_activity entry; merges an edit into the same actor''s edit (or creation) of the same row from the last two minutes.';

alter function private.expense_snapshot(public.expenses) owner to postgres;
alter function private.settlement_snapshot(public.settlements) owner to postgres;
alter function private.log_activity(uuid, public.activity_entity, uuid, public.activity_action, jsonb, jsonb) owner to postgres;

revoke execute on function private.expense_snapshot(public.expenses) from public, anon, authenticated;
revoke execute on function private.settlement_snapshot(public.settlements) from public, anon, authenticated;
revoke execute on function private.log_activity(uuid, public.activity_entity, uuid, public.activity_action, jsonb, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Triggers: expenses
-- ---------------------------------------------------------------------------

create or replace function public.log_expense_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    if new.group_id is not null then
      perform private.log_activity(
        new.group_id, 'expense', new.id, 'created', '{}'::jsonb,
        private.expense_snapshot(new)
      );
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    if old.group_id is not null then
      perform private.log_activity(
        old.group_id, 'expense', old.id, 'deleted', '{}'::jsonb,
        private.expense_snapshot(old)
      );
    end if;
    return null;
  end if;

  -- UPDATE. Moving between groups (or to/from personal) reads as leaving
  -- one and joining the other.
  if old.group_id is distinct from new.group_id then
    if old.group_id is not null then
      perform private.log_activity(
        old.group_id, 'expense', old.id, 'deleted', '{}'::jsonb,
        private.expense_snapshot(old)
      );
    end if;
    if new.group_id is not null then
      perform private.log_activity(
        new.group_id, 'expense', new.id, 'created', '{}'::jsonb,
        private.expense_snapshot(new)
      );
    end if;
    return null;
  end if;

  if new.group_id is null then
    return null;
  end if;

  if old.amount_minor_units <> new.amount_minor_units then
    _changes := _changes || jsonb_build_object('amount',
      jsonb_build_object('from', old.amount_minor_units, 'to', new.amount_minor_units));
  end if;
  if old.currency <> new.currency then
    _changes := _changes || jsonb_build_object('currency',
      jsonb_build_object('from', old.currency, 'to', new.currency));
  end if;
  if old.expense_date <> new.expense_date then
    _changes := _changes || jsonb_build_object('date',
      jsonb_build_object('from', old.expense_date, 'to', new.expense_date));
  end if;
  if old.description is distinct from new.description then
    _changes := _changes || jsonb_build_object('description',
      jsonb_build_object('from', old.description, 'to', new.description));
  end if;
  if old.user_id <> new.user_id then
    _changes := _changes || jsonb_build_object('paid_by',
      jsonb_build_object('from', old.user_id, 'to', new.user_id));
  end if;
  if old.category_id is distinct from new.category_id then
    _changes := _changes || jsonb_build_object('category',
      jsonb_build_object('from', old.category_id, 'to', new.category_id));
  end if;

  perform private.log_activity(
    new.group_id, 'expense', new.id, 'edited', _changes,
    private.expense_snapshot(new)
  );
  return null;
end;
$$;

alter function public.log_expense_activity() owner to postgres;
revoke execute on function public.log_expense_activity() from public, anon, authenticated;

create trigger expenses_log_activity
  after insert or update or delete on public.expenses
  for each row execute function public.log_expense_activity();


-- ---------------------------------------------------------------------------
-- 6. Triggers: expense_splits and expense_payers (statement-level)
-- ---------------------------------------------------------------------------
--
-- The client replaces the whole row set, so the change is "these rows →
-- those rows", read from the statement's transition table and logged once
-- per expense. A delete then an insert merge into one from → to (see
-- log_activity). Rows removed by the expense's own deletion find no
-- expense row any more and are skipped — the 'deleted' entry covers them.
-- Both tables have the same columns, so one function per operation serves
-- both; the key is chosen from the table name.

create or replace function public.log_expense_rows_inserted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _key text := case tg_table_name when 'expense_splits' then 'split' else 'payers' end;
  r record;
begin
  for r in
    select n.expense_id, e.group_id,
           jsonb_agg(
             jsonb_build_object('user_id', n.user_id, 'amount_minor_units', n.amount_minor_units)
             order by n.user_id
           ) as rows
    from new_rows n
    join public.expenses e on e.id = n.expense_id
    where e.group_id is not null
    group by n.expense_id, e.group_id
  loop
    perform private.log_activity(
      r.group_id, 'expense', r.expense_id, 'edited',
      jsonb_build_object(_key, jsonb_build_object('from', '[]'::jsonb, 'to', r.rows)),
      (select private.expense_snapshot(e) from public.expenses e where e.id = r.expense_id)
    );
  end loop;
  return null;
end;
$$;

create or replace function public.log_expense_rows_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _key text := case tg_table_name when 'expense_splits' then 'split' else 'payers' end;
  r record;
begin
  for r in
    select o.expense_id, e.group_id,
           jsonb_agg(
             jsonb_build_object('user_id', o.user_id, 'amount_minor_units', o.amount_minor_units)
             order by o.user_id
           ) as rows
    from old_rows o
    join public.expenses e on e.id = o.expense_id
    where e.group_id is not null
    group by o.expense_id, e.group_id
  loop
    perform private.log_activity(
      r.group_id, 'expense', r.expense_id, 'edited',
      jsonb_build_object(_key, jsonb_build_object('from', r.rows, 'to', '[]'::jsonb)),
      (select private.expense_snapshot(e) from public.expenses e where e.id = r.expense_id)
    );
  end loop;
  return null;
end;
$$;

alter function public.log_expense_rows_inserted() owner to postgres;
alter function public.log_expense_rows_deleted() owner to postgres;
revoke execute on function public.log_expense_rows_inserted() from public, anon, authenticated;
revoke execute on function public.log_expense_rows_deleted() from public, anon, authenticated;

create trigger expense_splits_log_inserted
  after insert on public.expense_splits
  referencing new table as new_rows
  for each statement execute function public.log_expense_rows_inserted();

create trigger expense_splits_log_deleted
  after delete on public.expense_splits
  referencing old table as old_rows
  for each statement execute function public.log_expense_rows_deleted();

create trigger expense_payers_log_inserted
  after insert on public.expense_payers
  referencing new table as new_rows
  for each statement execute function public.log_expense_rows_inserted();

create trigger expense_payers_log_deleted
  after delete on public.expense_payers
  referencing old table as old_rows
  for each statement execute function public.log_expense_rows_deleted();


-- ---------------------------------------------------------------------------
-- 7. Triggers: settlements
-- ---------------------------------------------------------------------------

create or replace function public.log_settlement_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _changes jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.log_activity(
      new.group_id, 'settlement', new.id, 'created', '{}'::jsonb,
      private.settlement_snapshot(new)
    );
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform private.log_activity(
      old.group_id, 'settlement', old.id, 'deleted', '{}'::jsonb,
      private.settlement_snapshot(old)
    );
    return null;
  end if;

  if old.amount_minor_units <> new.amount_minor_units then
    _changes := _changes || jsonb_build_object('amount',
      jsonb_build_object('from', old.amount_minor_units, 'to', new.amount_minor_units));
  end if;
  if old.settled_on <> new.settled_on then
    _changes := _changes || jsonb_build_object('date',
      jsonb_build_object('from', old.settled_on, 'to', new.settled_on));
  end if;
  if old.note is distinct from new.note then
    _changes := _changes || jsonb_build_object('note',
      jsonb_build_object('from', old.note, 'to', new.note));
  end if;

  perform private.log_activity(
    new.group_id, 'settlement', new.id, 'edited', _changes,
    private.settlement_snapshot(new)
  );
  return null;
end;
$$;

alter function public.log_settlement_activity() owner to postgres;
revoke execute on function public.log_settlement_activity() from public, anon, authenticated;

create trigger settlements_log_activity
  after insert or update or delete on public.settlements
  for each row execute function public.log_settlement_activity();


-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _fn    text;
  _count int;
  _priv  text;
begin
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'group_activity' and rowsecurity
  ) then
    raise exception 'group_activity missing or RLS not enabled';
  end if;

  select count(*) into _count
  from pg_policies where schemaname = 'public' and tablename = 'group_activity';
  if _count <> 1 then
    raise exception 'expected 1 policy on group_activity, found %', _count;
  end if;

  if not has_table_privilege('authenticated', 'public.group_activity', 'select') then
    raise exception 'authenticated lacks select on group_activity';
  end if;
  foreach _priv in array array['insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('authenticated', 'public.group_activity', _priv) then
      raise exception 'authenticated must not have % on group_activity', _priv;
    end if;
  end loop;
  foreach _priv in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('anon', 'public.group_activity', _priv) then
      raise exception 'anon must not have % on group_activity', _priv;
    end if;
  end loop;
  if exists (
    select 1
    from pg_class c, aclexplode(c.relacl) a
    where c.oid = 'public.group_activity'::regclass and a.grantee = 0
  ) then
    raise exception 'group_activity still has a PUBLIC grant';
  end if;

  -- No function here is callable through the API.
  foreach _fn in array array[
    'private.log_activity(uuid, public.activity_entity, uuid, public.activity_action, jsonb, jsonb)',
    'private.expense_snapshot(public.expenses)',
    'private.settlement_snapshot(public.settlements)',
    'public.log_expense_activity()',
    'public.log_expense_rows_inserted()',
    'public.log_expense_rows_deleted()',
    'public.log_settlement_activity()'
  ] loop
    if has_function_privilege('authenticated', _fn, 'execute')
       or has_function_privilege('anon', _fn, 'execute') then
      raise exception 'API roles must not have EXECUTE on %', _fn;
    end if;
    if (select p.proowner::regrole::text from pg_proc p where p.oid = _fn::regprocedure) <> 'postgres' then
      raise exception '% must be owned by postgres', _fn;
    end if;
  end loop;

  foreach _fn in array array[
    'expenses:expenses_log_activity:ROW',
    'expense_splits:expense_splits_log_inserted:STATEMENT',
    'expense_splits:expense_splits_log_deleted:STATEMENT',
    'expense_payers:expense_payers_log_inserted:STATEMENT',
    'expense_payers:expense_payers_log_deleted:STATEMENT',
    'settlements:settlements_log_activity:ROW'
  ] loop
    if not exists (
      select 1 from information_schema.triggers
      where event_object_schema = 'public'
        and event_object_table = split_part(_fn, ':', 1)
        and trigger_name = split_part(_fn, ':', 2)
        and action_timing = 'AFTER'
        and action_orientation = split_part(_fn, ':', 3)
    ) then
      raise exception 'trigger % missing or wrong shape', _fn;
    end if;
  end loop;
end;
$$;
