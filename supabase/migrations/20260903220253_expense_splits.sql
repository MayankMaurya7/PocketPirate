-- Expense splitting: who owes what for a group expense.
--
-- A group expense is paid by one member (expenses.user_id) and may be split
-- between any subset of the group. Each split row is one participant's share
-- in integer minor units. An expense with no split rows is "not split": the
-- payer bears it alone and it does not enter the group's balances.
--
-- Invariant (enforced here, not in the client): for every expense, EITHER it
-- has no split rows, OR it is a group expense and the split rows sum exactly
-- to amount_minor_units. Clients write through PostgREST one statement per
-- request with no client-side transactions, so the invariant is checked by
-- DEFERRABLE INITIALLY DEFERRED constraint triggers: a batch insert of N
-- rows is validated once at commit rather than failing on the first row.
-- The "no rows" state is what makes the multi-request flow possible — the
-- client writes the expense, then the splits, and re-splits by deleting all
-- rows, updating the expense, then inserting the new set.
--
-- Who may write: only the expense's creator (created_by), mirroring the
-- expenses UPDATE/DELETE policies. Participants must be members of the
-- expense's group at the time the split is written. A member who later
-- leaves keeps their share (they still owe it); re-splitting drops them
-- because they can no longer be selected.


-- ---------------------------------------------------------------------------
-- 1. Table + index
-- ---------------------------------------------------------------------------

create table public.expense_splits (
  expense_id         uuid   not null references public.expenses (id) on delete cascade,
  user_id            uuid   not null references public.profiles (id) on delete cascade,
  -- Integer minor units, like expenses.amount_minor_units. Strictly positive:
  -- a participant with nothing to pay is not a participant.
  amount_minor_units bigint not null check (amount_minor_units > 0),
  primary key (expense_id, user_id)
);

comment on table public.expense_splits is
  'Per-participant shares of a group expense. Shares sum to the expense amount.';

comment on column public.expense_splits.amount_minor_units is
  'Integer minor units (paise/cents). Never floating point.';

-- "What does this person owe across the group?" — balances aggregate by
-- participant; the PK only serves expense_id lookups.
create index expense_splits_user_id_idx
  on public.expense_splits (user_id);


-- ---------------------------------------------------------------------------
-- 2. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.expense_splits enable row level security;

-- The project's default privileges (Supabase sets ALTER DEFAULT PRIVILEGES
-- for the postgres role) grant ALL on new public tables to anon and
-- authenticated. Start from nothing so the grant below is the whole truth.
revoke all on public.expense_splits from public, anon, authenticated;

-- No UPDATE: the client replaces the whole split set (delete + insert), and
-- a row-at-a-time update can never keep the sum invariant on its own.
grant select, insert, delete on public.expense_splits to authenticated;

-- Allows: reading a split whenever you can read its expense. The subquery
-- runs under the expenses SELECT policy as the caller, so it is exactly
-- "own expense or member of its group". No recursion: the expenses policy
-- does not reference expense_splits.
create policy "expense_splits_select_readable_expense"
  on public.expense_splits for select to authenticated
  using (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_splits.expense_id
    )
  );

-- Allows: the expense's creator to add participants, who must be members of
-- the expense's group. Personal expenses cannot be split. Columns are
-- table-qualified because expenses has its own user_id.
create policy "expense_splits_insert_creator_member_participant"
  on public.expense_splits for insert to authenticated
  with check (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_splits.expense_id
        and e.created_by = (select auth.uid())
        and e.group_id is not null
        and private.is_group_member(e.group_id, expense_splits.user_id)
    )
  );

