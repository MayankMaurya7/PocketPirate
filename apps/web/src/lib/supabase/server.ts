import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@expense-tracker/shared";

/**
 * Supabase client for use in Server Components, Server Actions and Route
 * Handlers.
 *
 * A new client is created per request — never share one across requests, since
 * each carries the caller's session. Authorization is enforced by Postgres RLS,
 * never by this client.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. Safe
          // to ignore: the middleware refreshes the session and writes the
          // updated cookies to the response on every request.
        }
      },
    },
  });
}
