import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@expense-tracker/shared";

/**
 * Supabase client for use in browser (Client Component) code.
 *
 * Reads the public project URL and anon key from the environment. Both are
 * safe to ship to the browser — authorization is enforced by Postgres RLS,
 * never by the client.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
