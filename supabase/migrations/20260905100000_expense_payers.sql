-- Multiple payers for one group expense.
--
-- expenses.user_id names ONE payer. A dinner where two people put their
-- cards down had to be entered twice. This adds an optional per-payer
-- breakdown, modelled exactly like expense_splits:
--
--   - No payer rows: expenses.user_id paid the whole amount (every existing
--     row, and the common case going forward).
--   - Payer rows present: they say who paid how much. They must sum to
--     amount_minor_units, and expenses.user_id must be one of them — it
--     stays the expense's "primary" payer, so every place that reads a
--     single payer (lists, stats, the SELECT policy) keeps working.
--
-- Same write model as splits: one PostgREST statement per request, so the
-- invariant is checked by DEFERRABLE INITIALLY DEFERRED constraint
-- triggers and the "no rows" state is always valid. Client save order is
-- delete splits → delete payers → update expense → insert payers → insert
-- splits; every boundary leaves the row consistent.
--
-- Who may write: only the expense's creator (created_by), like splits.
-- Payers must be current members of the expense's group.
--
-- Balances: with several payers the ledger can no longer be "each
-- participant owes THE payer their share". The rule (also implemented by
-- the client; the two must agree to the unit) is:
--
--   1. Per split expense, each person's net = what they paid − their
--      share. Nets are integers and sum to zero; people at zero drop out.
--   2. Creditors (net > 0) are sorted by net desc, then user_id; debtors
--      (net < 0) by |net| desc, then user_id. Each side is laid end to end
--      along [0, D) where D is the total owed. A debtor owes each creditor
--      the length of the overlap of their two intervals.
--
-- This is exact integer arithmetic (no proportional rounding to reconcile
-- between SQL and TypeScript), deterministic, and for a single payer
-- reduces to the old rule: every other participant owes the payer exactly
-- their share. private.has_unsettled_balance (migration 007) is rewritten
-- on this rule below so the leave/remove guard keeps matching what the
-- app shows.


-- ---------------------------------------------------------------------------
-- 1. Table + index
-- ---------------------------------------------------------------------------

create table public.expense_payers (
  expense_id         uuid   not null references public.expenses (id) on delete cascade,
  user_id            uuid   not null references public.profiles (id) on delete cascade,
  -- Integer minor units, like expenses.amount_minor_units. Strictly positive:
  -- someone who paid nothing is not a payer.
  amount_minor_units bigint not null check (amount_minor_units > 0),
  primary key (expense_id, user_id)
);

comment on table public.expense_payers is
  'Per-payer breakdown of a group expense paid by several members. Absent = expenses.user_id paid it all. Payers sum to the expense amount and include expenses.user_id.';

comment on column public.expense_payers.amount_minor_units is
  'Integer minor units (paise/cents). Never floating point.';

-- "What has this person paid across the group?" — balances aggregate by
-- payer; the PK only serves expense_id lookups.
create index expense_payers_user_id_idx
  on public.expense_payers (user_id);


-- ---------------------------------------------------------------------------
-- 2. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.expense_payers enable row level security;

-- Default privileges would grant ALL to anon and authenticated. Start from
-- nothing so the grant below is the whole truth.
revoke all on public.expense_payers from public, anon, authenticated;

-- No UPDATE: the client replaces the whole payer set (delete + insert); a
-- row-at-a-time update can never keep the sum invariant on its own.
grant select, insert, delete on public.expense_payers to authenticated;

-- Allows: reading a payer row whenever you can read its expense. The
-- subquery runs under the expenses SELECT policy as the caller. No
-- recursion: the expenses policy does not reference expense_payers.
create policy "expense_payers_select_readable_expense"
  on public.expense_payers for select to authenticated
  using (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_payers.expense_id
    )
  );

-- Allows: the expense's creator to record payers, who must be members of
-- the expense's group. Personal expenses have exactly one payer, the user.
create policy "expense_payers_insert_creator_member_payer"
  on public.expense_payers for insert to authenticated
  with check (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_payers.expense_id
        and e.created_by = (select auth.uid())
        and e.group_id is not null
        and private.is_group_member(e.group_id, expense_payers.user_id)
    )
  );

