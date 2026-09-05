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
  (`--linked` commands). **Ad-hoc SQL against the linked project:**
  `pnpm supabase db query --linked "<sql>"` (runs as postgres, RLS bypassed).
  To test RLS/triggers without leaving data behind, send one multi-statement
  string: `begin; set local role authenticated; set local request.jwt.claims
  to '{"sub":"<uuid>","role":"authenticated"}'; ...; set constraints all
  immediate; rollback;` — errors surface in the CLI output, nothing persists.
  Migrations should still end with a self-check DO block.
- Supabase project: linked, ap-south-1 (Mumbai). `config.toml` exposes only
  `public` + `graphql_public` to the API; the `private` schema is not exposed.
- **Default privileges grant ALL** (incl. UPDATE, TRUNCATE, TRIGGER, REFERENCES)
  on every new `public` table to `anon` AND `authenticated` — Supabase's
  project-level `ALTER DEFAULT PRIVILEGES`. Migration 001's assumption that
  grants must be explicit was wrong. **Every new table must
  `revoke all ... from public, anon, authenticated` before granting.**
  Migration 005 tightened the five migration-001 tables to exactly 001's
  intended grants.

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
- **Migration 004** applied — `expense_splits` (`expense_id`, `user_id`,
  `amount_minor_units > 0`; PK (expense_id, user_id); cascade from both
  FKs; index on `user_id`). Grants: explicit REVOKE ALL then
  `select, insert, delete` to `authenticated` (no UPDATE — the client
  replaces the whole set). RLS: SELECT if you can read the expense (subquery
  under the expenses policy), INSERT only by the expense's `created_by` for a
  group expense with a participant who is a current member, DELETE only by
  `created_by`. **Sum invariant** (no splits, OR group expense whose splits
  sum exactly to `amount_minor_units`) is enforced by two DEFERRABLE
  INITIALLY DEFERRED constraint triggers — `expense_splits_check_sum` (any
  split row change) and `expenses_check_splits` (UPDATE OF
  amount_minor_units, group_id; also refuses a group change while splits
  exist) — both SECURITY DEFINER wrappers around
  `private.assert_expense_splits(uuid)`. Deferred so a multi-row insert is
  judged at commit. Verified behaviourally via `db query` (mismatched sum,
  amount change while split, group move, non-member participant,
  non-creator write, re-split flow).
- **Expense splitting UI**: `ExpenseForm` shows "Split between" member
  checkboxes for a group expense (default: everyone; new inline group: just
  you; untick all = un-split) with a live per-member share preview
  (`splitEqually` in `packages/shared/src/money.ts`: floor + remainder one
  unit each to the first participants in member order). Save order keeps the
  DB invariant at every request boundary: delete splits → update expense →
  insert splits; on create, the expense id is client-minted and a failed
  split insert leaves the form open with `savedExpenseId` so a retry updates
  rather than duplicates. Splits are only rewritten when amount, group or
  participant set changed. `ExpenseListItem.expense_splits` is embedded via
  `EXPENSE_SELECT`; `ExpenseItem` meta shows "Not split" / "Split N ways ·
  your share ₹x". Group page: `balancesByMember` (`lib/expenses.ts`) credits
  the payer and debits each participant per currency (un-split expenses
  ignored, so balances net to zero); `MemberItem` shows +green / −red /
  "Settled up" once the group has any split expense. Known gaps: a member
  who leaves keeps their share but is not listed, so visible balances no
  longer sum to zero and re-saving that expense drops them; deleting a
  profile that is in someone else's split is blocked by the sum check.

- **Migration 005** applied — `revoke all` on the five migration-001 tables
  from `public, anon, authenticated`, then re-grant exactly what 001's
  section 7 intended (`profiles`: select/update; `group_members`:
  select/insert/delete; `categories`, `groups`, `expenses`:
  select/insert/update/delete; `anon`: nothing). Self-check DO block walks
  every table × all seven privileges for `authenticated` and `anon` and
  inspects the ACL via `aclexplode()` for a leftover PUBLIC entry. Verified
  live: authenticated UPDATE on group_members and any anon read now fail
  with 42501 at the grant layer, before RLS. `postgres` / `service_role`
  untouched.

