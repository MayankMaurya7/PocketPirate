-- Groups step: let a group owner add a member by email address.
--
-- Two problems this solves:
--
-- 1. There was no way to identify a person. `profiles` had no email and the
--    profiles SELECT policy (correctly) only exposes co-members, so an owner
--    could not look up the id of someone who isn't in a group with them yet.
-- 2. Even with the id, the member list needs something human-readable. Email
--    signups leave display_name NULL, so a members list would be blank.
--
-- Fix: mirror auth.users.email onto profiles (set on signup, kept in sync on
-- email change, backfilled here), and add a SECURITY DEFINER RPC that does
-- the lookup + insert for owners only. The RPC is the ONLY path that reads
-- another user's email before they share a group; the profiles SELECT policy
-- is unchanged, so co-members see each other's email and nobody else's.
--
-- Trade-off (deliberate): an owner learns whether an email has an account
-- ("no account" vs "added"). Accepted for Phase 1 — it is gated behind
-- owning a group, and an invite-link flow (which avoids it) needs its own
-- table. Revisit if the app opens to strangers.


-- ---------------------------------------------------------------------------
-- 1. profiles.email
-- ---------------------------------------------------------------------------

alter table public.profiles add column email text;

comment on column public.profiles.email is
  'Mirror of auth.users.email, maintained by trigger. Null for non-email auth.';

update public.profiles p
set    email = u.email
from   auth.users u
where  u.id = p.id
  and  p.email is distinct from u.email;

-- Set on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url, email)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
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

-- Kept in sync when the user changes their email in Supabase Auth.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set    email = new.email
  where  id = new.id;

  return new;
end;
$$;

comment on function public.handle_user_email_change() is
  'Mirrors auth.users.email changes onto profiles.email.';

alter function public.handle_user_email_change() owner to postgres;

create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();


-- ---------------------------------------------------------------------------
-- 2. add_group_member_by_email(group, email) RPC
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER so it can read profiles.email for a user the caller cannot
-- yet see. Every check is done inside, in this order, so a non-owner learns
-- nothing about the email — the owner check runs BEFORE the lookup.
--
-- Errors carry user-facing messages on purpose: PostgREST forwards the
-- message verbatim and the client shows it as-is.

create or replace function public.add_group_member_by_email(
  _group_id uuid,
  _email    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _caller uuid := (select auth.uid());
  _target uuid;
begin
  if _caller is null then
    raise exception 'You must be signed in.';
  end if;

  if not private.is_group_owner(_group_id, _caller) then
    raise exception 'Only group owners can add members.';
  end if;

  select p.id
  into   _target
  from   public.profiles p
  where  p.email is not null
    and  lower(p.email) = lower(btrim(_email))
  limit  1;

  if _target is null then
    raise exception 'No account exists with that email address.';
  end if;

  if private.is_group_member(_group_id, _target) then
    raise exception 'That person is already a member of this group.';
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (_group_id, _target, 'member'::public.group_role);

  return _target;
end;
$$;

comment on function public.add_group_member_by_email(uuid, text) is
  'Owner-only: adds the user with the given email to the group. Returns their id.';

alter function public.add_group_member_by_email(uuid, text) owner to postgres;

-- PUBLIC gets EXECUTE on new functions by default; restrict to signed-in users.
revoke execute on function public.add_group_member_by_email(uuid, text)
  from public, anon;
grant execute on function public.add_group_member_by_email(uuid, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'profiles'
      and column_name  = 'email'
  ) then
    raise exception 'profiles.email was not created';
  end if;

  if exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.email is distinct from u.email
  ) then
    raise exception 'profiles.email backfill does not match auth.users';
  end if;

  if not has_function_privilege(
    'authenticated', 'public.add_group_member_by_email(uuid, text)', 'execute'
  ) then
    raise exception 'authenticated lacks EXECUTE on add_group_member_by_email';
  end if;

  if has_function_privilege(
    'anon', 'public.add_group_member_by_email(uuid, text)', 'execute'
  ) then
    raise exception 'anon must not have EXECUTE on add_group_member_by_email';
  end if;
end;
$$;
