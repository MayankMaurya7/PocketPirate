"use client";

import { useState } from "react";

import { GroupForm } from "@/components/group-form";

/** "New group" button that expands into the create form. */
export function AddGroup() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-950"
      >
        New group
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        New group
      </h2>
      <GroupForm onDone={() => setOpen(false)} />
    </div>
  );
}