- **Stats dashboard** at `/stats` ("Stats" in `AppHeader` nav): personal
  expenses only (`user_id` = self, `group_id is null`, `status =
  'confirmed'`; group reports stay in the backlog). The server page fetches
  lean rows (`StatsExpense`) since 1 Jan of last year in 1000-row pages
  (PostgREST `max_rows`) and hands them to the client `StatsDashboard`,
  which computes everything in the browser so periods follow the user's
  local timezone (`useSyncExternalStore` mounted gate — "now" only exists
  after hydration; placeholders render until then). KPI row = four
  `StatTile` buttons (Today / This week / This month / This year: total per
  currency, count, % change vs the like-for-like previous period —
  `previousPeriodRange` in `packages/shared/src/dates.ts` shifts the
  month-to-date range back one month/year with day clamping) which also
  select the period for the charts below (default: month). Charts:
  `CategoryBars` (horizontal bars, largest first, category colour dot +
  amount + share, "Uncategorised" for null, "Deleted category" if the id no
  longer resolves) and `SpendColumns` (inline-SVG single-series columns,
  daily for week/month, monthly for year, hidden for Today; hover/focus
  tooltip per column, max column direct-labelled, nice tick steps, container
  measured with `ResizeObserver` so text never scales). Both cards have a
  "Show as table" `<details>` twin. Charts use the dominant currency of the
  period with a note when others are excluded; tiles go compact ("₹1.2L")
  from 1,00,000 major units. Aggregation lives in
  `packages/shared/src/stats.ts` (`expensesInRange`, `sumByCurrency`,
  `totalsByCategory`, `totalsByBucket`, `percentChange`); date helpers
  `listDays`/`listMonths`/`fromLocalDateString`; money
  `formatMinorUnitsCompact`. Single-series colour is the brand emerald
  (validated ≥3:1 on both surfaces), category identity comes from the dot
  beside the label, not the bar.

- **Migration 006** applied — `settlements` (`group_id`, `from_user_id`
  payer, `to_user_id` payee, `created_by`, `amount_minor_units > 0`,
  `currency`, `settled_on` date, `note`; `from <> to` check; cascade from
  groups and all three profile FKs; index `(group_id, settled_on desc)`).
  Kept separate from `expenses` so payments never appear as spending.
  Grants: explicit REVOKE ALL then `select, insert, delete` to
  `authenticated` (no UPDATE — delete and re-record). RLS: SELECT for
  group members; INSERT only if `created_by` = self, self is one of the
  two parties, and both parties are current members (nobody records a
  payment between two others); DELETE by either party while still a
  member. Self-check DO block covers RLS, policy count, all seven
  privileges, the PUBLIC ACL entry and the check constraint. Verified
  live via rolled-back `db query` transactions (party/non-party/outsider
  inserts, payee recording on payer's behalf, non-party delete = 0 rows,
  UPDATE and anon SELECT fail 42501 at the grant layer).
