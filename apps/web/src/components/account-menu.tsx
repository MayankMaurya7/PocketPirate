"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { LogOutIcon, SettingsIcon } from "@/components/icons";

/**
 * The gear button at the right of the header. Opens a small panel with the
 * signed-in account and "Sign out" — the home for account-level settings
 * (theme, profile) as they arrive, so the header itself stays a wordmark,
 * the tabs and one icon on every screen size.
 *
 * Closes on Escape, on a click outside, and after navigating. Plain
 * disclosure semantics (aria-expanded + aria-controls) rather than a
 * WAI-ARIA menu, which would also need arrow-key handling.
 */
export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleSignOut() {
    setPending(true);

    const supabase = createClient();
    await supabase.auth.signOut();

    // refresh() re-runs the server components without the session cookies,
    // so a back-navigation to "/" redirects instead of showing stale content.
    router.push("/login");
    router.refresh();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account and settings"
        aria-expanded={open}
        aria-controls={panelId}
        className={`rounded-lg p-2 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-50 ${
          open
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        <SettingsIcon />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="px-2.5 py-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Signed in as</p>
          <p
            className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100"
            title={email}
          >
            {email || "Unknown account"}
          </p>
        </div>

        <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />

        <button
          type="button"
          onClick={handleSignOut}
          disabled={pending}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <LogOutIcon />
          {pending ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
