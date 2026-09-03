-- Fix: "42501 permission denied for function is_group_member" on expense
-- insert (and any other statement whose policy touches a private.* helper).
--
-- Migration 001 revoked all private-schema access from `authenticated` on the
-- assumption that policy expressions are evaluated as the table owner. They
-- are not: RLS policy expressions run with the privileges of the CURRENT
-- role. SECURITY DEFINER only switches identity inside the function body (so
-- the recursion-breaking still works) — the caller still needs USAGE on the
-- schema and EXECUTE on the function to invoke it at all.
--
-- This does NOT create the group-membership oracle 001 worried about:
-- `private` is absent from the API's exposed schemas in config.toml, so
-- PostgREST cannot expose these as RPC endpoints no matter what EXECUTE says.
-- The grant is reachable only through policy evaluation.

grant usage on schema private to authenticated;

grant execute on function private.is_group_member(uuid, uuid)   to authenticated;
grant execute on function private.is_group_owner(uuid, uuid)    to authenticated;
grant execute on function private.shares_group_with(uuid, uuid) to authenticated;

-- `anon` stays fully revoked: it has no table grants, so no policy (all are
-- TO authenticated) is ever evaluated for it.

-- Self-check: fail the migration loudly if the grants didn't take.
do $$
begin
  if not has_schema_privilege('authenticated', 'private', 'usage') then
    raise exception 'authenticated lacks USAGE on schema private';
  end if;
  if not has_function_privilege(
    'authenticated', 'private.is_group_member(uuid, uuid)', 'execute'
  ) then
    raise exception 'authenticated lacks EXECUTE on private.is_group_member';
  end if;
  if not has_function_privilege(
    'authenticated', 'private.is_group_owner(uuid, uuid)', 'execute'
  ) then
    raise exception 'authenticated lacks EXECUTE on private.is_group_owner';
  end if;
  if not has_function_privilege(
    'authenticated', 'private.shares_group_with(uuid, uuid)', 'execute'
  ) then
    raise exception 'authenticated lacks EXECUTE on private.shares_group_with';
  end if;
end;
$$;
