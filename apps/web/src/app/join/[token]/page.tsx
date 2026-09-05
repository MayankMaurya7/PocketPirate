import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { JoinGroup } from "@/components/join-group";

export const metadata: Metadata = {
  title: "Join a group · Spendwise",
};

/** What a token looks like (migration 011): 64 lowercase hex characters. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/**
 * Landing page for an invite link. Signed-out visitors go through /login
 * (sign in or sign up) and come back here via `next`; signed-in ones see
 * the group behind the token and a Join button. The preview RPC returns
 * nothing for an unknown or expired token — the only thing a link holder
 * can learn from a bad guess is that it was bad.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect(`/login?next=${encodeURIComponent(`/join/${token}`)}`);
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";

  let preview: {
    group_id: string;
    group_name: string;
    member_count: number;
    already_member: boolean;
    invited_by: string | null;
  } | null = null;

  if (TOKEN_SHAPE.test(token)) {
    const { data: rows, error } = await supabase.rpc("preview_group_invite", {
      _token: token,
    });
    if (error) {
      throw new Error(`Could not read invite: ${error.message}`);
    }
    preview = rows[0] ?? null;
  }

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="groups" />

      <main className="mx-auto flex w-full max-w-3xl flex-1 items-start justify-center px-4 py-16">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {preview === null ? (
            <>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                This invite link is invalid or has expired
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Ask whoever sent it to share a fresh link from the group&apos;s
                members list.
              </p>
              <Link
                href="/groups"
                className="mt-6 inline-block text-sm font-medium text-emerald-700 underline-offset-4 hover:underline dark:text-emerald-400"
              >
                Go to your groups
              </Link>
            </>
          ) : preview.already_member ? (
            <>
              <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                You&apos;re already in {preview.group_name}
              </h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Nothing to do — the link you opened is for a group you belong to.
              </p>
              <Link
                href={`/groups/${preview.group_id}`}
                className="mt-6 inline-block rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700"
              >
                Open {preview.group_name}
              </Link>
            </>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {preview.invited_by
                  ? `${preview.invited_by} invited you to join`
                  : "You've been invited to join"}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {preview.group_name}
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {preview.member_count}{" "}
                {preview.member_count === 1 ? "person" : "people"} so far
              </p>
              <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Members see each other&apos;s name and email, and every expense
                logged in the group.
              </p>
              <div className="mt-6">
                <JoinGroup token={token} groupName={preview.group_name} />
              </div>
              <Link
                href="/groups"
                className="mt-4 inline-block text-sm text-zinc-500 underline-offset-4 hover:underline dark:text-zinc-400"
              >
                Not now
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
