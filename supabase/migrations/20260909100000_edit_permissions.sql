-- Who may edit and delete a group's transactions.
--
-- Until now only the creator of an expense (and only a party to a payment)
-- could change or delete it. Groups are shared ledgers, and the people in
-- them fix each other's typos, so by default every current member may now
-- edit or delete any expense or recorded payment in the group. Each group
-- has one switch, `edit_policy`, that its owners control:
--
--   everyone  (default, and applied to every existing group) — any current
--             member may edit or delete any expense or payment.
--   parties   — only the people the transaction is about: for an expense
--             its creator or its primary payer (`user_id`), for a payment
--             either party. This is the old behaviour, slightly widened to
--             include the primary payer.
--
-- Secondary payers (`expense_payers` rows) are deliberately not parties:
-- the client's save deletes the payer rows before it updates the expense,
-- so a permission that depends on those rows would vanish half-way through
-- a save. Parties are judged on columns of the expense row alone.
--
-- Three rules hold in both modes:
--
--   * `created_by` never changes. "Added by Alice" stays true after Bob's
--     edit. A BEFORE UPDATE trigger refuses the change.
--   * A category can only be changed to one of the editor's own (or
--     cleared). Categories are private per user, so when Bob edits Alice's
--     expense he cannot see her category; leaving `category_id` as it is
--     keeps hers, and the client shows it as read-only. The check moves from
--     the UPDATE policy's WITH CHECK (which cannot tell "unchanged" from
--     "set to someone else's") to the same trigger.
--   * Anything that involves a former member is frozen: an expense whose
--     primary payer, any payer row or any participant has left, or a
--     payment with a party who has left, can no longer be edited or
--     deleted by anyone. The leave guard (migration 007) only lets someone
--     go once their balance is zero; editing or deleting what they were
--     part of would silently reopen it with no one left to settle. (Before
--     this migration a party could still delete a payment after the other
--     party had left; that gap is closed here.)
--
-- Personal expenses are untouched: still private to their owner, who is
-- always both `user_id` and `created_by`.
--
-- Simplify debts: `groups.simplify_debts` (migration 009) was flipped
-- through the owner-only groups UPDATE policy. It should be any member's
-- call, but a table grant cannot say "members may write this one column
-- while everything else stays owner-only", so the toggle moves behind a
-- SECURITY DEFINER RPC, `set_simplify_debts`, with a membership check. The
-- groups UPDATE policy itself stays owner-only, which is how owners set
-- `edit_policy` (and rename the group).


-- ---------------------------------------------------------------------------
-- 1. The switch
-- ---------------------------------------------------------------------------

create type public.group_edit_policy as enum ('everyone', 'parties');

alter table public.groups
  add column edit_policy public.group_edit_policy not null default 'everyone';

comment on column public.groups.edit_policy is
  'Who may edit or delete the group''s expenses and payments: every current member, or only the parties to each transaction (an expense''s creator or primary payer; a payment''s payer or payee). Owners change it.';


-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
--
-- Both SECURITY DEFINER so they read group_members, groups, expenses and
-- the payer/split rows without going through RLS (and without recursion:
-- the expenses policies call can_edit_expense, which reads expenses).
-- Policy expressions run with the caller's privileges (migration 002), so
-- `authenticated` needs EXECUTE. `private` is not API-exposed, so this
-- adds no RPC surface.

create or replace function private.edits_open_to_all(_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    (
      select g.edit_policy = 'everyone'::public.group_edit_policy
      from public.groups g
      where g.id = _group_id
    ),
    false
  );
$$;

comment on function private.edits_open_to_all(uuid) is
  'True if the group lets every member edit and delete its transactions (edit_policy = everyone). False for a missing group.';

