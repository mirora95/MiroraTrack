import type {
  AccountId,
  CategoryId,
  CurrencyCode,
  IncomeTransaction,
  MinorAmount,
  TransactionId,
} from "./types";

const validIncome = {
  id: "" as TransactionId,
  type: "income",
  status: "completed",
  purpose: "standard",
  amount: 1 as MinorAmount,
  currency: "" as CurrencyCode,
  effectiveAt: "2026-07-28",
  destinationAccountId: "" as AccountId,
  categoryId: "" as CategoryId,
  createdAt: "2026-07-28",
  updatedAt: "2026-07-28",
} satisfies IncomeTransaction;

void validIncome;

const invalidIncome = {
  id: "" as TransactionId,
  type: "income",
  status: "completed",
  purpose: "standard",
  amount: 1 as MinorAmount,
  currency: "" as CurrencyCode,
  effectiveAt: "2026-07-28",
  destinationAccountId: "" as AccountId,
  categoryId: "" as CategoryId,
  sourceAccountId: undefined,
  createdAt: "2026-07-28",
  updatedAt: "2026-07-28",
};

// @ts-expect-error Income transactions must omit sourceAccountId entirely.
invalidIncome satisfies IncomeTransaction;
