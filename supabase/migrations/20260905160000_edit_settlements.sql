-- Editing a recorded payment.
--
-- Migration 006 offered no UPDATE on settlements: a wrong entry was to be
-- deleted and re-recorded. That loses the original date and note for a
-- typo in the amount, so either party may now correct a payment in place.
--
-- What may change: the amount, the date and the note — nothing else. The
-- two parties, the group, the currency and the recorder are fixed by a
-- column-level grant rather than a policy so that a client cannot even ask
-- for them (permission denied at the grant layer, before RLS). Turning a
-- payment around or moving it to another pair is delete-and-re-record, as
-- before.
--
-- Who may edit: either party — the same people who may delete — while
-- BOTH parties are still members. Deleting only requires the editor to be
-- a member, but a former member's balance is zero by construction (the
-- leave guard, migration 007) and nothing can ever be recorded against
-- them again (INSERT needs both parties to be members), so an edit that
-- reopened a balance with someone who has left could never be closed.


-- ---------------------------------------------------------------------------
-- 1. Grant: only the correctable columns
-- ---------------------------------------------------------------------------

grant update (amount_minor_units, settled_on, note)
  on public.settlements to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Policy
-- ---------------------------------------------------------------------------

-- Allows: either party to change the amount, date or note while both
-- parties are current members. USING and WITH CHECK are the same test:
-- the columns a client may write cannot change who the parties are.
create policy "settlements_update_party_members"
  on public.settlements for update to authenticated
  using (
    (
      from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, from_user_id)
    and private.is_group_member(group_id, to_user_id)
  )
  with check (
    (
      from_user_id = (select auth.uid())
      or to_user_id = (select auth.uid())
    )
    and private.is_group_member(group_id, from_user_id)
    and private.is_group_member(group_id, to_user_id)
  );


-- ---------------------------------------------------------------------------
-- 3. Self-check
-- ---------------------------------------------------------------------------

do $$
declare
  _policies integer;
  _column   text;
begin
  select count(*)
  into   _policies
  from   pg_policies
  where  schemaname = 'public'
    and  tablename  = 'settlements';

  if _policies <> 4 then
    raise exception 'expected 4 policies on settlements, found %', _policies;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename  = 'settlements'
      and policyname = 'settlements_update_party_members'
      and cmd = 'UPDATE'
      and roles = '{authenticated}'
  ) then
    raise exception 'settlements_update_party_members is missing or misconfigured';
  end if;

  -- Column-level, not table-level: the table privilege must stay absent.
  if has_table_privilege('authenticated', 'public.settlements', 'update') then
    raise exception 'authenticated must not have table-wide update on settlements';
  end if;

  foreach _column in array array['amount_minor_units', 'settled_on', 'note'] loop
    if not has_column_privilege('authenticated', 'public.settlements', _column, 'update') then
      raise exception 'authenticated cannot update settlements.%', _column;
    end if;
  end loop;

  foreach _column in array array[
    'id', 'group_id', 'from_user_id', 'to_user_id', 'created_by', 'currency', 'created_at'
  ] loop
    if has_column_privilege('authenticated', 'public.settlements', _column, 'update') then
      raise exception 'authenticated must not update settlements.%', _column;
    end if;
  end loop;

  if has_any_column_privilege('anon', 'public.settlements', 'update')
     or has_any_column_privilege('anon', 'public.settlements', 'select')
  then
    raise exception 'anon must not touch settlements';
  end if;
end;
$$;
