-- Spendwise — initial schema (Phase 1)
--
-- Tables, RLS policies, indexes, triggers and per-user default categories for
-- manual expense logging, custom categories, shared groups and stats.
--
-- There is no custom API server: clients talk to Supabase directly, so RLS is
-- the security layer. Every table here holds user data and has RLS enabled.
--
-- NOTE: none of these tables use FORCE ROW LEVEL SECURITY. The private.*
-- helpers below are SECURITY DEFINER and rely on the table owner (postgres)
-- being exempt from RLS to break policy recursion. FORCE would remove that
-- exemption and reintroduce the infinite-recursion error.


-- ---------------------------------------------------------------------------
-- 1. Private schema (not exposed to the API)
-- ---------------------------------------------------------------------------

-- Holds SECURITY DEFINER helpers used inside RLS policies. It is deliberately
-- absent from `[api] schemas` in config.toml and no role gets USAGE: policy
-- expressions are evaluated as the table owner, so clients never need to call
-- these directly. Granting access would hand out a group-membership oracle.
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------

create type public.group_role as enum ('owner', 'member');

-- 'voice' is Phase 2 (LLM parsing); 'sms'/'email' are Phase 3 (mobile
-- auto-detection). Defined now so the column type never has to change.
create type public.expense_source as enum ('manual', 'voice', 'sms', 'email');

-- 'pending'/'rejected' back the Phase 2 approve/reject workflow and the
-- 30-day trash bin. Manual Phase 1 entries are always 'confirmed'.
create type public.expense_status as enum ('confirmed', 'pending', 'rejected');


-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

-- Extends auth.users with app-level profile data. Rows are created by the
-- handle_new_user() trigger, never by clients.
create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  display_name       text,
  avatar_url         text,
  -- ISO 4217. Snapshotted onto each expense at entry time, so changing this
  -- later never rewrites history.
  preferred_currency char(3) not null default 'USD',
  created_at         timestamptz not null default now()
);

comment on table public.profiles is
  'App-level profile for each auth.users row. Created automatically on signup.';

-- User-owned spending categories. Eight defaults are seeded per user on signup;
-- users may add their own.
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null,
  color      text not null,
  icon       text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  constraint categories_user_id_name_key unique (user_id, name)
);

comment on table public.categories is
  'Per-user expense categories. is_default marks the set seeded at signup.';

-- Shared expense groups, e.g. flatmates tracking household spending.
create table public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.groups is
  'Shared expense groups. The creator is added as owner by a trigger.';

create table public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

comment on table public.group_members is
  'Group membership. Composite PK (group_id, user_id) makes membership unique.';

