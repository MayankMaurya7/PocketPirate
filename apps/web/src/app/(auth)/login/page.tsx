import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in · Spendwise",
  description: "Sign in or create your Spendwise account.",
};

export default async function LoginPage() {
  // Someone who already has a session has no business on the login page.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12 font-sans dark:bg-zinc-950">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-base font-bold text-white">
            S
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Spendwise
          </span>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {/* LoginForm reads searchParams for callback errors, which needs
              a Suspense boundary during prerender. */}
          <Suspense fallback={<div className="h-[420px]" />}>
            <LoginForm />
          </Suspense>
        </div>

        <p className="mt-6 text-center text-xs leading-5 text-zinc-500 dark:text-zinc-500">
          Track expenses solo or with your flatmates.
        </p>
      </div>
    </main>
  );
}
