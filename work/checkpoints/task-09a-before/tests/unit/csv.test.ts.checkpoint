import { describe, expect, it } from "vitest";
import { amountToDecimalString, serializeTransactionsCsv } from "../../src/export/csv";
import type { Transaction } from "../../src/finance/types";

const transaction = { id: "expense-1", type: "expense", status: "completed", amount: 12345, currency: "USD", effectiveAt: "2026-07-28T10:20:30.000Z", description: `=HYPERLINK("bad"), groceries`, sourceAccountId: "checking", categoryId: "+food", createdAt: "2026-07-28T10:20:30.000Z", updatedAt: "2026-07-28T10:20:30.000Z" } as Transaction;
describe("transaction CSV", () => {
  it("uses stable headers, CRLF, final newline, quoting, and formula hardening", () => {
    expect(serializeTransactionsCsv([transaction])).toBe("id,type,status,effectiveAt,description,amount,currency,sourceAccountId,destinationAccountId,categoryId\r\n" + `expense-1,expense,completed,2026-07-28T10:20:30.000Z,"'=HYPERLINK(""bad""), groceries",123.45,USD,checking,,'+food\r\n`);
  });
  it("hardens all user-controlled cells", () => {
    const csv = serializeTransactionsCsv([{ ...transaction, id: "@id", description: "\tcmd", sourceAccountId: "-account" } as Transaction]);
    expect(csv).toContain("'@id"); expect(csv).toContain("'\tcmd"); expect(csv).toContain("'-account");
  });
  it("hardens a user-controlled cell beginning with LF and quotes it", () => {
    const csv = serializeTransactionsCsv([{
      ...transaction,
      description: "\n=1+1",
    } as Transaction]);
    expect(csv).toContain(`,"'\n=1+1",`);
  });
  it.each([[5, "JPY", "5"], [5, "USD", "0.05"], [5, "KWD", "0.005"], [-12345, "USD", "-123.45"], [Number.MAX_SAFE_INTEGER, "USD", "90071992547409.91"]] as const)(
    "formats %s minor %s exactly", (amount, currency, expected) => expect(amountToDecimalString(amount, currency)).toBe(expected),
  );
});