-- Allows: the expense's creator to remove splits (used to re-split).
create policy "expense_splits_delete_creator"
  on public.expense_splits for delete to authenticated
  using (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_splits.expense_id
        and e.created_by = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- 3. Sum invariant (deferred constraint triggers)
-- ---------------------------------------------------------------------------

-- Checks one expense. SECURITY DEFINER so the reads are unconditional: the
-- check must see every split row regardless of what the writer can see.
create or replace function private.assert_expense_splits(_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _amount   bigint;
  _group_id uuid;
  _count    integer;
  _sum      bigint;
begin
  select e.amount_minor_units, e.group_id
  into   _amount, _group_id
  from   public.expenses e
  where  e.id = _expense_id;

  -- The expense was deleted in this transaction; its splits cascaded away.
  if not found then
    return;
  end if;

  select count(*), coalesce(sum(s.amount_minor_units), 0)
  into   _count, _sum
  from   public.expense_splits s
  where  s.expense_id = _expense_id;

  if _count = 0 then
    return;
  end if;

  if _group_id is null then
    raise exception 'A personal expense cannot be split.';
  end if;

  if _sum <> _amount then
    raise exception 'Split amounts must add up to the expense amount.';
  end if;
end;
$$;

comment on function private.assert_expense_splits(uuid) is
  'Raises unless the expense has no splits, or is a group expense whose splits sum to its amount.';

alter function private.assert_expense_splits(uuid) owner to postgres;

-- Reached only from the SECURITY DEFINER trigger functions below, so no role
-- needs EXECUTE. (private is not API-exposed either way.)
revoke execute on function private.assert_expense_splits(uuid)
  from public, anon, authenticated;

-- Fires on every split row change. Deferred to commit so a multi-row insert
-- is judged as a whole.
create or replace function public.check_expense_splits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.assert_expense_splits(old.expense_id);
  else
    perform private.assert_expense_splits(new.expense_id);
    -- Defensive: no UPDATE grant exists, but if one is ever added, a row
    -- moved between expenses must leave both consistent.
    if tg_op = 'UPDATE' and old.expense_id <> new.expense_id then
      perform private.assert_expense_splits(old.expense_id);
    end if;
  end if;

  return null;
end;
$$;

comment on function public.check_expense_splits() is
  'Deferred: re-validates the split sum for the affected expense(s).';

alter function public.check_expense_splits() owner to postgres;

create constraint trigger expense_splits_check_sum
  after insert or update or delete on public.expense_splits
  deferrable initially deferred
  for each row execute function public.check_expense_splits();

-- Fires when an expense's amount or group changes. A split expense cannot
-- change group (its participants were validated against the old group) —
-- the client deletes the splits first. An amount change is allowed only if
-- the splits still add up, which in practice means "no splits" (the client
-- deletes, updates, then re-inserts).
create or replace function public.check_expense_matches_splits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.group_id is distinct from new.group_id
     and exists (
       select 1
       from public.expense_splits s
       where s.expense_id = new.id
     )
  then
    raise exception
      'Remove the split before moving this expense to another group or making it personal.';
  end if;

  perform private.assert_expense_splits(new.id);

  return null;
end;
$$;

comment on function public.check_expense_matches_splits() is
  'Deferred: keeps a split expense''s amount and group consistent with its splits.';

alter function public.check_expense_matches_splits() owner to postgres;

create constraint trigger expenses_check_splits
  after update of amount_minor_units, group_id on public.expenses
  deferrable initially deferred
  for each row execute function public.check_expense_matches_splits();


-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _policies integer;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'expense_splits'
      and c.relrowsecurity
  ) then
    raise exception 'expense_splits missing or RLS not enabled';
  end if;

  select count(*)
  into   _policies
  from   pg_policies
  where  schemaname = 'public'
    and  tablename  = 'expense_splits';

  if _policies <> 3 then
    raise exception 'expected 3 policies on expense_splits, found %', _policies;
  end if;

  if not has_table_privilege('authenticated', 'public.expense_splits', 'select')
     or not has_table_privilege('authenticated', 'public.expense_splits', 'insert')
     or not has_table_privilege('authenticated', 'public.expense_splits', 'delete')
  then
    raise exception 'authenticated lacks select/insert/delete on expense_splits';
  end if;

  if has_table_privilege('authenticated', 'public.expense_splits', 'update') then
    raise exception 'authenticated must not have update on expense_splits';
  end if;

  if has_table_privilege('anon', 'public.expense_splits', 'select') then
    raise exception 'anon must not have select on expense_splits';
  end if;

  if has_function_privilege(
    'authenticated', 'private.assert_expense_splits(uuid)', 'execute'
  ) then
    raise exception 'authenticated must not have EXECUTE on assert_expense_splits';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'expense_splits_check_sum'
      and tgdeferrable
      and tginitdeferred
  ) then
    raise exception 'expense_splits_check_sum is missing or not deferred';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'expenses_check_splits'
      and tgdeferrable
      and tginitdeferred
  ) then
    raise exception 'expenses_check_splits is missing or not deferred';
  end if;
end;
$$;