create table public.expenses (
  id                 uuid primary key default gen_random_uuid(),
  -- Whose expense this is (who the spend is attributed to).
  user_id            uuid not null references public.profiles (id) on delete cascade,
  -- Who entered it. Differs from user_id when a group member logs an expense
  -- on behalf of another member.
  created_by         uuid not null references public.profiles (id) on delete cascade,
  -- NULL = personal expense.
  group_id           uuid references public.groups (id) on delete cascade,
  -- Categories may be deleted; expenses outlive them and fall back to
  -- "uncategorised" rather than disappearing.
  category_id        uuid references public.categories (id) on delete set null,
  -- Money is ALWAYS integer minor units (paise for INR, cents for USD).
  -- Never a float. Formatted to major units only at the display edge.
  amount_minor_units bigint not null check (amount_minor_units > 0),
  -- ISO 4217, snapshotted from the user's preferred currency at entry time.
  currency           char(3) not null,
  description        text,
  expense_date       date not null default current_date,
  source             public.expense_source not null default 'manual',
  status             public.expense_status not null default 'confirmed',
  -- Set when status becomes 'rejected'; the future 30-day trash cleanup job
  -- sweeps on this column.
  rejected_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.expenses is
  'Expense entries. Amounts are integer minor units; currency is snapshotted.';

comment on column public.expenses.amount_minor_units is
  'Integer minor units (paise/cents). Never floating point.';


-- ---------------------------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------------------------

-- Personal expense history, newest first.
create index expenses_user_id_expense_date_idx
  on public.expenses (user_id, expense_date desc);

-- Group expense history, newest first. Partial: most rows are personal.
create index expenses_group_id_expense_date_idx
  on public.expenses (group_id, expense_date desc)
  where group_id is not null;

-- Phase 2 approve/reject queue. Partial: pending rows are a tiny minority.
create index expenses_status_pending_idx
  on public.expenses (status)
  where status = 'pending';

-- "Which groups am I in?" — drives the RLS membership helpers, so it is on the
-- hot path of nearly every group-scoped query.
create index group_members_user_id_idx
  on public.group_members (user_id);


-- ---------------------------------------------------------------------------
-- 5. RLS helper functions (SECURITY DEFINER)
-- ---------------------------------------------------------------------------
--
-- A group_members policy that queries group_members raises
-- "42P17 infinite recursion detected in policy". These helpers run as their
-- owner (postgres), which owns the tables and is exempt from RLS, so the reads
-- inside fire no policy and the cycle terminates.
--
-- All are STABLE (they read tables, so not IMMUTABLE) and pin
-- `search_path = ''` with fully-qualified identifiers, so a caller cannot
-- shadow `group_members` via their own search_path and have postgres read it.

create or replace function private.is_group_member(_group_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = _group_id
      and gm.user_id  = _user_id
  );
$$;

comment on function private.is_group_member(uuid, uuid) is
  'True if _user_id belongs to _group_id. SECURITY DEFINER to break RLS recursion.';

-- Needed as a helper for the same reason as is_group_member: "the owner may
-- add/remove members" is a predicate over group_members evaluated *inside* a
-- group_members write policy, which is the same recursion on the write path.
create or replace function private.is_group_owner(_group_id uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = _group_id
      and gm.user_id  = _user_id
      and gm.role     = 'owner'::public.group_role
  );
$$;

comment on function private.is_group_owner(uuid, uuid) is
  'True if _user_id is an owner of _group_id. SECURITY DEFINER to break RLS recursion.';

-- Backs the profiles SELECT policy. Written as one helper rather than an
-- inline self-join so the two group_members scans happen once, RLS-free,
-- instead of firing the group_members policy twice per candidate profile row.
create or replace function private.shares_group_with(_other uuid, _user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members mine
    join public.group_members theirs on theirs.group_id = mine.group_id
    where mine.user_id   = _user_id
      and theirs.user_id = _other
  );
$$;

comment on function private.shares_group_with(uuid, uuid) is
  'True if the two users share at least one group. SECURITY DEFINER to break RLS recursion.';

-- These must be owned by postgres for the RLS exemption above to hold. Set
-- explicitly so the migration is correct even if applied by another role.
alter function private.is_group_member(uuid, uuid)   owner to postgres;
alter function private.is_group_owner(uuid, uuid)    owner to postgres;
alter function private.shares_group_with(uuid, uuid) owner to postgres;

-- PUBLIC gets EXECUTE on new functions by default; revoke it. Clients reach
-- these only indirectly, through policy evaluation.
revoke execute on all functions in schema private from public;
revoke execute on all functions in schema private from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. Enable RLS
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.categories    enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;
alter table public.expenses      enable row level security;


-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
--
-- Table privileges are the first gate; RLS only filters what a grant already
-- allows. `anon` is granted nothing — every policy below is TO authenticated.
-- config.toml does not set auto_expose_new_tables, so these are required.

grant usage on schema public to authenticated;

-- No INSERT: profiles rows are created by the handle_new_user() trigger.
-- No DELETE: profiles die with their auth.users row via ON DELETE CASCADE.
grant select, update                 on public.profiles      to authenticated;
grant select, insert, update, delete on public.categories    to authenticated;
grant select, insert, update, delete on public.groups        to authenticated;
-- No UPDATE: role changes (ownership transfer) are intentionally not
-- expressible through the API yet.
grant select, insert, delete         on public.group_members to authenticated;
grant select, insert, update, delete on public.expenses      to authenticated;


-- ---------------------------------------------------------------------------
-- 8. RLS policies
-- ---------------------------------------------------------------------------
--
-- auth.uid() is wrapped as (select auth.uid()) throughout: that makes it a
-- per-statement InitPlan instead of a per-row call, and lets the planner use
-- it as an index-qualifying constant.

-- profiles ------------------------------------------------------------------

-- Allows: reading your own profile, plus the profile of anyone you share a
-- group with. Why: group expense lists must show who spent what, which needs
-- co-members' display_name/avatar_url. Non-co-members stay invisible.
create policy "profiles_select_own_or_shared_group"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or private.shares_group_with(id, (select auth.uid()))
  );

