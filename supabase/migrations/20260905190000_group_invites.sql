-- Invite links: let a group owner share a link that lets anyone holding it
-- join the group.
--
-- Add-by-email (migration 003) needs the invitee to already have an
-- account, and tells the owner whether an address has one. A link does
-- neither: the owner hands out an unguessable URL, and whoever opens it
-- signs in (or up) and joins themselves. Nobody's email is looked up.
--
-- Shape: at most ONE live link per group (unique group_id). Creating a
-- link again replaces the old one — that is also how an owner revokes a
-- leaked link ("reset"). Links expire after 30 days so a forgotten link in
-- a chat history does not stay valid forever; the owner can reset it any
-- time. The token is 256 bits of randomness rendered as 64 hex characters
-- (two gen_random_uuid()s — pgcrypto is not installed on this project and
-- is not worth adding for this).
--
-- Who does what:
--   owners      create/reset (RPC), see the current link (RLS SELECT),
--               remove it (RLS DELETE)
--   link holder preview the group (name, size) and join — both RPCs,
--               SECURITY DEFINER, since the holder cannot see the group
--               or its members under RLS until they are a member
--   anyone else nothing: no INSERT/UPDATE grant at all, and the token
--               never leaves the owners' rows
--
-- Joining inserts a plain 'member' row; it never promotes. A holder who
-- is already a member simply gets the group id back (the link is safe to
-- open twice). Error messages are user-facing and shown verbatim.


-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

create table public.group_invites (
  id         uuid primary key default gen_random_uuid(),
  -- One live link per group; creating again replaces it.
  group_id   uuid not null unique references public.groups (id) on delete cascade,
  -- 64 lowercase hex characters, unguessable. This is the whole secret.
  token      text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint group_invites_token_shape check (token ~ '^[0-9a-f]{64}$')
);

comment on table public.group_invites is
  'The current invite link of a group (one per group). Anyone holding the token may join until expires_at.';

comment on column public.group_invites.token is
  '64 hex chars of randomness. Only owners can read it (RLS); it is exchanged through accept_group_invite.';


-- ---------------------------------------------------------------------------
-- 2. RLS + grants
-- ---------------------------------------------------------------------------

alter table public.group_invites enable row level security;

-- Default privileges grant ALL on new public tables to anon and
-- authenticated. Start from nothing so the grant below is the whole truth.
revoke all on public.group_invites from public, anon, authenticated;

-- No INSERT/UPDATE: rows are only ever written by create_group_invite.
grant select, delete on public.group_invites to authenticated;

-- Allows: owners to see their group's current link.
create policy "group_invites_select_owner"
  on public.group_invites for select to authenticated
  using (private.is_group_owner(group_id, (select auth.uid())));

-- Allows: owners to remove the link (nobody can join with it any more).
create policy "group_invites_delete_owner"
  on public.group_invites for delete to authenticated
  using (private.is_group_owner(group_id, (select auth.uid())));


-- ---------------------------------------------------------------------------
-- 3. create_group_invite(group): owner-only create or reset
-- ---------------------------------------------------------------------------

