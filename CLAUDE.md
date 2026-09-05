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
  confirmed in dashboard). Google OAuth configured 2026-09-06: Google Cloud
  project "SpendWise" (OAuth client "SpendWise web", redirect URI
  `https://ymsixpeyipgtetfucnkp.supabase.co/auth/v1/callback`), provider
  enabled in Supabase with "allow without email" OFF, Site URL
  `http://localhost:3000`, redirect allow-list `http://localhost:3000/**`.
  Add the production origin (`https://<host>/**`) when deploying.
- **Authenticated home page** at `/`: server component using `getClaims()`,
  redirects signed-out users to `/login`; header (wordmark, nav tabs,
  account menu — see "Mobile layout" for the current `AppHeader`).
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
  (wordmark + nav + account menu) used by `/` and `/categories`; list-row
  icons live in `components/icons.tsx`.
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
  trade-off: an owner learns whether an email has an account — invite links
  (migration 011) avoid this. Co-members can see each other's email via the
  existing profiles SELECT policy.
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
  `authenticated` (no UPDATE until migration 010 added a column-level
  one). RLS: SELECT for
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
  when adding new row types or actions. **The slot only exists from `sm`
  up** (see "Mobile layout" below): on phones the actions wrap onto their
  own line under the amount (`w-full` + `flex-wrap` on the row; a row
  without actions renders a `hidden sm:block` placeholder instead) and the
  debt row stacks amount over button, so amounts still share the right
  edge without stealing width from the name.

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
  owed the same by B still blocks (since migration 009 this is the
  `simplify_debts = false` branch; when on, net position decides).
  Expenses of every status count, as in the client. Messages are user-facing and shown verbatim; wording is
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

- **Migration 008** applied — `expense_payers` (`expense_id`, `user_id`,
  `amount_minor_units > 0`; PK (expense_id, user_id); cascade from both
  FKs; index on `user_id`), a mirror of `expense_splits` for **"paid by
  multiple people"** (design decision 2026-09-05: table, not a "save as N
  expenses" client shortcut). **No payer rows = `expenses.user_id` paid it
  all** (every existing row). With rows: they must sum exactly to
  `amount_minor_units` and **must include `expenses.user_id`**, which stays
  the "primary" payer so single-payer readers (lists, stats, SELECT policy)
  keep working. Grants: REVOKE ALL then `select, insert, delete` to
  `authenticated` (no UPDATE — replace the set). RLS: SELECT if you can
  read the expense, INSERT only by `created_by` for a group expense with a
  payer who is a current member, DELETE by `created_by`. Invariant via two
  DEFERRABLE INITIALLY DEFERRED constraint triggers —
  `expense_payers_check_sum` (row changes) and `expenses_check_payers`
  (UPDATE OF amount_minor_units, group_id, **user_id**; refuses a group
  change while payer rows exist) — around
  `private.assert_expense_payers(uuid)`. Client save order becomes: delete
  splits → delete payers → update expense → insert payers → insert splits.
  **Ledger rule for several payers (the client must mirror it exactly):**
  per split expense, each person's net = paid − share; creditors sorted by
  net desc then user_id, debtors by |net| desc then user_id, each side laid
  end to end along [0, D); a debtor owes a creditor the overlap of their
  intervals. Exact integers, deterministic, reduces to the old rule for one
  payer. `private.has_unsettled_balance` (migration 007) was rewritten on
  this rule (same signature/grants). Verified live via a rolled-back DO
  block (14 cases: multi-payer save, guard attribution 300/100 zeroed by
  matching settlements, sum mismatch, user_id not a payer, outsider payer
  42501, non-creator write, amount / user_id / group change while payers
  exist, personal-expense payers, re-record flow, single-payer regression,
  member/outsider/anon reads, cascades). Types regenerated
  (`expense_payers` only).