-- Allows: editing only your own profile. WITH CHECK repeats the predicate so
-- the row cannot be updated into someone else's id.
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT policy: handle_new_user() (SECURITY DEFINER) creates rows.
-- No DELETE policy: profiles are removed by cascade from auth.users.

-- categories ----------------------------------------------------------------

-- Allows: reading your own categories only. Why: categories are private to a
-- user even inside a shared group; group members do not share category lists.
create policy "categories_select_own"
  on public.categories for select to authenticated
  using (user_id = (select auth.uid()));

-- Allows: creating categories owned by yourself. Prevents planting a category
-- in another user's account.
create policy "categories_insert_own"
  on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Allows: renaming/recolouring your own categories. WITH CHECK prevents
-- reassigning one to another user.
create policy "categories_update_own"
  on public.categories for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Allows: deleting your own categories. Expenses referencing them survive with
-- category_id set to NULL.
create policy "categories_delete_own"
  on public.categories for delete to authenticated
  using (user_id = (select auth.uid()));

-- groups --------------------------------------------------------------------

-- Allows: seeing a group only if you are a member. Uses the helper rather than
-- a group_members subquery to avoid firing that table's policy.
create policy "groups_select_member"
  on public.groups for select to authenticated
  using (private.is_group_member(id, (select auth.uid())));

-- Allows: creating a group attributed to yourself. A trigger then adds you as
-- owner in group_members.
create policy "groups_insert_self_as_creator"
  on public.groups for insert to authenticated
  with check (created_by = (select auth.uid()));

-- Allows: renaming a group only if you hold the 'owner' role. Note this is the
-- role, not created_by — ownership is membership state, not authorship.
create policy "groups_update_owner"
  on public.groups for update to authenticated
  using      (private.is_group_owner(id, (select auth.uid())))
  with check (private.is_group_owner(id, (select auth.uid())));

-- Allows: deleting a group only if you hold the 'owner' role. Cascades to
-- members and group expenses.
create policy "groups_delete_owner"
  on public.groups for delete to authenticated
  using (private.is_group_owner(id, (select auth.uid())));

-- group_members -------------------------------------------------------------

-- Allows: seeing the membership rows of groups you belong to. MUST go through
-- the helper — a direct subquery on group_members here is the classic
-- infinite-recursion (42P17) case.
create policy "group_members_select_shared_group"
  on public.group_members for select to authenticated
  using (private.is_group_member(group_id, (select auth.uid())));

-- Allows: the group owner to add members. Helper-based for the same recursion
-- reason as the SELECT policy.
create policy "group_members_insert_owner"
  on public.group_members for insert to authenticated
  with check (private.is_group_owner(group_id, (select auth.uid())));

-- Allows: the owner to remove members, and any user to remove themselves
-- (leave the group).
create policy "group_members_delete_owner_or_self"
  on public.group_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_group_owner(group_id, (select auth.uid()))
  );