create or replace function public.create_group_invite(_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _caller uuid := (select auth.uid());
  _token  text;
begin
  if _caller is null then
    raise exception 'You must be signed in.';
  end if;

  if not private.is_group_owner(_group_id, _caller) then
    raise exception 'Only group owners can create invite links.';
  end if;

  _token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  -- Replace rather than update, so a reset always mints a fresh token and
  -- a fresh expiry.
  delete from public.group_invites where group_id = _group_id;

  insert into public.group_invites (group_id, token, created_by, expires_at)
  values (_group_id, _token, _caller, now() + interval '30 days');

  return _token;
end;
$$;

comment on function public.create_group_invite(uuid) is
  'Owner-only: creates (or replaces) the group''s invite link, valid 30 days. Returns the token.';

alter function public.create_group_invite(uuid) owner to postgres;

revoke execute on function public.create_group_invite(uuid) from public, anon;
grant execute on function public.create_group_invite(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. preview_group_invite(token): what a link holder sees before joining
-- ---------------------------------------------------------------------------
--
-- Zero rows for an unknown or expired token (the page renders "invalid or
-- expired"), one row otherwise. Deliberately shows only what the join page
-- needs — the group's name and size, and the inviter's display name (never
-- their email: a link can be forwarded to anyone).

create or replace function public.preview_group_invite(_token text)
returns table (
  group_id       uuid,
  group_name     text,
  member_count   integer,
  already_member boolean,
  invited_by     text
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    g.id,
    g.name,
    (select count(*)::integer from public.group_members m where m.group_id = g.id),
    private.is_group_member(g.id, (select auth.uid())),
    p.display_name
  from public.group_invites i
  join public.groups g on g.id = i.group_id
  left join public.profiles p on p.id = i.created_by
  where i.token = _token
    and i.expires_at > now()
    and (select auth.uid()) is not null;
$$;

comment on function public.preview_group_invite(text) is
  'For a signed-in link holder: the group behind a live invite token (name, size, whether they are already in it). No rows if invalid/expired.';

alter function public.preview_group_invite(text) owner to postgres;

revoke execute on function public.preview_group_invite(text) from public, anon;
grant execute on function public.preview_group_invite(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. accept_group_invite(token): join
-- ---------------------------------------------------------------------------

create or replace function public.accept_group_invite(_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _caller uuid := (select auth.uid());
  _group  uuid;
begin
  if _caller is null then
    raise exception 'You must be signed in.';
  end if;

  select i.group_id
  into   _group
  from   public.group_invites i
  where  i.token = _token
    and  i.expires_at > now();

  if _group is null then
    raise exception 'This invite link is invalid or has expired.';
  end if;

  -- Opening the link twice is harmless; never touch an existing role.
  if private.is_group_member(_group, _caller) then
    return _group;
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (_group, _caller, 'member'::public.group_role);

  return _group;
end;
$$;

comment on function public.accept_group_invite(text) is
  'Joins the caller to the group behind a live invite token as a member (no-op if already in it). Returns the group id.';

alter function public.accept_group_invite(text) owner to postgres;

revoke execute on function public.accept_group_invite(text) from public, anon;
grant execute on function public.accept_group_invite(text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _policies integer;
  _acl      record;
  _fn       text;
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'group_invites'
      and c.relrowsecurity
  ) then
    raise exception 'group_invites missing or RLS not enabled';
  end if;

  select count(*)
  into   _policies
  from   pg_policies
  where  schemaname = 'public'
    and  tablename  = 'group_invites';

  if _policies <> 2 then
    raise exception 'expected 2 policies on group_invites, found %', _policies;
  end if;

  if not has_table_privilege('authenticated', 'public.group_invites', 'select')
     or not has_table_privilege('authenticated', 'public.group_invites', 'delete')
  then
    raise exception 'authenticated lacks select/delete on group_invites';
  end if;

  if has_table_privilege('authenticated', 'public.group_invites', 'insert')
     or has_table_privilege('authenticated', 'public.group_invites', 'update')
     or has_table_privilege('authenticated', 'public.group_invites', 'truncate')
     or has_table_privilege('authenticated', 'public.group_invites', 'references')
     or has_table_privilege('authenticated', 'public.group_invites', 'trigger')
  then
    raise exception 'authenticated has more than select/delete on group_invites';
  end if;

  if has_any_column_privilege('anon', 'public.group_invites', 'select')
     or has_table_privilege('anon', 'public.group_invites', 'delete')
  then
    raise exception 'anon must not touch group_invites';
  end if;

  for _acl in
    select grantee
    from   aclexplode((select relacl from pg_class where oid = 'public.group_invites'::regclass))
    where  grantee = 0
  loop
    raise exception 'group_invites still has a PUBLIC grant';
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.group_invites'::regclass
      and contype = 'u'
      and conkey = array[
        (select attnum from pg_attribute where attrelid = 'public.group_invites'::regclass and attname = 'group_id')
      ]
  ) then
    raise exception 'group_invites.group_id is not unique (one link per group)';
  end if;

  foreach _fn in array array[
    'public.create_group_invite(uuid)',
    'public.preview_group_invite(text)',
    'public.accept_group_invite(text)'
  ] loop
    if not has_function_privilege('authenticated', _fn, 'execute') then
      raise exception 'authenticated lacks EXECUTE on %', _fn;
    end if;
    if has_function_privilege('anon', _fn, 'execute') then
      raise exception 'anon must not have EXECUTE on %', _fn;
    end if;
    if not exists (
      select 1
      from pg_proc
      where oid = _fn::regprocedure
        and prosecdef
    ) then
      raise exception '% must be SECURITY DEFINER', _fn;
    end if;
  end loop;
end;
$$;