-- The whole "may _user_id edit or delete this group expense" rule in one
-- place, used by the expenses, expense_splits and expense_payers policies:
-- current member; edits open to all or a party (creator or primary payer);
-- and nobody involved has left. Always false for a personal expense — the
-- policies handle those with the plain owner check.
create or replace function private.can_edit_expense(_expense_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.expenses e
    join public.groups g on g.id = e.group_id
    where e.id = _expense_id
      and _user_id is not null
      -- the editor is a current member
      and exists (
        select 1 from public.group_members gm
        where gm.group_id = e.group_id and gm.user_id = _user_id
      )
      -- and edits are open to all, or they are a party
      and (
        g.edit_policy = 'everyone'::public.group_edit_policy
        or e.created_by = _user_id
        or e.user_id = _user_id
      )
      -- and nobody involved has left: the primary payer …
      and exists (
        select 1 from public.group_members gm
        where gm.group_id = e.group_id and gm.user_id = e.user_id
      )
      -- … every payer row …
      and not exists (
        select 1 from public.expense_payers p
        where p.expense_id = e.id
          and not exists (
            select 1 from public.group_members gm
            where gm.group_id = e.group_id and gm.user_id = p.user_id
          )
      )
      -- … and every participant.
      and not exists (
        select 1 from public.expense_splits s
        where s.expense_id = e.id
          and not exists (
            select 1 from public.group_members gm
            where gm.group_id = e.group_id and gm.user_id = s.user_id
          )
      )
  );
$$;

comment on function private.can_edit_expense(uuid, uuid) is
  'True if _user_id may edit or delete group expense _expense_id: current member, edits open to all or a party (creator / primary payer), and no former member among its payer, payers or participants. False for personal expenses.';

alter function private.edits_open_to_all(uuid) owner to postgres;
alter function private.can_edit_expense(uuid, uuid) owner to postgres;

