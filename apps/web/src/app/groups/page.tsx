import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { AddGroup } from "@/components/add-group";
import { AppHeader } from "@/components/app-header";
import { ChevronRightIcon } from "@/components/icons";
import type { GroupSummary } from "@/lib/types";

export default async function GroupsPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  const userId = data.claims.sub;

  // RLS limits `groups` to ones the user belongs to, and `group_members` to
  // rows of those same groups — so the embed is the full member list.
  const { data: groups } = await supabase
    .from("groups")
    .select("id, name, created_at, group_members(user_id, role)")
    .order("created_at", { ascending: false });

  const groupList: GroupSummary[] = (groups ?? []).map(
    ({ group_members, ...group }) => ({
      ...group,
      memberCount: group_members.length,
      role:
        group_members.find((member) => member.user_id === userId)?.role ??
        "member",
    }),
  );

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="groups" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Groups
          </h1>
        </div>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Track shared spending with flatmates, trips or family.
        </p>

        <div className="mt-6">
          <AddGroup />
        </div>

        {groupList.length === 0 ? (
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              No groups yet
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Create one and add members by their email address.
            </p>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {groupList.map((group) => (
              <li key={group.id}>
                <Link
                  href={`/groups/${group.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-zinc-50 sm:gap-4 sm:px-5 sm:py-4 dark:hover:bg-zinc-800/60"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  >
                    {group.name.trim().charAt(0).toUpperCase() || "G"}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {group.name}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                      {group.memberCount} member
                      {group.memberCount === 1 ? "" : "s"}
                      {group.role === "owner" && " · Owner"}
                    </p>
                  </div>

                  <ChevronRightIcon />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
