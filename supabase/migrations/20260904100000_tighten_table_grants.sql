-- ---------------------------------------------------------------------------
-- 005. Tighten table grants on the migration-001 tables
-- ---------------------------------------------------------------------------
--
-- Migration 001 assumed that a new table in `public` carries no privileges for
-- `anon` / `authenticated` and that its section-7 GRANTs were the whole truth.
-- That was wrong: the Supabase project ships `ALTER DEFAULT PRIVILEGES` that
-- hands ALL (SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) on
-- every new public table to `anon` AND `authenticated`. So 001's grants were
-- additive on top of a full set, and today:
--
--   * `anon` can reach every table (RLS has no anon policies, so it sees no
--     rows, but the grant should not exist at all);
--   * `authenticated` has UPDATE on group_members (001 deliberately withheld
--     it: role changes are not expressible through the API yet), INSERT /
--     DELETE on profiles, and TRUNCATE / REFERENCES / TRIGGER everywhere.
--
-- RLS makes the extra row privileges inert, and PostgREST cannot issue
-- TRUNCATE, so nothing is exploitable today — but table privileges are the
-- first gate and should say exactly what we mean. Migration 004 already does
-- this for expense_splits (REVOKE ALL, then GRANT); this brings the five
-- older tables in line.
--
-- `postgres` and `service_role` are untouched: they keep their full grants.

-- ---------------------------------------------------------------------------
-- 1. Start from nothing
-- ---------------------------------------------------------------------------

revoke all on public.profiles      from public, anon, authenticated;
revoke all on public.categories    from public, anon, authenticated;
revoke all on public.groups        from public, anon, authenticated;
revoke all on public.group_members from public, anon, authenticated;
revoke all on public.expenses      from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Re-grant exactly what 001 section 7 intended
-- ---------------------------------------------------------------------------

-- No INSERT: profiles rows are created by the handle_new_user() trigger.
-- No DELETE: profiles die with their auth.users row via ON DELETE CASCADE.
grant select, update                 on public.profiles      to authenticated;
grant select, insert, update, delete on public.categories    to authenticated;
grant select, insert, update, delete on public.groups        to authenticated;
-- No UPDATE: role changes (ownership transfer) are intentionally not
-- expressible through the API yet.
grant select, insert, delete         on public.group_members to authenticated;
grant select, insert, update, delete on public.expenses      to authenticated;

-- `anon` gets nothing. Every RLS policy is TO authenticated, and the only
-- unauthenticated surface is Supabase Auth itself.

-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  -- table -> privileges `authenticated` must hold. Anything not listed here
  -- (for any of the seven table privileges) must be absent.
  _expected constant jsonb := jsonb_build_object(
    'profiles',      array['SELECT', 'UPDATE'],
    'categories',    array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    'groups',        array['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    'group_members', array['SELECT', 'INSERT', 'DELETE'],
    'expenses',      array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  );
  _all_privs constant text[] := array[
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
  ];
  _table text;
  _priv  text;
  _want  boolean;
  _have  boolean;
begin
  for _table in select jsonb_object_keys(_expected) loop
    foreach _priv in array _all_privs loop
      _want := _expected -> _table ? _priv;
      _have := has_table_privilege(
        'authenticated', format('public.%I', _table), _priv
      );
      if _want and not _have then
        raise exception 'authenticated lacks % on public.%', _priv, _table;
      end if;
      if _have and not _want then
        raise exception 'authenticated must not have % on public.%', _priv, _table;
      end if;

      if has_table_privilege('anon', format('public.%I', _table), _priv) then
        raise exception 'anon must not have % on public.%', _priv, _table;
      end if;
    end loop;
  end loop;

  -- PUBLIC (every role) must hold nothing either. has_table_privilege()
  -- cannot be asked about the PUBLIC pseudo-role, so inspect the ACL
  -- directly: aclexplode() reports a PUBLIC entry with grantee oid 0.
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'public'
      and c.relname in ('profiles', 'categories', 'groups', 'group_members', 'expenses')
      and a.grantee = 0 -- 0 = PUBLIC
  ) then
    raise exception 'PUBLIC still holds privileges on a migration-001 table';
  end if;
end
$$;
