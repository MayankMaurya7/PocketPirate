# Expense Tracker

A personal finance expense tracker where users manually log expenses with custom categories, view filtered lists (by category, user, or history), create shared groups (e.g. flatmates tracking household expenses), and see spending stats for today, week, month, and year. Built as a Turborepo + pnpm monorepo with a Next.js PWA client talking directly to a Supabase backend (Postgres + RLS, Auth, Edge Functions, Realtime). Later phases add voice entry with LLM parsing and a React Native mobile app.

## Structure

- `apps/web` — Next.js (App Router) web app / installable PWA
- `packages/shared` — shared TypeScript code (`@expense-tracker/shared`)
- `supabase/` — Supabase project (migrations, functions) — added in later phases

## Prerequisites

- Node.js 20 LTS (see `.nvmrc`)
- pnpm 9+ (`corepack enable pnpm`)

## Getting started

```bash
pnpm install      # install all workspace dependencies
pnpm dev          # run all apps in dev mode (web at http://localhost:3000)
pnpm build        # build all apps and packages
pnpm lint         # lint the workspace
```
