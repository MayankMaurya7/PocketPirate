import { NextResponse, type NextRequest } from "next/server";

import { safeRelativePath } from "@/lib/safe-path";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / email-confirmation callback.
 *
 * Supabase redirects here with a `code` in the query string; exchanging it
 * sets the session cookies (written through the server client's `setAll`)
 * before we forward the user into the app.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const code = searchParams.get("code");
  // `next` lets a caller resume where they left off; only relative paths are
  // honoured so this can't be used as an open redirect.
  const next = safeRelativePath(searchParams.get("next")) ?? "/";

  if (!code) {
    // Supabase reports provider failures (e.g. a cancelled consent screen) as
    // `error` / `error_description` rather than a code.
    const description =
      searchParams.get("error_description") ??
      searchParams.get("error") ??
      "Missing authorization code.";

    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(description)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
