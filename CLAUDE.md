# CLAUDE.md

Guidance for working in this repository.

## Product

A personal finance expense tracker. Users manually log expenses with custom
categories, view filtered lists (by category / user / history), create shared
groups (e.g. flatmates tracking household expenses), and see spending stats for
today / week / month / year. Later phases add voice entry (speech-to-text + LLM
parsing into amount/category/group, producing pending entries with an
approve/reject workflow and a 30-day trash bin) and a React Native mobile app
with SMS/email payment auto-detection.

## Architecture

- **Monorepo**: Turborepo + pnpm workspaces. **pnpm only** — do not use npm or
  yarn (the repo pins `packageManager` and relies on `workspace:*` protocol).
- **Backend**: Supabase — Postgres, Supabase Auth, Edge Functions (LLM parsing
  and scheduled cleanup), and Realtime (group sync). **There is no custom API
  server.** Clients talk to Supabase directly.
- **Authorization is Postgres Row-Level Security (RLS).** RLS is the security
  layer — every table that holds user data must have RLS policies. Never rely on
  client-side checks for authorization; assume the client is untrusted.
- **Web client**: Next.js (App Router) as an installable PWA.

## Repository layout

```
apps/
  web/              Next.js App Router web app (PWA). src/ dir, @/* alias.
packages/
  shared/           @expense-tracker/shared — shared TS types/utils.
                    Source-only (no build step); consumed via
                    Next transpilePackages. Web and (later) mobile import it.
                    Generated DB types live in src/database.types.ts and are
                    re-exported from the barrel (src/index.ts).
supabase/           Supabase project — migrations & Edge Functions (later phases).
```

## Phase plan

1. **Phase 1 (current)**: Next.js web PWA. Manual expense logging, custom
   categories, filtered lists, shared groups, stats.
2. **Phase 2**: Voice entry — speech-to-text + LLM parsing (Supabase Edge
   Function) creating pending entries; approve/reject workflow; 30-day trash bin
   (scheduled cleanup Edge Function).
3. **Phase 3**: `apps/mobile` (React Native) sharing `packages/shared`;
   SMS/email payment auto-detection.

## Conventions

- **TypeScript strict mode** everywhere (`strict: true`). No `any` escape
  hatches without justification.
- **Money is stored as integer minor units** (paise for INR, cents for USD —
  the smallest unit of each currency) — never floats. All arithmetic is done on
  these integers for exactness. Every expense also carries an ISO 4217
  `currency` code, snapshotted at entry time. Convert and format to the display
  currency (₹, $, €, …) only at the display edge.
- **pnpm only.** Install with `pnpm install`; run tasks through Turbo
  (`pnpm build`, `pnpm dev`, `pnpm lint`).
- Cross-client code goes in `packages/shared`, not duplicated per app.
- **Auth uses @supabase/ssr with the getAll/setAll cookie pattern** — never the
  deprecated get/set/remove methods or the old auth-helpers package.
- **Never hand-edit `packages/shared/src/database.types.ts`** — it is generated.
  Regenerate after any schema change with:
  `pnpm supabase gen types typescript --linked > packages/shared/src/database.types.ts`

## Working style (important)

- **Build one step at a time.** Implement a single, well-scoped piece, verify it
  builds/typechecks, then stop and summarize. Do NOT chain ahead into multiple
  features in one session. The developer reviews and commits each step himself.
- **Do not commit** unless explicitly asked — the developer commits manually
  after review.
- **Surface deviations and decisions explicitly** in your summary, with
  reasoning — don't silently pick and move on. If a spec detail would introduce
  a security hole or a framework mismatch, flag it and propose the fix rather
  than implementing the flawed version silently.
- Prefer verifying against installed package types over memory when an API may
  have changed.

## Environment notes

- **pnpm is pinned to 9.15.9** (recorded in `packageManager`). Do NOT upgrade to
  pnpm 11.x — it crashes under this machine's Node 20.19.5 via corepack. Ignore
  the "update available" banner.
- No Docker and no local psql on the dev machine. This means: no local Supabase
  stack, no `supabase db diff`, no direct psql. Remote CLI access works
  (`--linked` commands). Verify RLS/schema via throwaway assertion migrations
  (DO $$ ... $$ blocks) pushed to the linked project, then reverted, rather than
  local tooling.
- Supabase project: linked, ap-south-1 (Mumbai). `config.toml` exposes only
  `public` + `graphql_public` to the API; the `private` schema is not exposed,
  so explicit GRANTs to `authenticated` are mandatory (auto_expose_new_tables is
  off).

## Current state (what exists)

Done and on `main`:
- Monorepo skeleton (Turborepo + pnpm; apps/web Next.js App Router + TS +
  Tailwind; packages/shared source-only TS package).
- Supabase project created + linked; CLI installed as a pinned root devDep
  (invoke as `pnpm supabase ...`).