-- Allows: the expense's creator to remove payer rows (used to re-record).
create policy "expense_payers_delete_creator"
  on public.expense_payers for delete to authenticated
  using (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_payers.expense_id
        and e.created_by = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- 3. Payer invariant (deferred constraint triggers)
-- ---------------------------------------------------------------------------

-- Checks one expense. SECURITY DEFINER so the reads are unconditional.
create or replace function private.assert_expense_payers(_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _amount   bigint;
  _group_id uuid;
  _payer    uuid;
  _count    integer;
  _sum      bigint;
begin
  select e.amount_minor_units, e.group_id, e.user_id
  into   _amount, _group_id, _payer
  from   public.expenses e
  where  e.id = _expense_id;

  -- The expense was deleted in this transaction; its payers cascaded away.
  if not found then
    return;
  end if;

  select count(*), coalesce(sum(p.amount_minor_units), 0)
  into   _count, _sum
  from   public.expense_payers p
  where  p.expense_id = _expense_id;

  if _count = 0 then
    return;
  end if;

  if _group_id is null then
    raise exception 'A personal expense cannot be paid by several people.';
  end if;

  if _sum <> _amount then
    raise exception 'Payer amounts must add up to the expense amount.';
  end if;

  if not exists (
    select 1
    from public.expense_payers p
    where p.expense_id = _expense_id
      and p.user_id = _payer
  ) then
    raise exception 'The member the expense is paid by must be one of the payers.';
  end if;
end;
$$;

comment on function private.assert_expense_payers(uuid) is
  'Raises unless the expense has no payer rows, or is a group expense whose payers sum to its amount and include its user_id.';

alter function private.assert_expense_payers(uuid) owner to postgres;

revoke execute on function private.assert_expense_payers(uuid)
  from public, anon, authenticated;

-- Fires on every payer row change. Deferred to commit so a multi-row
-- insert is judged as a whole.
create or replace function public.check_expense_payers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.assert_expense_payers(old.expense_id);
  else
    perform private.assert_expense_payers(new.expense_id);
    -- Defensive: no UPDATE grant exists, but if one is ever added, a row
    -- moved between expenses must leave both consistent.
    if tg_op = 'UPDATE' and old.expense_id <> new.expense_id then
      perform private.assert_expense_payers(old.expense_id);
    end if;
  end if;

  return null;
end;
$$;

comment on function public.check_expense_payers() is
  'Deferred: re-validates the payer sum for the affected expense(s).';

alter function public.check_expense_payers() owner to postgres;

create constraint trigger expense_payers_check_sum
  after insert or update or delete on public.expense_payers
  deferrable initially deferred
  for each row execute function public.check_expense_payers();

-- Fires when an expense's amount, group or primary payer changes. An
-- expense with payer rows cannot change group (its payers were validated
-- against the old group) — the client deletes the payers first. Amount and
-- user_id changes are allowed only if the payer rows still fit, which in
-- practice means "no payer rows" (delete, update, re-insert).
create or replace function public.check_expense_matches_payers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.group_id is distinct from new.group_id
     and exists (
       select 1
       from public.expense_payers p
       where p.expense_id = new.id
     )
  then
    raise exception
      'Remove the payers before moving this expense to another group or making it personal.';
  end if;

  perform private.assert_expense_payers(new.id);

  return null;
end;
$$;

comment on function public.check_expense_matches_payers() is
  'Deferred: keeps a multi-payer expense''s amount, group and user_id consistent with its payer rows.';

alter function public.check_expense_matches_payers() owner to postgres;

create constraint trigger expenses_check_payers
  after update of amount_minor_units, group_id, user_id on public.expenses
  deferrable initially deferred
  for each row execute function public.check_expense_matches_payers();


-- ---------------------------------------------------------------------------
-- 4. Leave/remove guard: same answer with several payers
-- ---------------------------------------------------------------------------
--
-- Same signature, grants and caller as migration 007; only the ledger CTE
-- changes, to the net-then-overlap rule described at the top. Un-split
-- expenses still do not enter the ledger (their payer or payers bear
-- them), settlements are unchanged, and expenses of every status count.

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
  'True if _user_id owes or is owed a non-zero amount by any single member of _group_id in any currency. Multi-payer expenses use the net-then-overlap attribution.';

-- CREATE OR REPLACE keeps owner and ACL, but state it anyway.
alter function private.has_unsettled_balance(uuid, uuid) owner to postgres;

revoke execute on function private.has_unsettled_balance(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _policies integer;
  _priv     text;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'expense_payers'
      and c.relrowsecurity
  ) then
    raise exception 'expense_payers missing or RLS not enabled';
  end if;

  select count(*)
  into   _policies
  from   pg_policies
  where  schemaname = 'public'
    and  tablename  = 'expense_payers';

  if _policies <> 3 then
    raise exception 'expected 3 policies on expense_payers, found %', _policies;
  end if;

  foreach _priv in array array['select', 'insert', 'delete'] loop
    if not has_table_privilege('authenticated', 'public.expense_payers', _priv) then
      raise exception 'authenticated lacks % on expense_payers', _priv;
    end if;
  end loop;

  foreach _priv in array array['update', 'truncate', 'references', 'trigger'] loop
    if has_table_privilege('authenticated', 'public.expense_payers', _priv) then
      raise exception 'authenticated must not have % on expense_payers', _priv;
    end if;
  end loop;

  foreach _priv in array array[
    'select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'
  ] loop
    if has_table_privilege('anon', 'public.expense_payers', _priv) then
      raise exception 'anon must not have % on expense_payers', _priv;
    end if;
  end loop;

  -- No leftover PUBLIC entry in the ACL.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relname = 'expense_payers'
      and a.grantee = 0
  ) then
    raise exception 'expense_payers still has a PUBLIC grant';
  end if;

  if has_function_privilege('authenticated', 'private.assert_expense_payers(uuid)', 'execute')
     or has_function_privilege('anon', 'private.assert_expense_payers(uuid)', 'execute')
  then
    raise exception 'assert_expense_payers must not be executable by API roles';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'expense_payers_check_sum'
      and tgdeferrable
      and tginitdeferred
  ) then
    raise exception 'expense_payers_check_sum is missing or not deferred';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'expenses_check_payers'
      and tgdeferrable
      and tginitdeferred
  ) then
    raise exception 'expenses_check_payers is missing or not deferred';
  end if;

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
end;
$$;