-- No UPDATE policy (and no UPDATE grant): changing a role is ownership
-- transfer, which needs an atomic demote+promote and belongs in a dedicated
-- RPC rather than a row-at-a-time policy.

-- expenses ------------------------------------------------------------------

-- Allows: reading expenses attributed to you, plus every expense in a group
-- you belong to. Why: group spending is shared by definition; personal
-- expenses (group_id NULL) stay private to user_id.
create policy "expenses_select_own_or_group"
  on public.expenses for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      group_id is not null
      and private.is_group_member(group_id, (select auth.uid()))
    )
  );

-- Allows: entering an expense as yourself. Personal expenses must be your own;
-- group expenses may be attributed to a fellow member (logging on someone's
-- behalf) but never to an outsider, since BOTH the author and the payer must
-- be members. category_id, if set, must be one of your own categories.
create policy "expenses_insert_guarded"
  on public.expenses for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and case
          when group_id is null then
            user_id = (select auth.uid())
          else
            private.is_group_member(group_id, created_by)
            and private.is_group_member(group_id, user_id)
        end
    and (
      category_id is null
      or exists (
        select 1
        from public.categories c
        where c.id = category_id
          and c.user_id = (select auth.uid())
      )
    )
  );

-- Allows: editing only expenses you entered. WITH CHECK repeats the full
-- insert predicate — without it the insert guard is bypassable in two
-- statements (insert a valid row, then update user_id/group_id to point at a
-- non-member).
create policy "expenses_update_creator"
  on public.expenses for update to authenticated
  using (created_by = (select auth.uid()))
  with check (
    created_by = (select auth.uid())
    and case
          when group_id is null then
            user_id = (select auth.uid())
          else
            private.is_group_member(group_id, created_by)
            and private.is_group_member(group_id, user_id)
        end
    and (
      category_id is null
      or exists (
        select 1
        from public.categories c
        where c.id = category_id
          and c.user_id = (select auth.uid())
      )
    )
  );

-- Allows: deleting only expenses you entered. A member cannot delete an
-- expense someone else logged on their behalf; they can dispute it out of band.
create policy "expenses_delete_creator"
  on public.expenses for delete to authenticated
  using (created_by = (select auth.uid()));


-- ---------------------------------------------------------------------------
-- 9. Triggers
-- ---------------------------------------------------------------------------

-- Creates the profile row and seeds the default category set whenever a user
-- signs up. SECURITY DEFINER because it writes to public.profiles, which has
-- no INSERT policy, and runs in the auth.users insert context.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    -- Supabase OAuth providers populate these; email signup leaves them null
    -- and the user sets a display name later.
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.categories (user_id, name, color, is_default)
  values
    (new.id, 'Food',          '#EF4444', true),
    (new.id, 'Travel',        '#3B82F6', true),
    (new.id, 'Rent',          '#8B5CF6', true),
    (new.id, 'Utilities',     '#F59E0B', true),
    (new.id, 'Shopping',      '#EC4899', true),
    (new.id, 'Health',        '#10B981', true),
    (new.id, 'Entertainment', '#06B6D4', true),
    (new.id, 'Other',         '#6B7280', true);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile row and seeds default categories on signup.';

alter function public.handle_new_user() owner to postgres;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Adds the creator as owner of the group they just created. Required: the
-- group_members INSERT policy is owner-only, so without this a creator could
-- never add themselves, and the group would be invisible (groups_select_member
-- is membership-based) and permanently unadministrable.
create or replace function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner'::public.group_role);

  return new;
end;
$$;

comment on function public.handle_new_group() is
  'Adds the group creator as owner. Bootstraps membership for owner-only inserts.';

alter function public.handle_new_group() owner to postgres;

create trigger on_group_created
  after insert on public.groups
  for each row execute function public.handle_new_group();

-- Keeps expenses.updated_at current. Not SECURITY DEFINER: it only touches the
-- row already being written.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Sets updated_at to now() on every update.';

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();
