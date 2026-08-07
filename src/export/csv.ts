import type { Transaction } from "../finance/types";

export const TRANSACTION_CSV_HEADERS = [
  "id", "type", "status", "effectiveAt", "description", "amount", "currency",
  "sourceAccountId", "destinationAccountId", "categoryId",
] as const;

export function amountToDecimalString(amount: number, currency: string): string {
  if (!Number.isSafeInteger(amount)) throw new RangeError("Amount must be a safe integer");
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError("Currency must be a three-letter uppercase code");
  const scale = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  if (scale < 0 || scale > 3) throw new RangeError("Unsupported currency scale");
  const negative = amount < 0;
  const digits = BigInt(amount < 0 ? -amount : amount).toString().padStart(scale + 1, "0");
  const decimal = scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return negative ? `-${decimal}` : decimal;
}

export function serializeTransactionsCsv(transactions: readonly Transaction[]): string {
  const rows = transactions.map((transaction) => {
    const values: Record<(typeof TRANSACTION_CSV_HEADERS)[number], string> = {
      id: transaction.id, type: transaction.type, status: transaction.status,
      effectiveAt: transaction.effectiveAt, description: transaction.description ?? "",
      amount: amountToDecimalString(transaction.amount, transaction.currency),
      currency: transaction.currency,
      sourceAccountId: "sourceAccountId" in transaction ? transaction.sourceAccountId : "",
      destinationAccountId: "destinationAccountId" in transaction ? transaction.destinationAccountId : "",
      categoryId: "categoryId" in transaction ? transaction.categoryId : "",
    };
    return TRANSACTION_CSV_HEADERS.map((header) => csvCell(values[header], isUserControlled(header))).join(",");
  });
  return `${TRANSACTION_CSV_HEADERS.join(",")}\r\n${rows.length ? `${rows.join("\r\n")}\r\n` : ""}`;
}

function isUserControlled(header: (typeof TRANSACTION_CSV_HEADERS)[number]): boolean {
  return header === "id" || header === "description" || header === "sourceAccountId" ||
    header === "destinationAccountId" || header === "categoryId";
}
function csvCell(input: string, userControlled: boolean): string {
  const value = userControlled && /^[=+\-@\t\r\n]/.test(input) ? `'${input}` : input;
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export const exportTransactionsCsv = serializeTransactionsCsv;
