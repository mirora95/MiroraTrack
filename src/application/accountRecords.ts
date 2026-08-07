import { currencyCode } from "../finance/money";
import { minorAmount } from "../finance/types";
import type {
  Account,
  AccountColor,
  AccountIcon,
  AccountId,
  AccountType,
  AuditEntry,
  AuditEntryId,
  CurrencyCode,
  Transaction,
  TransactionId,
} from "../finance/types";
import { ValidationError, requiredId } from "./validation";

export const OPENING_BALANCE_CATEGORY = "system:opening-balance" as const;

export interface AccountDraft {
  readonly name: string;
  readonly type: AccountType;
  readonly currency: string;
  readonly color: AccountColor;
  readonly icon: AccountIcon;
  readonly creditLimit?: number;
  readonly openingBalance: number;
}

const types: readonly AccountType[] = [
  "cash", "checking", "savings", "credit", "investment", "other",
];
const colors: readonly AccountColor[] = [
  "blue", "teal", "gold", "purple", "green", "slate",
];
const icons: readonly AccountIcon[] = [
  "banknote", "landmark", "piggy-bank", "credit-card", "chart-line", "wallet",
];

export function validateAccountDraft(
  draft: AccountDraft,
): Omit<Account, "id" | "status" | "createdAt" | "updatedAt"> {
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 60) {
    throw new ValidationError("INVALID_ACCOUNT_NAME", "name");
  }
  if (!types.includes(draft.type)) {
    throw new ValidationError("INVALID_ACCOUNT_TYPE", "type");
  }
  if (!colors.includes(draft.color)) {
    throw new ValidationError("INVALID_ACCOUNT_COLOR", "color");
  }
  if (!icons.includes(draft.icon)) {
    throw new ValidationError("INVALID_ACCOUNT_ICON", "icon");
  }
  let currency: CurrencyCode;
  try {
    currency = currencyCode(draft.currency);
  } catch {
    throw new ValidationError("INVALID_CURRENCY", "currency");
  }
  if (!Number.isSafeInteger(draft.openingBalance)) {
    throw new ValidationError("INVALID_AMOUNT", "openingBalance");
  }
  if (
    draft.creditLimit !== undefined &&
    (!Number.isSafeInteger(draft.creditLimit) || draft.creditLimit < 0)
  ) {
    throw new ValidationError("INVALID_CREDIT_LIMIT", "creditLimit");
  }
  if (draft.type !== "credit" && draft.creditLimit !== undefined) {
    throw new ValidationError("CREDIT_LIMIT_NOT_ALLOWED", "creditLimit");
  }
  return {
    name, type: draft.type, currency, color: draft.color, icon: draft.icon,
    ...(draft.type === "credit" && draft.creditLimit !== undefined
      ? { creditLimit: minorAmount(draft.creditLimit) }
      : {}),
  };
}

export function openingTransaction(
  account: Account,
  amount: number,
  id: TransactionId,
): Transaction | undefined {
  if (amount === 0) return undefined;
  const absolute = amount < 0 ? -BigInt(amount) : BigInt(amount);
  if (absolute > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError("INVALID_AMOUNT", "openingBalance");
  }
  const shared = {
    id,
    status: "completed" as const,
    purpose: "opening-balance" as const,
    amount: minorAmount(Number(absolute)),
    currency: account.currency,
    effectiveAt: account.createdAt,
    categoryId: OPENING_BALANCE_CATEGORY as never,
    createdAt: account.createdAt,
    updatedAt: account.createdAt,
  };
  return amount > 0
    ? { ...shared, type: "income", destinationAccountId: account.id }
    : { ...shared, type: "expense", sourceAccountId: account.id };
}

export function accountAudit(
  id: AuditEntryId,
  accountId: AccountId,
  timestamp: string,
  action: Extract<AuditEntry["action"], `account.${string}`>,
): AuditEntry {
  return {
    id, timestamp, action, entityType: "account", entityId: accountId,
    description: action === "account.created" ? "Account created"
      : action === "account.updated" ? "Account updated"
        : action === "account.archived" ? "Account archived"
          : "Account reactivated",
  };
}

export function transactionAudit(
  id: AuditEntryId,
  transactionId: TransactionId,
  timestamp: string,
): AuditEntry {
  return {
    id, timestamp, action: "transaction.created", entityType: "transaction",
    entityId: transactionId, description: "Opening balance created",
  };
}

export function validatedId<T extends string>(
  value: T,
  field: string,
): T {
  return requiredId(value, field) as T;
}
