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

## Commands

```bash
pnpm install    # install workspace deps
pnpm dev        # run all apps (web at http://localhost:3000)
pnpm build      # build everything
pnpm lint       # lint everything
```