- **Migration 001** applied — full Phase 1 schema:
  - Tables: `profiles`, `categories`, `groups`, `group_members`, `expenses`.
  - Enums: `group_role`, `expense_source`, `expense_status`.
  - 17 RLS policies (all scoped TO authenticated), 4 indexes.
  - 3 SECURITY DEFINER helpers in a `private` schema
    (`is_group_member`, `is_group_owner`, `shares_group_with`) to avoid RLS
    recursion. FORCE RLS is deliberately OFF (helpers rely on owner exemption).
  - Triggers: `handle_new_user` (creates profile + seeds 8 default categories:
    Food, Travel, Rent, Utilities, Shopping, Health, Entertainment, Other),
    `handle_new_group` (adds creator as owner member — resolves group-creation
    deadlock), `set_updated_at` on expenses.
  - `expenses` supports on-behalf entries: `user_id` (whose expense) +
    `created_by` (who entered it), both must be group members for group
    expenses. UPDATE policy is hardened (repeats the full insert predicate) and
    validates category ownership.
- **Migration 002** applied — grants USAGE on schema `private` + EXECUTE on
  the 3 RLS helpers to `authenticated`. Policy expressions run with the
  CALLING role's privileges (001 wrongly assumed owner evaluation), so
  without these grants any policy touching a helper failed with 42501. Safe:
  `private` is not API-exposed, so no RPC surface. Includes a self-check DO
  block asserting the grants.
- Generated DB types in packages/shared, re-exported from the barrel.
- Supabase clients: browser (`src/lib/supabase/client.ts`), server
  (`src/lib/supabase/server.ts`), session-refresh middleware
  (`src/middleware.ts` + helper). getAll/setAll pattern, verified against
  @supabase/ssr 0.12.5 types.
- **Auth UI**: combined login/signup page at `/login` (email+password + Google
  OAuth button + toggle), OAuth/email-confirm callback at `/callback`. Email
  signup tested working end-to-end (profile + categories seeded on signup,
  confirmed in dashboard). Google OAuth built but needs dashboard credentials
  to function.
- **Authenticated home page** at `/`: server component using `getClaims()`,
  redirects signed-out users to `/login`; header (wordmark, email, sign-out
  client component).
- **Personal expense CRUD** on the home page: server-fetched list (category
  joined, newest first, `group_id is null`), add/edit/delete via client
  components + browser client + `router.refresh()`. Shared `ExpenseForm`
  handles add and inline edit (amount, category picker, date, description).
  Money helpers live in `packages/shared/src/money.ts` (string-parse to
  integer minor units, Intl-based formatting, `DEFAULT_CURRENCY = "INR"`).
- **Category management UI** at `/categories`: server-fetched list with
  per-category expense counts (PostgREST `expenses(count)` aggregate under
  RLS), add/edit/delete via client components (`CategoryForm`, `AddCategory`,
  `CategoryItem`). Name + colour (preset swatches or native colour input);
  `icon` column exists but is not exposed in the UI yet. Unique-name violation
  (23505) mapped to a friendly message. Delete confirm states how many expenses
  become uncategorised (FK is `on delete set null`). Shared `AppHeader`
  (wordmark + Expenses/Categories nav + sign-out) used by `/` and
  `/categories`; list-row icons live in `components/icons.tsx`.
- **Filtered list views** on `/`: filter by category (incl. "Uncategorised")
  and date range (Today / This week / This month / This year / Custom
  from–to). Filter state lives in URL search params (`category`, `range`,
  `from`, `to`) — `lib/expense-filters.ts` parses/validates them server-side
  (UUID + date shape checks, swaps inverted bounds, ignores a preset without
  bounds) and the server component applies them to the query. Preset bounds
  are computed in the browser (`presetDateRange` in
  `packages/shared/src/dates.ts`, Monday-start weeks) so they follow the user's
  local timezone. The filter bar mirrors the chosen filters optimistically
  (`useOptimistic` + `useTransition` around `router.replace`) so chips select
  instantly instead of after the server round-trip, with an "Updating…" hint
  while pending. Shows a count + per-currency total for the filtered set and
  a distinct "no matching expenses" empty state. "By user" filtering is
  deferred to the Groups step (only meaningful for group expenses).

- **Migration 003** applied — `profiles.email` (mirror of `auth.users.email`;
  set in `handle_new_user`, kept in sync by an `on_auth_user_email_updated`
  trigger, backfilled) + `public.add_group_member_by_email(_group_id, _email)`
  SECURITY DEFINER RPC (owner check runs BEFORE the email lookup so non-owners
  learn nothing; user-facing error messages are raised verbatim and shown
  as-is by the client; EXECUTE granted to `authenticated` only). Accepted
  trade-off: an owner learns whether an email has an account — an invite-link
  flow would avoid this but needs its own table (backlog). Co-members can see
  each other's email via the existing profiles SELECT policy.