revoke execute on function private.edits_open_to_all(uuid) from public, anon;
revoke execute on function private.can_edit_expense(uuid, uuid) from public, anon;
grant execute on function private.edits_open_to_all(uuid) to authenticated;
grant execute on function private.can_edit_expense(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. expenses: policies + guard trigger
-- ---------------------------------------------------------------------------

drop policy "expenses_update_creator" on public.expenses;
drop policy "expenses_delete_creator" on public.expenses;

-- Allows: editing a personal expense you own, or a group expense the helper
-- lets you edit. WITH CHECK keeps the insert guard's shape for the row's
-- new state (a personal expense is yours; a group expense's group and
-- payer are member and group). created_by and category_id are guarded by
-- the trigger below, which can compare old and new; the membership of
-- created_by is no longer required (it cannot change, and a creator who
-- has left should not freeze an expense they were not otherwise part of).
create policy "expenses_update_editor"
  on public.expenses for update to authenticated
  using (
    case
      when group_id is null then created_by = (select auth.uid())
      else private.can_edit_expense(id, (select auth.uid()))
    end
  )
  with check (
    case
      when group_id is null then
        user_id = (select auth.uid())
        and created_by = (select auth.uid())
      else
        private.is_group_member(group_id, (select auth.uid()))
        and private.is_group_member(group_id, user_id)
    end
  );

-- Allows: deleting a personal expense you own, or a group expense the
-- helper lets you edit.
create policy "expenses_delete_editor"
  on public.expenses for delete to authenticated
  using (
    case
      when group_id is null then created_by = (select auth.uid())
      else private.can_edit_expense(id, (select auth.uid()))
    end
  );

-- Guards that need both the old and the new row, which a policy cannot see
-- together. SECURITY DEFINER (owned by postgres) like the leave guard, so
-- the category lookup does not depend on the caller's RLS view.
create or replace function public.guard_expense_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _caller uuid := (select auth.uid());
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'Who added an expense cannot be changed.';
  end if;

  -- No JWT means no API caller (a migration, or the dashboard as postgres);
  -- anon has no UPDATE grant, so this exemption never reaches a client.
  if _caller is not null
     and new.category_id is distinct from old.category_id
     and new.category_id is not null
     and not exists (
       select 1 from public.categories c
       where c.id = new.category_id and c.user_id = _caller
     )
  then
    raise exception 'You can only file an expense under one of your own categories.';
  end if;

  return new;
end;
$$;

comment on function public.guard_expense_update() is
  'BEFORE UPDATE on expenses: created_by is immutable; category_id may only change to null or to a category owned by the caller.';

alter function public.guard_expense_update() owner to postgres;
revoke execute on function public.guard_expense_update() from public, anon, authenticated;

create trigger expenses_guard_update
  before update on public.expenses
  for each row execute function public.guard_expense_update();


-- ---------------------------------------------------------------------------
-- 4. expense_splits and expense_payers: the same editor rule
-- ---------------------------------------------------------------------------

drop policy "expense_splits_insert_creator_member_participant" on public.expense_splits;
drop policy "expense_splits_delete_creator" on public.expense_splits;

-- Allows: an editor of the expense to add participants, who must be members
-- of its group. The helper is false for personal expenses, so they still
-- cannot be split.
create policy "expense_splits_insert_editor_member_participant"
  on public.expense_splits for insert to authenticated
  with check (
    private.can_edit_expense(expense_id, (select auth.uid()))
    and exists (
      select 1
      from public.expenses e
      where e.id = expense_splits.expense_id
        and private.is_group_member(e.group_id, expense_splits.user_id)
    )
  );

-- Allows: an editor of the expense to remove splits (used to re-split).
create policy "expense_splits_delete_editor"
  on public.expense_splits for delete to authenticated
  using (private.can_edit_expense(expense_id, (select auth.uid())));

drop policy "expense_payers_insert_creator_member_payer" on public.expense_payers;
drop policy "expense_payers_delete_creator" on public.expense_payers;

-- Allows: an editor of the expense to record payers, who must be members of
-- its group.
create policy "expense_payers_insert_editor_member_payer"
  on public.expense_payers for insert to authenticated
  with check (
    private.can_edit_expense(expense_id, (select auth.uid()))
    and exists (
      select 1
      from public.expenses e
      where e.id = expense_payers.expense_id
        and private.is_group_member(e.group_id, expense_payers.user_id)
    )
  );

-- Allows: an editor of the expense to remove payer rows (used to re-record).
create policy "expense_payers_delete_editor"
  on public.expense_payers for delete to authenticated
  using (private.can_edit_expense(expense_id, (select auth.uid())));


-- ---------------------------------------------------------------------------
-- 5. settlements
-- ---------------------------------------------------------------------------

drop policy "settlements_update_party_members" on public.settlements;
drop policy "settlements_delete_party_member" on public.settlements;

-- Allows: a current member — any member when edits are open to all, else a
-- party — to change the amount, date or note while both parties are still
-- members. USING and WITH CHECK are the same test: the columns a client may
-- write (migration 010's column-level grant) cannot change the parties or
-- the group.
create policy "settlements_update_editor_members"
  on public.settlements for update to authenticated
  using (
    private.is_group_member(group_id, (select auth.uid()))
    and (
      private.edits_open_to_all(group_id)
      or from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, from_user_id)
    and private.is_group_member(group_id, to_user_id)
  )
  with check (
    private.is_group_member(group_id, (select auth.uid()))
    and (
      private.edits_open_to_all(group_id)
      or from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, from_user_id)
    and private.is_group_member(group_id, to_user_id)
  );

-- Allows: the same people to delete the record, under the same freeze —
-- a payment with a party who has left stays.
create policy "settlements_delete_editor_members"
  on public.settlements for delete to authenticated
  using (
    private.is_group_member(group_id, (select auth.uid()))
    and (
      private.edits_open_to_all(group_id)
      or from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, from_user_id)
    and private.is_group_member(group_id, to_user_id)
  );


-- ---------------------------------------------------------------------------
-- 6. set_simplify_debts: any member flips the switch
-- ---------------------------------------------------------------------------

create or replace function public.set_simplify_debts(_group_id uuid, _enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _caller uuid := (select auth.uid());
begin
  if _caller is null then
    raise exception 'You must be signed in.';
  end if;

  if not private.is_group_member(_group_id, _caller) then
    raise exception 'Only members of the group can change this.';
  end if;

  update public.groups
  set simplify_debts = _enabled
  where id = _group_id;
end;
$$;

comment on function public.set_simplify_debts(uuid, boolean) is
  'Member-only: sets the group''s simplify_debts flag. Exists because the groups UPDATE policy is owner-only and a grant cannot open a single column to members.';

alter function public.set_simplify_debts(uuid, boolean) owner to postgres;

revoke execute on function public.set_simplify_debts(uuid, boolean) from public, anon;
grant execute on function public.set_simplify_debts(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _fn      text;
  _count   int;
  _default text;
begin
  -- Enum + column
  select array_to_string(array_agg(e.enumlabel order by e.enumsortorder), ',')
  into _default
  from pg_type t join pg_enum e on e.enumtypid = t.oid
  where t.typname = 'group_edit_policy';
  if _default is distinct from 'everyone,parties' then
    raise exception 'group_edit_policy labels wrong: %', _default;
  end if;

  select column_default into _default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'groups' and column_name = 'edit_policy';
  if _default is null or _default not like '''everyone''%' then
    raise exception 'groups.edit_policy default is %, expected everyone', _default;
  end if;

  if exists (select 1 from public.groups where edit_policy <> 'everyone') then
    raise exception 'existing groups should all be on everyone';
  end if;

  -- Owners set edit_policy through the table-wide UPDATE grant; anon nothing.
  if not has_column_privilege('authenticated', 'public.groups', 'edit_policy', 'update') then
    raise exception 'authenticated cannot update groups.edit_policy';
  end if;
  if has_column_privilege('anon', 'public.groups', 'edit_policy', 'select') then
    raise exception 'anon must not read groups.edit_policy';
  end if;

  -- Policies: exactly the expected set on each table.
  foreach _fn in array array[
    'expenses:expenses_update_editor',
    'expenses:expenses_delete_editor',
    'expense_splits:expense_splits_insert_editor_member_participant',
    'expense_splits:expense_splits_delete_editor',
    'expense_payers:expense_payers_insert_editor_member_payer',
    'expense_payers:expense_payers_delete_editor',
    'settlements:settlements_update_editor_members',
    'settlements:settlements_delete_editor_members'
  ] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = split_part(_fn, ':', 1)
        and policyname = split_part(_fn, ':', 2)
    ) then
      raise exception 'missing policy %', _fn;
    end if;
  end loop;

  foreach _fn in array array[
    'expenses_update_creator', 'expenses_delete_creator',
    'expense_splits_insert_creator_member_participant', 'expense_splits_delete_creator',
    'expense_payers_insert_creator_member_payer', 'expense_payers_delete_creator',
    'settlements_update_party_members', 'settlements_delete_party_member'
  ] loop
    if exists (select 1 from pg_policies where schemaname = 'public' and policyname = _fn) then
      raise exception 'old policy % still exists', _fn;
    end if;
  end loop;

  foreach _fn in array array['expenses:4', 'expense_splits:3', 'expense_payers:3', 'settlements:4'] loop
    select count(*) into _count
    from pg_policies
    where schemaname = 'public' and tablename = split_part(_fn, ':', 1);
    if _count <> split_part(_fn, ':', 2)::int then
      raise exception 'expected % policies on %, found %',
        split_part(_fn, ':', 2), split_part(_fn, ':', 1), _count;
    end if;
  end loop;

  -- Helpers: SECURITY DEFINER, callable by authenticated (policies run as
  -- the caller), never by anon.
  foreach _fn in array array[
    'private.edits_open_to_all(uuid)',
    'private.can_edit_expense(uuid, uuid)',
    'public.set_simplify_debts(uuid, boolean)'
  ] loop
    if not has_function_privilege('authenticated', _fn, 'execute') then
      raise exception 'authenticated lacks EXECUTE on %', _fn;
    end if;
    if has_function_privilege('anon', _fn, 'execute') then
      raise exception 'anon must not have EXECUTE on %', _fn;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = _fn::regprocedure) then
      raise exception '% must be SECURITY DEFINER', _fn;
    end if;
  end loop;

  -- Trigger: exactly BEFORE UPDATE, per row, on expenses.
  select count(*) into _count
  from information_schema.triggers
  where event_object_schema = 'public'
    and event_object_table = 'expenses'
    and trigger_name = 'expenses_guard_update'
    and action_timing = 'BEFORE'
    and event_manipulation = 'UPDATE'
    and action_orientation = 'ROW';
  if _count <> 1 then
    raise exception 'expenses_guard_update trigger missing or wrong shape';
  end if;

  if (select p.proowner::regrole::text from pg_proc p where p.oid = 'public.guard_expense_update()'::regprocedure) <> 'postgres' then
    raise exception 'guard_expense_update must be owned by postgres';
  end if;
end;
$$;
