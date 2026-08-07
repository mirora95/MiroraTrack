import type { CategoryId } from "../finance/types";

export interface TransactionCategory {
  readonly id: CategoryId;
  readonly label: string;
  readonly type: "income" | "expense";
}

const category = (
  id: string,
  label: string,
  type: TransactionCategory["type"],
): TransactionCategory => ({ id: id as CategoryId, label, type });

export const TRANSACTION_CATEGORIES: readonly TransactionCategory[] = [
  category("salary", "Salary", "income"),
  category("freelance", "Freelance", "income"),
  category("interest", "Interest", "income"),
  category("gifts", "Gifts", "income"),
  category("refunds", "Refunds", "income"),
  category("other-income", "Other income", "income"),
  category("housing", "Housing", "expense"),
  category("food", "Food", "expense"),
  category("transport", "Transport", "expense"),
  category("utilities", "Utilities", "expense"),
  category("health", "Health", "expense"),
  category("entertainment", "Entertainment", "expense"),
  category("shopping", "Shopping", "expense"),
  category("education", "Education", "expense"),
  category("travel", "Travel", "expense"),
  category("taxes", "Taxes", "expense"),
  category("other-expense", "Other expense", "expense"),
] as const;

const byId = new Map(
  TRANSACTION_CATEGORIES.map((item) => [item.id as string, item]),
);

export function categoryFor(
  value: string,
  type: "income" | "expense",
): TransactionCategory | undefined {
  const item = byId.get(value);
  return item?.type === type ? item : undefined;
}

export function categoryLabel(value: string): string {
  return byId.get(value)?.label ?? "Other";
}