- **Groups UI (membership)**: `/groups` lists the user's groups (member count,
  Owner badge) with a create form (`AddGroup` → `GroupForm`, navigates to the
  new group; the id is minted client-side with `crypto.randomUUID()` because
  `.insert().select()` fails RLS — RETURNING is checked against the SELECT
  policy before the AFTER trigger makes the creator a member). `/groups/[id]`
  shows the group (404 for non-members — RLS
  filters, page calls `notFound()`), members list (`MemberItem`: avatar or
  initial, display name → email → "Unknown member" via `memberLabel`, role,
  "You"), owner-only add-by-email (`AddMember` → RPC), owner-only remove
  member, rename/delete group (`GroupActions`), leave group for members and
  co-owners (the sole owner cannot leave — delete instead; UI-only guard, the
  DB-level last-owner guard stays in the backlog). "Groups" added to
  `AppHeader` nav; `isUuid` exported from `lib/expense-filters.ts`.
- **Group expenses**: `ExpenseForm` has a Group picker (Personal / each group
  / "+ New group…" which creates the group inline, client-minted id, then the
  expense — if the expense insert fails the form re-targets the now-existing
  group so a retry doesn't duplicate it) and, for a group, a "Paid by" member
  picker (sets `user_id`; `created_by` is always self; RLS enforces both).
  Editing can move an expense between Personal and groups. `ExpenseItem`
  shows group name + "Paid by …" and hides edit/delete unless
  `created_by` is the viewer; another member's category is invisible under
  RLS (categories are per-user) so their rows show no category label rather
  than "Uncategorised". Home `/` list: `group` + `member` URL params
  (`Personal` default = own, `group_id is null`; a group = all members'
  expenses; `member` narrows by payer). Group detail page shows the group's
  expenses (add preset to the group, count + totals, "Filter" link to
  `/?group=<id>`). Shared bits: `lib/expenses.ts` (`EXPENSE_SELECT` embed —
  `payer:profiles!expenses_user_id_fkey` because expenses has two FKs to
  profiles — `GROUP_OPTION_SELECT`, `toGroupOption`, `totalsByCurrency`) and
  `components/expense-list.tsx` (list card + empty state). `lib/types.ts`:
  `ExpenseListItem` (replaces `ExpenseWithCategory`), `GroupOption`,
  `GroupMemberOption`.
- **Global cursor fix**: Tailwind v4 preflight resets buttons to
  `cursor: default`; `globals.css` restores `cursor: pointer` on enabled
  buttons / `[role=button]` / submit inputs / `summary` in `@layer base`.

Not yet built (immediate next steps, in rough order):
- **Expense splitting (next)**: migration adding `expense_splits`
  (`expense_id`, `user_id`, `amount_minor_units`; PK (expense_id, user_id);
  RLS: read if you can read the expense, write only by the expense's
  `created_by`, participants must be group members; sum must equal the
  expense amount). Form: "Split between" member checkboxes (default: all
  current members, equal split, remainder minor units distributed to the
  first participants), editable later as members join. Group page: per-member
  balance (paid − owed). Personal expenses have no splits. "Simplify debts"
  stays in the backlog.
- Stats dashboard (today/week/month/year + charts).
- PWA config (manifest + service worker).
- Deploy to Vercel.

## Backlog (future — capture, don't build until scheduled)

- **Notifications** system (in-app; new table) — including on-behalf-expense
  notification events to group members. Phase 2-ish migration.
- **Location-based currency default** (app logic): if the user grants location,
  default their currency to the local one; else USD; also a preferred-currency
  setting in the profile.
- **Group reports & charts**: category share (pie/donut), per-person breakdown,
  spending over time — a read/aggregation feature, no schema change needed.
- **"Simplify debts"** (net out intermediary debts into fewer payments) on
  top of expense splits, plus settle-up records.
- **Invite links** for groups (token table + join RPC) as an alternative to
  add-by-email, which reveals whether an email has an account.
- **Group ownership transfer** + last-owner guard: currently a sole owner can
  leave via group_members_delete, stranding a group. Add a
  `transfer_group_ownership` RPC or a guard trigger. Later migration.
- **Constrain `expenses.status` at insert** — a client can currently set
  `confirmed` directly. Only matters once Phase 2's approve/reject workflow
  exists.
- **Custom SMTP** for Supabase auth emails before production (free-tier built-in
  SMTP is heavily rate-limited).
- **Rename `middleware.ts` → `proxy.ts`** once Supabase docs adopt the Next 16.2
  convention (currently kept as middleware.ts to stay aligned with Supabase's
  published examples; harmless deprecation warning for now).

## Commands

```bash
pnpm install    # install workspace deps
pnpm dev        # run all apps (web at http://localhost:3000)
pnpm build      # build everything
pnpm lint       # lint everything

# Regenerate DB types after a schema/migration change:
pnpm supabase gen types typescript --linked > packages/shared/src/database.types.ts
```