- **Multi-payer ledger + display** (client reads payer rows; the form
  still writes none): `packages/shared/src/ledger.ts` holds the
  attribution so mobile can reuse it — `attributeExpenseDebts(payers,
  splits)` (net-then-overlap as a two-pointer sweep over creditors sorted
  net desc / debtors |net| desc, ties by plain `<` on user_id, never
  `localeCompare`), `expensePayers(expense)` (rows, or `[user_id →
  amount]` when there are none) and `expenseNetFor(userId, …)` (paid,
  share, net). Cross-checked against the migration's SQL CTE over VALUES
  via `db query`: 40 random cases, 128 debts, identical. `groupLedger`
  (`lib/balances.ts`) now skips un-split expenses and feeds every split
  one through `attributeExpenseDebts`, so debts, member balances and the
  leave guard's `myDebts` mirror agree with `has_unsettled_balance`.
  `EXPENSE_SELECT` embeds `expense_payers(user_id, amount_minor_units)`;
  `ExpenseListItem.expense_payers` / `ExpensePayer` in `lib/types.ts`.
  `ExpenseItem` meta says "Paid by Alice, Bob and you" for several payers
  (largest amount first, viewer last as "you", the primary payer's label
  from the embedded profile, others from the `GroupOption` members, a
  missing member = "a former member"); the position line under the
  amount is now paid − share: "you lent" (green) / "you borrowed" (red) /
  "even" (paid exactly your share; new label) / "not involved". The
  timeline and the home list get this for free.