- **Group balances & settle up** on `/groups/[id]`: `lib/balances.ts`
  `groupLedger(expenses, settlements)` builds a **direct pairwise ledger**
  (per unordered member pair, per currency: participants owe the payer
  their share; a settlement credits the payer and debits the payee) and
  derives per-member net balances from it, so both views agree and net to
  zero. Debts are not simplified across the group (Splitwise "simplify
  debts" OFF) so every number is traceable to expenses between two people.
  UI: a "Balances" section (shown once anything is split or paid) with
  `BalanceSummary` ("Overall, you owe / are owed …" per currency), a debts
  card (`DebtItem`: the viewer's pairs first — "You owe X" red / "X owes
  you" green with a **Settle up** / **Record payment** button — then other
  members' pairs read-only, "Between other members"), and a `<details>`
  list of recorded payments (`SettlementItem`: "X paid Y", date, recorded
  by, note, delete for either party). `SettleUpForm` (modelled on
  Splitwise's record-payment screen): direction fixed by the debt, amount
  prefilled with the debt but editable (live hint for partial payments or
  overpaying, which flips the debt), date, optional note, "recorded outside
  Spendwise, no money is moved" notice. A party who has left the group is
  labelled "a former member" and gets no settle button (RLS needs both to
  be members). `ExpenseItem` now shows **"you lent ₹x" / "you borrowed
  ₹x" / "not involved"** under the amount for split group expenses.
  `MemberItem` net balances include settlements. Icons added:
  `BanknoteIcon`, `InfoIcon`. `lib/types.ts`: `Settlement`, `MemberLabels`.
- **Group page layout (compact, no tabs)**: header = title + owner/leave
  actions (`GroupActions`), then an "N people" chip (`MembersDialog`) that
  opens a native `<dialog>` (`components/modal.tsx`: `showModal()`, body
  scroll lock, backdrop/Escape close, children mounted only while open)
  holding the whole members UI (list with net balances, owner-only add by
  email and remove). Below: the Balances section, then an **Activity
  timeline** (`GroupTimeline`) merging expenses and recorded payments,
  newest first (date, then `created_at`), grouped under month headings,
  with each row showing "added 8:50 pm" (`AddedAt`: client-only after
  hydration via `useSyncExternalStore`, since the server can't know the
  browser timezone; shows the day too when it differs from the entry's
  date). **Add expense is a fixed bottom-right button** (`AddExpenseFab`)
  opening `ExpenseForm` in the modal; `main` has bottom padding so the last
  row is never covered. The inline `AddExpense` and `ExpenseList` remain in
  use on `/`. Icons added: `UsersIcon`, `PlusIcon`.
- **Row alignment convention**: every list row that may or may not carry
  trailing action buttons reserves a fixed-width slot for them (`w-15` for
  the edit+delete pair on expense and payment rows, `w-7` for the remove
  icon on member rows, `w-32` for the Settle up / Record payment button on
  debt rows), so amounts share one right edge across the list. Keep this
  when adding new row types or actions.

- **Migration 007** applied — leave/remove guards on `group_members`:
  `group_members_guard_delete`, a BEFORE DELETE row trigger
  (`public.guard_group_member_delete()`, SECURITY DEFINER, owned by
  postgres) that (1) blocks the **last owner** from leaving ("The only
  owner cannot leave the group. Delete the group instead.") and (2) blocks
  leaving/removal with an **open balance**, via
  `private.has_unsettled_balance(group_id, user_id)` (EXECUTE revoked from
  API roles; reached only through the trigger). "Open" is judged **per
  counterparty and per currency** — the same direct pairwise ledger
  `groupLedger` shows — not on the net position, so owing A while being
  owed the same by B still blocks. Expenses of every status count, as in
  the client. Messages are user-facing and shown verbatim; wording is
  first-person when `auth.uid()` is the leaver, third-person when an owner
  removes someone. **Cascades pass**: the trigger returns early when the
  group or the profile row is already gone in the transaction (group
  delete / account delete), so those paths behave as before. Self-check DO
  block asserts the helper is SECURITY DEFINER and non-executable by
  `authenticated`/`anon`, the trigger is exactly BEFORE DELETE ROW, and
  the function owner. Verified live via a rolled-back DO block (11 cases:
  clean co-owner leaves, owed owner blocked, sole owner blocked after
  co-owner removed, net-zero-but-pairwise-open blocked, owner removing an
  indebted member blocked, leave allowed after settling, non-owner remove
  still 0 rows under RLS, group delete cascades with open balances, profile
  delete cascades, helper not callable). Generated types unchanged.
  UI: `GroupActions` takes `leaveBlocker: "sole-owner" | "unsettled" |
  null` (replaces `canLeave`) and shows a hint instead of the Leave button
  (`myDebts.length > 0` on the group page, matching the trigger); an
  owner's remove attempt on an indebted member surfaces the trigger
  message inline under the member row (existing error slot).

- **Unequal splits** in `ExpenseForm`: a "Split method" segmented control
  (Equally / Amounts / Shares / Percent) beside "Split between". Checkboxes
  still choose the participants; in the non-equal modes each ticked member
  gets a small input (exact amount in the expense currency, integer share
  count, or percentage with up to two decimals) and a live computed share.
  All modes resolve to one `Map<userId, minorUnits>` via `planSplit`,
  which also produces the footer status line ("₹300 of ₹500 assigned ·
  ₹200 left", "33.33% of 100% assigned · 66.67% left", "too small to split
  N ways like this") and the save-blocking error; the save then writes those
  rows exactly as before (delete → update → insert), so the DB sum invariant
  is unchanged. Proportional modes use `splitByWeights` in
  `packages/shared/src/money.ts` — largest-remainder allocation with BigInt
  intermediates so parts always sum exactly to the total; percentages are
  integer basis points (`PERCENT_BASIS`, `parsePercentToBasisPoints`,
  `basisPointsToInputValue`). Switching method prefills only blank inputs
  (equal shares of the amount / "1" / 100 ÷ n) so typed numbers survive
  toggling; a member ticked while in Shares mode gets "1", in the other
  modes the user must fill their value. Editing an expense whose saved rows
  are not an equal split opens in Amounts mode with the saved amounts (the
  rows only record outcomes, not the method used). `splitsChanged` now
  compares people *and* amounts (`sameShares`). No schema change.

Not yet built (immediate next steps, in rough order):
1. **"Paid by multiple people"** for one expense — needs a design decision
   first: the schema has a single payer (`expenses.user_id`), so either a
   `expense_payers` table (mirror of `expense_splits`, sum = amount, ledger
   credits each payer) or a client-side "save as N expenses" shortcut.
2. **Simplify debts** toggle per group on top of `groupLedger` (note:
   `has_unsettled_balance` is pairwise; a simplified view would need the
   guard to judge on net position instead, or the UI would show "settled"
   while the DB still blocks).
3. **Group activity polish**: expense detail view with every participant's
   share; edit a recorded payment (needs an UPDATE policy for either party).
4. **Invite links** in the members dialog.
5. PWA config (manifest + service worker), then deploy to Vercel.

## Backlog (future — capture, don't build until scheduled)

- **Notifications** system (in-app; new table) — including on-behalf-expense
  notification events to group members. Phase 2-ish migration.
- **Location-based currency default** (app logic): if the user grants location,
  default their currency to the local one; else USD; also a preferred-currency
  setting in the profile.
- **Group reports & charts**: extend `/stats` with a group scope —
  per-person breakdown and spending over time (other members' categories
  are invisible under RLS, so category share needs a design decision) — a
  read/aggregation feature, no schema change needed. Also decide whether
  personal stats should include group expenses the user paid (or their
  split share); today they are excluded.
- **"Simplify debts"** (net out intermediary debts into fewer payments) as
  a per-group toggle on top of the pairwise ledger in `lib/balances.ts`
  (greedy largest-creditor/largest-debtor matching; pure computation, no
  schema change beyond a `groups.simplify_debts` flag). Settle-up records
  exist (migration 006).
- **Deleted profiles vs. splits**: leaving with an open balance is now
  blocked (migration 007), but a profile delete still cascades through
  `group_members` (the guard lets cascades pass) and the participant's
  split rows, which the sum check then rejects. Decide what happens to a
  deleted profile's shares. Needed before any account-deletion feature.
- **"Paid by multiple people"** on one expense (unequal splits are done;
  see the next-steps list for the schema question).
- **Group activity feed** interleaving expenses and payments by date (the
  Splitwise group timeline), and a "Friends"-style cross-group view of
  what you owe each person overall.
- **Settle-up niceties**: "settle all" for one counterparty across
  currencies, edit a recorded payment (would need an UPDATE policy for
  either party), reminders/nudges (needs Notifications), and a per-expense
  detail view listing every participant's share (today only the viewer's
  position is shown on the row).
- **Personal stats vs. group spend**: decide whether `/stats` should count
  the user's split share of group expenses (today group expenses are
  excluded entirely).
- **Invite links** for groups (token table + join RPC) as an alternative to
  add-by-email, which reveals whether an email has an account. Belongs in
  the members dialog next to add-by-email.
- **Group ownership transfer**: the last-owner guard (migration 007) now
  means a sole owner can only delete the group, never hand it over. Add a
  `transfer_group_ownership` RPC (atomic demote+promote; there is no
  UPDATE grant/policy on `group_members` by design). Later migration.
- **Constrain `expenses.status` at insert** — a client can currently set
  `confirmed` directly. Only matters once Phase 2's approve/reject workflow
  exists.
- **Custom SMTP** for Supabase auth emails before production. Confirmed
  2026-09-04: the built-in mailer returns `over_email_send_rate_limit`
  ("email rate limit exceeded") after a few signups per hour project-wide,
  so creating more than one or two accounts in quick succession fails at
  `/signup`. Fix = Authentication → SMTP Settings (Resend / Brevo / Postmark
  free tier), then raise the limit under Authentication → Rate Limits.
  Meanwhile: create test users from the dashboard (Authentication → Users →
  Add user, "Auto Confirm User" — no email, signup trigger still seeds
  profile + categories), or temporarily disable "Confirm email" for local
  dev (re-enable before real users). Also map that error code to a friendly
  message in `login-form.tsx` (today it shows the raw Supabase text).
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
