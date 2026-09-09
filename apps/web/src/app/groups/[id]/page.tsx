import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/expense-filters";
import { groupLedger } from "@/lib/balances";
import { toGroupInvite } from "@/lib/invites";
import { EXPENSE_SELECT, toGroupOption, totalsByCurrency } from "@/lib/expenses";
import { AddExpenseFab } from "@/components/add-expense-fab";
import { AppHeader } from "@/components/app-header";
import { BalanceSummary } from "@/components/balance-summary";
import { DebtItem } from "@/components/debt-item";
import { EditPolicyToggle } from "@/components/edit-policy-toggle";
import { GroupActions, type LeaveBlocker } from "@/components/group-actions";
import { GroupTimeline } from "@/components/group-timeline";
import { MembersDialog } from "@/components/members-dialog";
import { SimplifyDebtsToggle } from "@/components/simplify-debts-toggle";
import {
  type ActivityEntry,
  type ExpenseListItem,
  type GroupInvite,
  type GroupMember,
  type MemberLabels,
  type Settlement,
  memberLabel,
} from "@/lib/types";

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
  const { data: group, error: groupError } = await supabase
    .from("groups")
    .select(
      "id, name, created_at, simplify_debts, edit_policy, group_members(user_id, role, joined_at, profiles(id, display_name, email, avatar_url))",
    )
    .eq("id", id)
    .maybeSingle();

  // A failed query (e.g. a column the database does not have yet) is not
  // "no such group" — surface it instead of rendering a misleading 404.
  if (groupError) {
    throw new Error(`Could not load group: ${groupError.message}`);
  }

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

  const [
    { data: categories },
    { data: expenses },
    { data: settlements },
    { data: invite },
    { data: activity },
  ] = await Promise.all([
      supabase.from("categories").select("id, name, color, icon").order("name"),
      supabase
        .from("expenses")
        .select(EXPENSE_SELECT)
        .eq("group_id", group.id)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("settlements")
        .select("*")
        .eq("group_id", group.id)
        .order("settled_on", { ascending: false })
        .order("created_at", { ascending: false }),
      // RLS only returns the row to owners; everyone else gets null.
      supabase
        .from("group_invites")
        .select("token, expires_at")
        .eq("group_id", group.id)
        .maybeSingle(),
      // The trail of edits and deletions (migration 013), newest first.
      supabase
        .from("group_activity")
        .select("*")
        .eq("group_id", group.id)
        .order("created_at", { ascending: false }),
    ]);

  const categoryList = categories ?? [];
  const groupOption = toGroupOption(group);
  const expenseList: ExpenseListItem[] = expenses ?? [];
  const settlementList: Settlement[] = settlements ?? [];
  const activityList: ActivityEntry[] = activity ?? [];
  const inviteLink: GroupInvite | null = invite ? toGroupInvite(invite) : null;
  const totals = totalsByCurrency(expenseList);
  const labels: MemberLabels = Object.fromEntries(
    members.map((member) => [member.user_id, memberLabel(member.profiles)]),
  );
  // Balances only mean something once money has moved between members;
  // until then the section and the member column stay hidden.
  const hasLedger =
    settlementList.length > 0 ||
    expenseList.some((expense) => expense.expense_splits.length > 0);
  const { debts, balances } = groupLedger(expenseList, settlementList, {
    simplify: group.simplify_debts,
  });
  const myDebts = debts.filter(
    (debt) => debt.from === userId || debt.to === userId,
  );
  const otherDebts = debts.filter(
    (debt) => debt.from !== userId && debt.to !== userId,
  );
  // Mirrors the group_members delete trigger: the sole owner cannot leave,
  // and neither can anyone with an open debt. The trigger reads the same
  // simplify_debts flag as the ledger above, so "in no debt here" and "may
  // leave" agree in both modes (direct: a net-zero member with offsetting
  // debts is still blocked; simplified: they are not).
  const leaveBlocker: LeaveBlocker | null =
    isOwner && ownerCount === 1
      ? "sole-owner"
      : myDebts.length > 0
        ? "unsettled"
        : null;

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <AppHeader email={email} current="groups" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-28 pt-6 sm:pt-10">
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
            leaveBlocker={leaveBlocker}
            userId={userId}
          />
        </div>

        <div className="mt-2">
          <MembersDialog
            groupId={group.id}
            members={members}
            userId={userId}
            isOwner={isOwner}
            balances={balances}
            showBalances={hasLedger}
            invite={inviteLink}
          />
        </div>

        {hasLedger && (
          <section className="mt-8">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Balances
              </h2>
              <SimplifyDebtsToggle
                groupId={group.id}
                enabled={group.simplify_debts}
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {group.simplify_debts
                ? "Simplified into fewer payments from everyone's net position, so you may owe someone you never split with. Settle a debt by recording what was paid outside the app."
                : "Direct debts from split expenses and recorded payments between two people. Settle a debt by recording what was paid outside the app."}
            </p>

            <div className="mt-3">
              <BalanceSummary balance={balances.get(userId) ?? []} />
            </div>

            {debts.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                Everyone is settled up.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
                {[...myDebts, ...otherDebts].map((debt) => (
                  <DebtItem
                    key={`${debt.from}|${debt.to}|${debt.currency}`}
                    groupId={group.id}
                    userId={userId}
                    debt={debt}
                    labels={labels}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Activity
              {expenseList.length > 0 && (
                <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
                  {expenseList.length} expense{expenseList.length === 1 ? "" : "s"} ·{" "}
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

          <div className="mt-2">
            <EditPolicyToggle
              groupId={group.id}
              policy={group.edit_policy}
              isOwner={isOwner}
            />
          </div>

          <div className="mt-3">
            <GroupTimeline
              expenses={expenseList}
              settlements={settlementList}
              activity={activityList}
              categories={categoryList}
              groups={[groupOption]}
              userId={userId}
              labels={labels}
            />
          </div>
        </section>
      </main>

      <AddExpenseFab
        categories={categoryList}
        groups={[groupOption]}
        userId={userId}
        defaultGroupId={group.id}
      />
    </div>
  );
}
