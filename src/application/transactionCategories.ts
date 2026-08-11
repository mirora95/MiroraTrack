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

const CUSTOM_PREFIX = "custom:";

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Custom categories carry their own label inside the identifier, so they need
 * no separate store: every existing validator resolves them through
 * `categoryFor`. The slug is case-folded and whitespace-collapsed so the same
 * name always yields the same id, which is what lets a budget aggregate the
 * transactions a user filed under the name they typed.
 *
 * `custom:expense:` plus this length stays inside the 64 character ceiling
 * that `financeService` and `dashboardService` enforce on category ids.
 */
export const MAX_CUSTOM_CATEGORY_LENGTH = 48;

export function customCategorySlug(label: string): string | undefined {
  const slug = label.trim().toLowerCase().replace(/\s+/g, " ");
  if (
    slug.length === 0 ||
    slug.length > MAX_CUSTOM_CATEGORY_LENGTH ||
    slug.includes(":") ||
    hasControlCharacter(slug)
  ) return undefined;
  return slug;
}

export function customCategoryId(
  label: string,
  type: TransactionCategory["type"],
): CategoryId | undefined {
  const slug = customCategorySlug(label);
  if (!slug) return undefined;
  return `${CUSTOM_PREFIX}${type}:${slug}` as CategoryId;
}

export function parseCustomCategory(
  value: string,
): TransactionCategory | undefined {
  if (!value.startsWith(CUSTOM_PREFIX)) return undefined;
  const rest = value.slice(CUSTOM_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator < 0) return undefined;
  const type = rest.slice(0, separator);
  const slug = rest.slice(separator + 1);
  if (type !== "income" && type !== "expense") return undefined;
  if (customCategorySlug(slug) !== slug) return undefined;
  return {
    id: value as CategoryId,
    label: slug.charAt(0).toUpperCase() + slug.slice(1),
    type,
  };
}

export function isCustomCategoryId(value: string): boolean {
  return parseCustomCategory(value) !== undefined;
}

/**
 * Built-in categories of `type`, followed by any custom ones discovered in
 * `knownIds` — the records already saved plus whatever the caller is editing.
 */
export function categoryOptions(
  type: TransactionCategory["type"],
  knownIds: Iterable<string> = [],
): readonly TransactionCategory[] {
  const custom = new Map<string, TransactionCategory>();
  for (const value of knownIds) {
    const parsed = parseCustomCategory(value);
    if (parsed && parsed.type === type) custom.set(parsed.id as string, parsed);
  }
  return [
    ...TRANSACTION_CATEGORIES.filter((item) => item.type === type),
    ...[...custom.values()].sort((left, right) =>
      left.label.localeCompare(right.label)
    ),
  ];
}

export function categoryFor(
  value: string,
  type: "income" | "expense",
): TransactionCategory | undefined {
  const item = byId.get(value) ?? parseCustomCategory(value);
  return item?.type === type ? item : undefined;
}

export function categoryLabel(value: string): string {
  return (byId.get(value) ?? parseCustomCategory(value))?.label ?? "Other";
}
