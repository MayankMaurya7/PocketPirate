-- "Simplify debts": a per-group switch for how open debts are presented.
--
-- Off (the default, and how every group behaved until now): debts are
-- direct between two people — the pairwise ledger of split expenses and
-- recorded payments between them — so each number traces back to specific
-- expenses. On: the app forgets who owed whom and re-pairs members from
-- their net positions per currency (creditors and debtors laid end to end
-- and matched by overlap — the same deterministic sweep migration 008
-- fixed for multi-payer expenses), which produces fewer payments to make.
-- Net positions per member are identical in both modes; only the arrows
-- between people change.
--
-- The leave/remove guard (migration 007) has to follow the switch. It
-- judges "unsettled" per counterparty, which is right when debts are
-- direct but wrong once they are simplified: a member who owes A ₹100 and
-- is owed ₹100 by B is settled in the simplified view (net zero, so they
-- appear in no debt) yet the pairwise check would still block them, and
-- the app would say "settled up" while the database refused the leave.
-- So private.has_unsettled_balance now reads the group's flag: pairwise
-- when off, net position per currency when on. The ledger CTE is the one
-- from migration 008, unchanged.
--
-- Who may flip it: the existing groups UPDATE policy (owners only). It is
-- a column on groups precisely so that no new grant or policy is needed,
-- and so the setting is one fact the guard and every client agree on.


-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------

alter table public.groups
  add column simplify_debts boolean not null default false;

comment on column public.groups.simplify_debts is
  'When true, open debts are shown re-paired from net positions (fewer payments) instead of directly between the two people involved. The leave guard judges on net position accordingly.';


-- ---------------------------------------------------------------------------
-- 2. Leave/remove guard: judge the way the group shows its debts
-- ---------------------------------------------------------------------------
--
-- Same signature, grants and caller as before. `mine` is _user_id's
-- pairwise net with each counterparty per currency; the direct view is
-- open if any of those is non-zero, the simplified view if their sum per
-- currency (the member's net position) is.

create or replace function private.has_unsettled_balance(_group_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  with split_expenses as (
    select e.id, e.user_id, e.currency, e.amount_minor_units
    from public.expenses e
    where e.group_id = _group_id
      and exists (
        select 1
        from public.expense_splits s
        where s.expense_id = e.id
      )
  ),
  -- +what each person paid, −what each person owes, per expense.
  movements as (
    select se.id as expense_id, se.currency, p.user_id, p.amount_minor_units as amount
    from split_expenses se
    join public.expense_payers p on p.expense_id = se.id
    union all
    select se.id, se.currency, se.user_id, se.amount_minor_units
    from split_expenses se
    where not exists (
      select 1
      from public.expense_payers p
      where p.expense_id = se.id
    )
    union all
    select se.id, se.currency, s.user_id, -s.amount_minor_units
    from split_expenses se
    join public.expense_splits s on s.expense_id = se.id
  ),
  net as (
    select expense_id, currency, user_id, sum(amount) as net
    from movements
    group by expense_id, currency, user_id
    having sum(amount) <> 0
  ),
  -- Each side laid end to end along [0, D): [lo, hi) per person.
  creditors as (
    select expense_id, currency, user_id,
           sum(net) over w - net as lo,
           sum(net) over w       as hi
    from net
    where net > 0
    window w as (
      partition by expense_id
      order by net desc, user_id
      rows between unbounded preceding and current row
    )
  ),
  debtors as (
    select expense_id, currency, user_id,
           sum(-net) over w + net as lo,
           sum(-net) over w       as hi
    from net
    where net < 0
    window w as (
      partition by expense_id
      order by net asc, user_id
      rows between unbounded preceding and current row
    )
  ),
  ledger as (
    -- debtor owes creditor the overlap of their intervals
    select c.user_id                             as creditor,
           d.user_id                             as debtor,
           c.currency                            as currency,
           least(c.hi, d.hi) - greatest(c.lo, d.lo) as amount
    from creditors c
    join debtors d
      on d.expense_id = c.expense_id
     and least(c.hi, d.hi) > greatest(c.lo, d.lo)
    union all
    select st.from_user_id,
           st.to_user_id,
           st.currency,
           st.amount_minor_units
    from public.settlements st
    where st.group_id = _group_id
  ),
  -- _user_id's position with each counterparty: positive = they owe _user_id.
  mine as (
    select case when l.debtor = _user_id then l.creditor else l.debtor end as counterparty,
           l.currency,
           sum(case when l.debtor = _user_id then -l.amount else l.amount end) as net
    from ledger l
    where l.debtor = _user_id or l.creditor = _user_id
    group by 1, 2
  )
  select case
    when coalesce(
      (select g.simplify_debts from public.groups g where g.id = _group_id),
      false
    )
    then exists (
      select 1
      from mine
      group by currency
      having sum(net) <> 0
    )
    else exists (
      select 1
      from mine
      where net <> 0
    )
  end;
$$;

comment on function private.has_unsettled_balance(uuid, uuid) is
  'True if _user_id has an open balance in _group_id in any currency: with any single member when the group shows direct debts, on net position when it simplifies them. Multi-payer expenses use the net-then-overlap attribution.';

-- CREATE OR REPLACE keeps owner and ACL, but state it anyway.
alter function private.has_unsettled_balance(uuid, uuid) owner to postgres;

revoke execute on function private.has_unsettled_balance(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _column record;
begin
  select is_nullable, column_default
  into   _column
  from   information_schema.columns
  where  table_schema = 'public'
    and  table_name   = 'groups'
    and  column_name  = 'simplify_debts';

  if not found then
    raise exception 'groups.simplify_debts is missing';
  end if;

  if _column.is_nullable <> 'NO' or _column.column_default <> 'false' then
    raise exception 'groups.simplify_debts must be NOT NULL DEFAULT false';
  end if;

  -- Owners flip the flag through the existing table-wide UPDATE grant +
  -- owner-only policy; nothing column-level should have narrowed it.
  if not has_column_privilege('authenticated', 'public.groups', 'simplify_debts', 'update') then
    raise exception 'authenticated cannot update groups.simplify_debts';
  end if;

  if has_column_privilege('anon', 'public.groups', 'simplify_debts', 'select') then
    raise exception 'anon must not read groups.simplify_debts';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname = 'has_unsettled_balance'
      and p.prosecdef
      and pg_get_functiondef(p.oid) like '%simplify_debts%'
  ) then
    raise exception 'private.has_unsettled_balance missing, not SECURITY DEFINER, or does not read simplify_debts';
  end if;

  if has_function_privilege('authenticated', 'private.has_unsettled_balance(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'private.has_unsettled_balance(uuid, uuid)', 'execute')
  then
    raise exception 'has_unsettled_balance must not be executable by API roles';
  end if;
end;
$$;