- **Multi-payer form** (`ExpenseForm`): the "Paid by" select gains a
  "Several people…" option (only when the group has more than one member)
  that opens a "Who paid what" member list — checkbox + amount per payer,
  the previously selected payer pre-ticked — with a live footer ("₹300 of
  ₹500 paid · ₹200 left", "Tick everyone who paid.") that also blocks the
  save. Exact-amount parsing/summing is shared with the Amounts split
  mode (`planExactAmounts`; the split plan's field is now `amounts`, the
  row comparer `sameAmounts`). Two or more payers write `expense_payers`
  rows; exactly one resolves to a plain `user_id` with no rows. The
  primary payer (`expenses.user_id`) is the last single choice if they
  paid, else the largest payer, ties by id (`primaryPayer`) — balances
  come from the rows, so the choice is cosmetic. Save order is delete
  splits → delete payers → update → insert payers → insert splits. Payer
  rows are rewritten when the amount, group, primary payer or rows
  change; split rows when the amount, group or shares change; a delete
  is skipped when the row is known to have none. A `rowsDirty` flag is
  set once a save has deleted rows, so a retry after a half-failed write
  rewrites both sets regardless of the stale `expense` prop. Editing an
  expense with payer rows opens in several mode with its rows; switching
  group resets to a single payer. Verified live via a rolled-back
  transaction as the creator (create with 2 payers / 3 splits, edit
  changing amount + primary payer + rows, back to one payer, and a
  primary-payer change with rows present correctly refused).
- **Migration 009** applied —
  `groups.simplify_debts boolean not null default false` plus a rewrite of
  `private.has_unsettled_balance` (same signature/grants/caller) that
  reads the flag: **pairwise** per counterparty when off (as before),
  **net position per currency** when on. Both come from the same `mine`
  CTE (the member's net with each counterparty) over migration 008's
  unchanged ledger CTE; a missing group row coalesces to pairwise. No new
  grant or policy: owners flip the flag through the existing table-wide
  UPDATE grant + owner-only policy. Self-check asserts the column shape,
  that `authenticated` may update it and `anon` cannot read it, that the
  function is SECURITY DEFINER, non-executable by API roles and mentions
  `simplify_debts`. Verified live via a rolled-back `db query` run of the
  migration + a DO block (7 cases: net-zero-but-pairwise-open member
  blocked when off / allowed when on, net −100 blocked when on, allowed
  after settling the simplified debt, sole owner still blocked, all three
  pairwise debts blocked again after switching off, helper returns
  true/false across the flip).
- **Simplify debts** toggle on `/groups/[id]`: `groupLedger(expenses,
  settlements, { simplify })` (`lib/balances.ts`) still builds the pairwise
  ledger and the net balances, then, when on, folds every member's net
  position per currency through `debtsFromNets` — the overlap sweep
  extracted from `attributeExpenseDebts` in `packages/shared/src/ledger.ts`
  (same deterministic rule, so a member is in a simplified debt **iff**
  their net ≠ 0, which is exactly what the guard checks; balances are
  identical in both modes). Not minimum-transfer in general (NP-hard):
  in ~1% of random ledgers the sweep yields more rows than the direct
  view, never more than members − 1. `SimplifyDebtsToggle` (client
  `role="switch"`, in the Balances section header; disabled read-out for
  non-owners with a tooltip) updates `groups.simplify_debts` with
  `.select("id").maybeSingle()` so a policy-filtered update surfaces as
  "Only an owner can change this", then `router.refresh()`. The section
  copy switches between "Direct debts … between two people" and
  "Simplified into fewer payments … you may owe someone you never split
  with". Settle-up, `DebtItem`, `MemberItem` and the leave blocker
  (`myDebts.length > 0`) are unchanged and stay consistent with the
  trigger in both modes. Runtime-checked over 500 random ledgers
  (balances equal across modes, in-debt ⇔ net ≠ 0, simplified debts sum
  to each net).

- **Expense details dialog**: on any group expense row (group timeline and
  `/`), the title is a button opening `ExpenseDetails` in the shared `Modal`
  ("Expense details"): header (title, long date, category if visible, group,
  "Added by …", added time, amount), a "Paid by" list (largest first), a
  "Split N ways" list of every participant's share, and "Who owes whom for
  this" — `attributeExpenseDebts(payers, splits)` rendered as "X owes Y"
  rows (viewer's red/green), i.e. exactly the per-expense debts the group
  ledger sums, with an un-split expense saying it changes no balance.
  "Edit expense" in the footer (creator only) closes the dialog and opens
  the inline `ExpenseForm`. `expenseMemberNamer(expense, groups, userId)`
  (exported from `expense-details.tsx`) is the one place that names people
  on an expense — "you", the primary payer from the embedded profile,
  current members from the `GroupOption`, else "a former member"; the
  `sentence` option capitalises only those two placeholders — and
  `ExpenseItem`'s meta line now uses it too. Personal expense titles stay
  plain text (nothing beyond the row to show). No schema change.

- **Migration 010** applied — editing a recorded payment. A **column-level**
  `grant update (amount_minor_units, settled_on, note)` on `settlements`
  to `authenticated` (no table-wide UPDATE, so `has_table_privilege`
  stays false and writes to `from_user_id`, `to_user_id`, `group_id`,
  `created_by`, `currency` fail 42501 at the grant layer) plus
  `settlements_update_party_members`: USING = WITH CHECK = the caller is
  a party **and both parties are current members** (stricter than
  DELETE, which only needs the caller to be a member: a former member's
  balance is zero by construction and can never be settled again, so an
  edit must not reopen one). Self-check asserts 4 policies, the exact
  column set via `has_column_privilege`, and nothing for `anon`. Verified
  in a rolled-back DO block (12 cases: payer/payee edit 1 row, third
  member 0 rows, party/currency/recorder/group columns 42501, zero amount
  23514, anon 42501, edit after the counterparty leaves 0 rows while
  delete still works). No type change (grants only).
- **Edit a recorded payment**: `SettleUpForm` takes either `debt` (record)
  or `settlement` (edit) — edit mode prefills amount/date/note, titles
  "Edit payment" / "Save changes", drops the "owed" hint, notes that who
  paid whom is fixed (delete and re-record to turn it around), and
  updates with `.select("id").maybeSingle()` so a policy-filtered update
  shows an explanatory error instead of silently succeeding.
  `SettlementItem` gets a pencil in its `w-15` slot (before the trash)
  for a party while both parties are in `labels`, opening the form
  inline in place of the row like expense rows do.

- **Migration 011** applied — `group_invites` (`group_id` **unique** →
  one live link per group, cascade; `token` unique, `^[0-9a-f]{64}$` =
  two `gen_random_uuid()`s since pgcrypto is not installed; `created_by`
  cascade from profiles; `expires_at`, set to **30 days** on create).
  Grants: REVOKE ALL then `select, delete` to `authenticated` (no
  INSERT/UPDATE — only the RPC writes). RLS: SELECT and DELETE for owners
  only (`private.is_group_owner`), so the token never reaches a
  non-owner. Three SECURITY DEFINER RPCs, EXECUTE to `authenticated`
  only: `create_group_invite(_group_id) → token` (owner check, deletes
  the old row and mints a fresh token + expiry = "reset"),
  `preview_group_invite(_token) → table(group_id, group_name,
  member_count, already_member, invited_by)` (zero rows for an unknown or
  expired token; `invited_by` is the inviter's display name only, never
  their email, since links get forwarded) and `accept_group_invite(_token)
  → group_id` (inserts a `member` row; no-op if already a member; raises
  "This invite link is invalid or has expired."). Self-check covers RLS,
  policy count, exact grants, the PUBLIC ACL entry, the unique group_id
  and, per function, EXECUTE for authenticated / none for anon /
  SECURITY DEFINER. Verified live via a rolled-back `db query` run of the
  migration + a 16-case DO block (create, reset rotates, member/outsider
  refused, outsider sees no row, preview as outsider, bogus/stale token
  empty, accept joins as member, second accept no-op, already_member,
  member sees/deletes nothing, UPDATE 42501, expired token refused,
  anon EXECUTE/SELECT 42501, owner delete, group-delete cascade). Types
  regenerated.
- **Invite links UI**: `InviteLink` (owner-only, top of the members
  dialog above add-by-email): "Create link" → readonly URL
  `<origin>/join/<token>` + Copy (clipboard, "Copied" for 2 s), expiry
  date ("This link has expired. Reset it…" in red when past — judged by
  the server via `toGroupInvite` in `lib/invites.ts` because the React
  purity lint forbids `Date.now()` in render), Reset (RPC again) and
  Remove (RLS delete). The page fetches `group_invites` for the group
  with `.maybeSingle()` — RLS hands it back only to owners — and passes
  `GroupInvite | null` (`lib/types.ts`) to `MembersDialog`. `/join/[token]`
  (server page): signed-out → `redirect("/login?next=/join/<token>")`;
  signed-in → `preview_group_invite` → "invalid or expired" card, "You're
  already in X" with an Open link, or "<name> invited you to join X · N
  people so far" with `JoinGroup` (client button → `accept_group_invite`
  → `router.replace("/groups/<id>")`). **Login `next` support**:
  `lib/safe-path.ts` `safeRelativePath` (relative path only; rejects
  `//`, absolute URLs and backslashes — used by `/callback`, `/login` and
  the form). `/login` redirects an already-signed-in visitor to `next`,
  the form sends password sign-in to `next`, and both email-confirmation
  (`emailRedirectTo`) and Google (`redirectTo`) go to
  `/callback?next=…`, which already forwarded to `next`. The form's
  subtitle says "Sign in / Create an account to join the group you were
  invited to" when `next` starts with `/join/`. **Note**: Supabase's
  redirect allow-list must accept `/callback?next=…` — gotrue matches on
  hostname against the Site URL, so a same-host deploy passes, but add
  `https://<host>/callback**` (or `/**`) under Authentication → URL
  Configuration when deploying.
- **Mobile layout** (single breakpoint, Tailwind `sm` = 640px; the layout
  was desktop-only before and fell apart at 375px). **`AppHeader`** =
  wordmark, the nav as **underline tabs** (`NAV` array; active tab
  `border-b-2 border-emerald-600`, `aria-current="page"`; the nav has
  `-mb-px` so the underline meets the header's bottom border) and an
  **`AccountMenu`** (gear icon, `components/account-menu.tsx`: a
  disclosure panel — aria-expanded/controls, not an ARIA menu — with
  "Signed in as <email>" and Sign out; closes on Escape / outside
  pointerdown; this is where theme and profile settings should go later).
  The old `SignOutButton` is gone. On phones the tabs form their own
  full-width row under the wordmark + gear (`order-last basis-full`, each
  tab `flex-1`); from `sm` up they sit inline (`sm:self-stretch`) on one
  4rem line. **Bare `grid` is a trap**: an implicit `auto` column sizes to
  the widest child, so a list of `truncate` rows overflows — always give
  the grid `grid-cols-1` (= `minmax(0,1fr)`) as the expense form's payer
  and split lists now do (this was the horizontal scroll in the New
  expense dialog). List rows (expense,
  payment, debt, member, category, group list) use `gap-3 px-4 py-3` on
  phones and the old `gap-4 px-5 py-4` from `sm`; expense/payment action
  icons and the debt row's button move under the amount on phones (see
  the row alignment convention). `Modal` pads `p-4 sm:p-5` and caps at
  `85dvh`. The home filter bar's category select + Clear take a full line
  under the date chips on phones (`w-full sm:ml-auto sm:w-auto`, select
  `flex-1`). Page `main` padding is `py-6 sm:py-10`. Group title is
  `min-w-0 break-words` with `shrink-0` action buttons. Stats was already
  responsive (2-up tiles, `sm:` grid in `CategoryBars`, `ResizeObserver`
  chart). Not done: safe-area insets for the FAB, a bottom-sheet modal.

- **PWA config**: `app/manifest.ts` (Next file convention → served at
  `/manifest.webmanifest`, link tag auto-injected): name/short_name
  "Spendwise", `start_url`/`scope`/`id` = `/`, `display: standalone`,
  `theme_color` brand emerald `#059669` (splash + title bar before load),
  `background_color` `#fafafa`. Icons: white bold "S" on emerald —
  `public/icons/icon-192.png`, `icon-512.png` (rounded corners, purpose
  any) and `icon-maskable-512.png` (full-bleed); `app/icon.svg` (favicon)
  and `app/apple-icon.png` (180, full-bleed, iOS masks it) are picked up
  by Next's icon conventions. Rasterised once with macOS `qlmanage` from
  an SVG (no rsvg/ImageMagick on the machine); regenerate the same way if
  the mark changes. Root layout `metadata`: `applicationName`, title
  template `%s · Spendwise` (login/join page titles are now the bare
  segment), `appleWebApp` (Next 16 emits the standard
  `mobile-web-app-capable` meta, not the `apple-` one); `viewport.themeColor`
  follows the header per colour scheme (`#ffffff` / `#18181b`). The
  create-next-app `favicon.ico` and the five boilerplate SVGs in `public/`
  were removed. **Service worker** `public/sw.js` (hand-written, no
  library), registered by `components/service-worker.tsx` from the root
  layout in **production only** — in dev it unregisters any worker on the
  origin so a stale `next start` worker can't break HMR. Policy: page HTML
  is **never cached** (every page is live per-user data); navigations are
  network-only with a precached `/offline` fallback (static page,
  `app/offline/page.tsx` + `RetryButton`; the worker also precaches the
  `/_next/static` assets its HTML references so it renders styled while
  offline); `/_next/static/*` is cache-first (content-hashed, capped at 200
  entries, oldest dropped); everything else — Supabase, RSC payload
  fetches, route handlers, non-GET — passes through untouched.
  `skipWaiting` on install + `clients.claim` (safe because no HTML is
  cached), navigation preload enabled, `VERSION` constant to drop caches.
  `next.config.ts` sets `Cache-Control: public, max-age=0,
  must-revalidate` on `/sw.js`; the middleware matcher skips `sw.js`,
  `manifest.webmanifest`, `icons/` and `.ico`. Verified with headless
  Chromium against `next start`: worker active, offline page + 12 assets
  precached, offline navigation served from the worker fully styled,
  static chunks 12/12 via the worker, RSC fetch still `text/x-component`
  from the network, back online restores real pages. Not done: an
  "update available" toast (a new deploy's worker takes over on the next
  navigation anyway), install prompt UI, safe-area insets.

- **Confirm dialog** (`components/confirm-dialog.tsx`) replaces every
  `window.confirm` (there were seven, all destructive: delete expense /
  payment / category / group, leave group, remove member, remove invite
  link; there were no `alert()`s — errors already render inline with
  `role="alert"`). A native `<dialog>` with `role="alertdialog"`,
  `aria-labelledby`/`describedby`, `max-w-sm`, red warning badge for the
  `danger` tone, consequence-first description, verb-labelled confirm
  button ("Delete expense", never "OK") and Cancel first in DOM order so it
  takes the initial focus; Escape and the backdrop cancel (ignored while
  pending). **The caller owns the async work**: it passes `pending` and
  `error` in, runs the action from `onConfirm`, and flips `open` off on
  success — so the dialog stays up with "Deleting…" while the request runs
  and shows a failure (e.g. the leave-guard trigger message) inside itself
  instead of vanishing. Buttons stack on phones (primary on top) and sit
  right-aligned from `sm`. `useNativeDialog(open)` was extracted from
  `Modal` (showModal/close + body scroll lock) and is shared by both. Rule:
  **never call `window.confirm` / `alert` / `prompt`** — use
  `ConfirmDialog` for confirmations and the inline `role="alert"` slots
  for errors. `AlertTriangleIcon` added to `icons.tsx`.

Not yet built (immediate next steps, in rough order):
1. Deploy to Vercel (root directory `apps/web`, env vars
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; then add
   `https://<host>/**` to Supabase's redirect allow-list and set the Site
   URL — see the Auth UI and Invite links notes above).

## Backlog (future — capture, don't build until scheduled)

- **Account menu contents**: a theme switch (System / Light / Dark) and a
  profile/display-name editor inside `AccountMenu`. Theme needs Tailwind's
  `dark:` variant moved from `prefers-color-scheme` to a `data-theme`
  attribute (`@custom-variant dark`) plus a persisted preference applied
  before hydration to avoid a flash.
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
- **Deleted profiles vs. splits**: leaving with an open balance is now
  blocked (migration 007), but a profile delete still cascades through
  `group_members` (the guard lets cascades pass) and the participant's
  split rows (and, since migration 008, their payer rows), which the sum
  checks then reject. Decide what happens to a deleted profile's shares.
  Needed before any account-deletion feature.
- **Group activity feed** interleaving expenses and payments by date (the
  Splitwise group timeline), and a "Friends"-style cross-group view of
  what you owe each person overall.
- **Settle-up niceties**: "settle all" for one counterparty across
  currencies, and reminders/nudges (needs Notifications). Editing a
  payment is done (migration 010); changing its direction or currency is
  deliberately delete-and-re-record.
- **Personal stats vs. group spend**: decide whether `/stats` should count
  the user's split share of group expenses (today group expenses are
  excluded entirely).
- **Invite-link niceties**: multiple links per group / per-link expiry
  choice / "never expires" (today: one link, fixed 30 days, owner reset);
  a signed-out preview of the group name on `/login` (the preview RPC is
  `authenticated`-only on purpose); auto-join straight from `/join` after
  sign-up instead of a Join button.
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
