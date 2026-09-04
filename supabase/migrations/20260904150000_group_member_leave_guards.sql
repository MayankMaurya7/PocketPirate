-- Guards on removing a group member (leaving, or being removed by an owner).
--
-- Two ways a membership row can disappear that leave the group in a bad
-- state, both previously allowed:
--
-- 1. The only owner leaves. groups_update/delete are owner-only, so the
--    group becomes permanently unadministrable.
-- 2. A member with money still owed to or by them leaves. The group's
--    balances are a pairwise ledger over its members; once a party is gone
--    their debts linger as "a former member", the visible balances stop
--    summing to zero, and nobody can settle them (settlements need both
--    parties to be members).
--
-- Both are checked in one BEFORE DELETE row trigger. It raises a plain
-- user-facing message (shown verbatim by the client, like the RPC in
-- migration 003). Cascaded deletes (the whole group is being deleted, or a
-- profile is) are let through: by the time the cascade reaches
-- group_members the parent row is already gone in this transaction, which
-- is how the trigger tells them apart from a direct delete.
--
-- "Unsettled" is judged per counterparty and per currency, not on the
-- member's net position, because that is what the app shows: debts are
-- direct between two people (no simplification), so owing A ₹100 while
-- being owed ₹100 by B still shows two open debts and must block.


-- ---------------------------------------------------------------------------
-- 1. Helper: does this member have any open debt with anyone in the group?
-- ---------------------------------------------------------------------------
--
-- Mirrors apps/web/src/lib/balances.ts (groupLedger): every split
-- participant owes the payer their share; a recorded payment credits the
-- payer, i.e. the payee now owes them that much more (or the payer owes
-- that much less). Expenses of every status count, as in the client.

create or replace function private.has_unsettled_balance(_group_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  with ledger as (
    select e.user_id            as creditor,
           s.user_id            as debtor,
           e.currency           as currency,
           s.amount_minor_units as amount
    from public.expenses e
    join public.expense_splits s on s.expense_id = e.id
    where e.group_id = _group_id
      and s.user_id <> e.user_id
    union all
    select st.from_user_id,
           st.to_user_id,
           st.currency,
           st.amount_minor_units
    from public.settlements st
    where st.group_id = _group_id
  )
  select exists (
    select 1
    from ledger l
    where l.debtor = _user_id or l.creditor = _user_id
    group by
      case when l.debtor = _user_id then l.creditor else l.debtor end,
      l.currency
    having sum(case when l.debtor = _user_id then -l.amount else l.amount end) <> 0
  );
$$;

comment on function private.has_unsettled_balance(uuid, uuid) is
  'True if _user_id owes or is owed a non-zero amount by any single member of _group_id in any currency.';

alter function private.has_unsettled_balance(uuid, uuid) owner to postgres;

-- Reached only from the SECURITY DEFINER trigger function below.
revoke execute on function private.has_unsettled_balance(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Trigger
-- ---------------------------------------------------------------------------

create or replace function public.guard_group_member_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A cascade from groups or profiles: the parent row is already deleted
  -- in this transaction. Nothing to protect — the group (or the account)
  -- is going away.
  if not exists (select 1 from public.groups g where g.id = old.group_id)
     or not exists (select 1 from public.profiles p where p.id = old.user_id)
  then
    return old;
  end if;

  if old.role = 'owner'::public.group_role
     and not exists (
       select 1
       from public.group_members gm
       where gm.group_id = old.group_id
         and gm.user_id <> old.user_id
         and gm.role = 'owner'::public.group_role
     )
  then
    raise exception 'The only owner cannot leave the group. Delete the group instead.';
  end if;

  if private.has_unsettled_balance(old.group_id, old.user_id) then
    if old.user_id = auth.uid() then
      raise exception 'Settle up before leaving: you still owe or are owed money in this group.';
    else
      raise exception 'This member still owes or is owed money in this group. They need to settle up before they can be removed.';
    end if;
  end if;

  return old;
end;
$$;

comment on function public.guard_group_member_delete() is
  'Blocks a direct group_members delete that would strand the group (last owner) or leave open debts. Cascades pass.';

alter function public.guard_group_member_delete() owner to postgres;

create trigger group_members_guard_delete
  before delete on public.group_members
  for each row execute function public.guard_group_member_delete();


-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _trigger record;
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'has_unsettled_balance'
      and p.prosecdef
  ) then
    raise exception 'private.has_unsettled_balance missing or not SECURITY DEFINER';
  end if;

  if has_function_privilege('authenticated', 'private.has_unsettled_balance(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'private.has_unsettled_balance(uuid, uuid)', 'execute')
  then
    raise exception 'has_unsettled_balance must not be executable by API roles';
  end if;

  select t.tgenabled, t.tgtype
  into   _trigger
  from   pg_trigger t
  join   pg_class c on c.oid = t.tgrelid
  join   pg_namespace n on n.oid = c.relnamespace
  where  n.nspname = 'public'
    and  c.relname = 'group_members'
    and  t.tgname  = 'group_members_guard_delete';

  if not found then
    raise exception 'group_members_guard_delete trigger is missing';
  end if;

  -- tgtype bits: 1 = row, 2 = before, 8 = delete. Exactly BEFORE DELETE ROW.
  if _trigger.tgtype <> (1 | 2 | 8) then
    raise exception 'group_members_guard_delete must be BEFORE DELETE FOR EACH ROW (tgtype %)', _trigger.tgtype;
  end if;

  if (select rolname from pg_roles where oid = (
        select proowner from pg_proc where proname = 'guard_group_member_delete'
      )) <> 'postgres'
  then
    raise exception 'guard_group_member_delete must be owned by postgres';
  end if;
end;
$$;
