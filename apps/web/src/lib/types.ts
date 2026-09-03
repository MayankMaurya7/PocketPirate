import type { Tables } from "@expense-tracker/shared";

/** The category fields the UI needs (picker options, list badges). */
export type CategoryOption = Pick<
  Tables<"categories">,
  "id" | "name" | "color" | "icon"
>;

/** An expense row with its category joined in (null = uncategorised). */
export type ExpenseWithCategory = Tables<"expenses"> & {
  categories: CategoryOption | null;
};
