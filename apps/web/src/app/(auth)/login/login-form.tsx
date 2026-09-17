"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

import { safeRelativePath } from "@/lib/safe-path";
import { createClient } from "@/lib/supabase/client";

/**
 * Google is the only way in for now. Email + password sign-in was removed
 * until custom SMTP is configured (the built-in mailer rate-limits signups);
 * it lives in git history should it come back. Signing in and creating an
 * account are the same action with OAuth, so there is no signup toggle.
 */
export function LoginForm() {
  const searchParams = useSearchParams();
  // The callback route bounces OAuth failures back here with the reason in
  // the query string.
  const callbackError = searchParams.get("error");
  // Where to land after signing in — set by pages that need a session, such
  // as an invite link. Relative paths only (never an open redirect).
  const nextPath = safeRelativePath(searchParams.get("next")) ?? "/";
  const joiningGroup = nextPath.startsWith("/join/");

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignIn() {
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Google comes back through /callback, which sets the session
        // cookies and forwards to `next`.
        redirectTo: `${window.location.origin}/callback${
          nextPath === "/" ? "" : `?next=${encodeURIComponent(nextPath)}`
        }`,
      },
    });

    // On success the browser is navigating away to Google, so we deliberately
    // leave `pending` set — only an error puts the button back in play.
    if (oauthError) {
      setError(oauthError.message);
      setPending(false);
    }
  }

  const visibleError = error ?? callbackError;

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Welcome to PocketPirate
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          {joiningGroup
            ? "Sign in to join the group you were invited to."
            : "Track where your money goes, solo or with your flatmates."}
        </p>
      </div>

      {visibleError && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          {visibleError}
        </p>
      )}

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={pending}
        className="mt-8 flex w-full items-center justify-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:ring-offset-zinc-950"
      >
        {pending ? <Spinner /> : <GoogleLogo />}
        {pending ? "Redirecting to Google…" : "Continue with Google"}
      </button>

      <p className="mt-6 text-center text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        New here? Continuing with Google creates your account.
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className="h-4 w-4 animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        className="opacity-25"
      />
      <path
        fill="currentColor"
        className="opacity-75"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="h-4.5 w-4.5">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
