import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/expense-filters";
import { EXPENSE_SELECT, toGroupOption, totalsByCurrency } from "@/lib/expenses";
import { AddExpense } from "@/components/add-expense";
import { AddMember } from "@/components/add-member";
import { AppHeader } from "@/components/app-header";
import { ExpenseList } from "@/components/expense-list";
import { GroupActions } from "@/components/group-actions";
import { MemberItem } from "@/components/member-item";
import type { ExpenseListItem, GroupMember } from "@/lib/types";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    redirect("/login");
  }

  const email = typeof data.claims.email === "string" ? data.claims.email : "";
  const userId = data.claims.sub;

  // A group the user is not a member of is filtered out by RLS, so "no row"
  // covers both "does not exist" and "not yours" — deliberately the same 404.
  const { data: group } = await supabase
    .from("groups")
    .select(
      "id, name, created_at, group_members(user_id, role, joined_at, profiles(id, display_name, email, avatar_url))",
    )
    .eq("id", id)
    .maybeSingle();

  if (!group) {
    notFound();
  }

  const members: GroupMember[] = [...group.group_members].sort((a, b) => {
    // Owners first, then by join order.
    if (a.role !== b.role) {
      return a.role === "owner" ? -1 : 1;
    }
    return a.joined_at.localeCompare(b.joined_at);
  });

  const me = members.find((member) => member.user_id === userId);
  const isOwner = me?.role === "owner";
  const ownerCount = members.filter((member) => member.role === "owner").length;

  const [{ data: categories }, { data: expenses }] = await Promise.all([
    supabase.from("categories").select("id, name, color, icon").order("name"),
    supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("group_id", group.id)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const categoryList = categories ?? [];
  const groupOption = toGroupOption(group);
  const expenseList: ExpenseListItem[] = expenses ?? [];
  const totals = totalsByCurrency(expenseList);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="groups" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Link
          href="/groups"
          className="text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          ← All groups
        </Link>

        <div className="mt-3">
          <GroupActions
            group={{ id: group.id, name: group.name }}
            isOwner={isOwner}
            canLeave={!isOwner || ownerCount > 1}
            userId={userId}
          />
        </div>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Members
              <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                {members.length}
              </span>
            </h2>
          </div>

          {isOwner && (
            <div className="mt-3">
              <AddMember groupId={group.id} />
            </div>
          )}

          <ul className="mt-3 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {members.map((member) => (
              <MemberItem
                key={member.user_id}
                groupId={group.id}
                member={member}
                isSelf={member.user_id === userId}
                canRemove={isOwner && member.user_id !== userId}
              />
            ))}
          </ul>
        </section>

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Expenses
              {expenseList.length > 0 && (
                <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                  {expenseList.length} ·{" "}
                  <span className="tabular-nums">{totals.join(" + ")}</span>
                </span>
              )}
            </h2>
            <Link
              href={`/?group=${group.id}`}
              className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Filter
            </Link>
          </div>

          <div className="mt-3">
            <AddExpense
              categories={categoryList}
              groups={[groupOption]}
              userId={userId}
              defaultGroupId={group.id}
            />
          </div>

          <div className="mt-3">
            <ExpenseList
              expenses={expenseList}
              categories={categoryList}
              groups={[groupOption]}
              userId={userId}
              showGroup={false}
              emptyTitle="No expenses in this group yet"
              emptyHint="Anyone in the group can add one, on their own or another member's behalf."
            />
          </div>
        </section>
      </main>
    </div>
  );
}
