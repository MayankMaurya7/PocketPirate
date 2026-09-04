-- Settlements: recording a payment between two members of a group.
--
-- Split expenses leave members owing each other. A settlement records that
-- one member (from_user_id) paid another (to_user_id) some amount outside
-- the app; no money moves here. In the group's balances the payer is
-- credited and the payee debited, exactly like a group expense paid by
-- from_user_id and split 100% to to_user_id — but kept as its own table so
-- payments never show up as spending (lists, stats, categories) and can
-- carry their own write rules.
--
-- Who may write: either party — the one who paid or the one who was paid —
-- and only while they are a member of the group. The recorder is stored in
-- created_by. Both parties must be current members when the payment is
-- recorded. Deleting is open to either party (a wrong entry can be removed
-- by whoever notices); there is no UPDATE — delete and re-record.


-- ---------------------------------------------------------------------------
-- 1. Table + index
-- ---------------------------------------------------------------------------

create table public.settlements (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups (id) on delete cascade,
  -- Who handed over the money.
  from_user_id       uuid not null references public.profiles (id) on delete cascade,
  -- Who received it.
  to_user_id         uuid not null references public.profiles (id) on delete cascade,
  -- Who recorded it: from_user_id or to_user_id (enforced by RLS).
  created_by         uuid not null references public.profiles (id) on delete cascade,
  -- Integer minor units, like expenses.amount_minor_units. Never a float.
  amount_minor_units bigint not null check (amount_minor_units > 0),
  -- ISO 4217, snapshotted from the debt being settled.
  currency           char(3) not null,
  settled_on         date not null default current_date,
  note               text,
  created_at         timestamptz not null default now(),
  constraint settlements_distinct_parties check (from_user_id <> to_user_id)
);

comment on table public.settlements is
  'A payment made between two group members outside the app. Credits the payer, debits the payee.';

comment on column public.settlements.amount_minor_units is
  'Integer minor units (paise/cents). Never floating point.';

-- The group page lists a group's payments newest first.
create index settlements_group_id_settled_on_idx
  on public.settlements (group_id, settled_on desc);


-- ---------------------------------------------------------------------------
-- 2. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.settlements enable row level security;

-- Default privileges grant ALL on new public tables to anon and
-- authenticated. Start from nothing so the grant below is the whole truth.
revoke all on public.settlements from public, anon, authenticated;

-- No UPDATE: a payment is deleted and re-recorded if it was wrong.
grant select, insert, delete on public.settlements to authenticated;

-- Allows: any current member of the group to see its payments.
create policy "settlements_select_member"
  on public.settlements for select to authenticated
  using (private.is_group_member(group_id, (select auth.uid())));

-- Allows: a member to record a payment they made or received. Both parties
-- must be current members. Nobody records a payment between two others.
create policy "settlements_insert_party_member"
  on public.settlements for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, from_user_id)
    and private.is_group_member(group_id, to_user_id)
  );

-- Allows: either party to delete the record while still in the group.
create policy "settlements_delete_party_member"
  on public.settlements for delete to authenticated
  using (
    (
      from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, (select auth.uid()))
  );


-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _policies integer;
  _acl      record;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'settlements'
      and c.relrowsecurity
  ) then
    raise exception 'settlements missing or RLS not enabled';
  end if;

  select count(*)
  into   _policies
  from   pg_policies
  where  schemaname = 'public'
    and  tablename  = 'settlements';

  if _policies <> 3 then
    raise exception 'expected 3 policies on settlements, found %', _policies;
  end if;

  if not has_table_privilege('authenticated', 'public.settlements', 'select')
     or not has_table_privilege('authenticated', 'public.settlements', 'insert')
     or not has_table_privilege('authenticated', 'public.settlements', 'delete')
  then
    raise exception 'authenticated lacks select/insert/delete on settlements';
  end if;

  if has_table_privilege('authenticated', 'public.settlements', 'update')
     or has_table_privilege('authenticated', 'public.settlements', 'truncate')
     or has_table_privilege('authenticated', 'public.settlements', 'references')
     or has_table_privilege('authenticated', 'public.settlements', 'trigger')
  then
    raise exception 'authenticated has more than select/insert/delete on settlements';
  end if;

  if has_table_privilege('anon', 'public.settlements', 'select') then
    raise exception 'anon must not have select on settlements';
  end if;

  -- No leftover PUBLIC grant hiding behind the role checks above.
  for _acl in
    select a.grantee
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relname = 'settlements'
      and a.grantee = 0
  loop
    raise exception 'settlements still has a PUBLIC grant';
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'settlements_distinct_parties'
  ) then
    raise exception 'settlements_distinct_parties check is missing';
  end if;
end;
$$;
