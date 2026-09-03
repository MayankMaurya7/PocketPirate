/**
 * @expense-tracker/shared
 *
 * Shared types and utilities used across the web (and later mobile) clients.
 * Real code lands in later phases; this placeholder exists so the workspace
 * wiring can be verified end-to-end.
 */

/** Placeholder marker confirming the shared package resolves from clients. */
export const SHARED_PACKAGE_NAME = "@expense-tracker/shared" as const;

/** Generated Supabase schema types (`Database`, `Tables`, `Enums`, …). */
export * from "./database.types";

/** Integer-minor-unit money helpers (parse, format). */
export * from "./money";

/** Calendar-date helpers (local `YYYY-MM-DD` strings, preset ranges). */
export * from "./dates";
