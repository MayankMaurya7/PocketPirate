import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@expense-tracker/shared";

/**
 * Refreshes the Supabase auth session for an incoming request.
 *
 * Server Components cannot write cookies, so the middleware is what keeps
 * tokens fresh: it reads the request cookies, lets the Supabase client rotate
 * them if needed, and writes the results onto the response.
 *
 * No route protection here yet — this only refreshes the session.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Mirror the new cookies onto the request so anything reading them
        // later in this pass sees the refreshed values...
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // ...then rebuild the response so it carries that updated request,
        // and write the cookies onto it.
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached by a CDN or
        // reverse proxy, or one user's tokens could be served to another.
        for (const [key, headerValue] of Object.entries(headers)) {
          supabaseResponse.headers.set(key, headerValue);
        }
      },
    },
  });

  // Touch the session so an expired access token gets refreshed (and written
  // back through setAll) before the response is committed. Do not remove.
  await supabase.auth.getClaims();

  // Return this response as-is. If you construct a new response elsewhere,
  // copy over `supabaseResponse.cookies` or the session will be dropped.
  return supabaseResponse;
}
