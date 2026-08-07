import { describe, expect, it, vi } from "vitest";
import type { FinanceReadPort, FinanceUnitOfWork } from "./ports";
import {
  FinanceService,
  type TransactionDraft,
} from "./financeService";
import { ValidationError } from "./validation";
import type {
  Account,
  AccountId,
  AuditEntryId,
  CategoryId,
  CurrencyCode,
  Transaction,
  TransactionId,
} from "../finance/types";

const USD = "USD" as CurrencyCode;
const sourceId = "source" as AccountId;
const destinationId = "destination" as AccountId;
const existingId = "existing" as TransactionId;
const now = "2026-07-28T10:00:00.000Z";

function account(id: AccountId, currency = USD, status: Account["status"] = "active"): Account {
  return {
    id, currency, status, name: String(id), type: "checking",
    color: "blue", icon: "landmark",
    createdAt: now, updatedAt: now,
  };
}

const existing: Transaction = {
  id: existingId, type: "expense", status: "completed", purpose: "standard",
  amount: 100 as Transaction["amount"],
  currency: USD, effectiveAt: now, sourceAccountId: sourceId,
  categoryId: "food" as CategoryId, description: "Old",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
};

function setup(overrides: Partial<Record<"transactionId" | "auditId", string>> = {}) {
  const reads: FinanceReadPort = {
    getAccount: vi.fn(async (id) => id === sourceId ? account(sourceId) : id === destinationId ? account(destinationId) : undefined),
    getTransaction: vi.fn(async (id) => id === existingId ? existing : undefined),
  };
  const uow: FinanceUnitOfWork = {
    createTransaction: vi.fn(async () => undefined),
    replaceTransaction: vi.fn(async () => undefined),
    deleteTransaction: vi.fn(async () => undefined),
  };
  const clock = vi.fn(() => now);
  const service = new FinanceService({
    reads, uow, clock,
    transactionId: () => (overrides.transactionId ?? "new") as TransactionId,
    auditId: () => (overrides.auditId ?? "audit") as AuditEntryId,
  });
  return { service, reads, uow, clock };
}

const expense: TransactionDraft = {
  type: "expense", status: "completed", amount: "2.50",
  date: "2026-07-28", sourceAccountId: "source",
  categoryId: " food ", note: "  lunch  ",
};

describe("FinanceService", () => {
  it.each(["edit", "delete"] as const)(
    "rejects %s of opening-balance transactions",
    async (operation) => {
      const { service, reads } = setup();
      vi.mocked(reads.getTransaction).mockResolvedValue({
        ...existing,
        purpose: "opening-balance",
        categoryId: "system:opening-balance" as CategoryId,
      });
      const result = operation === "edit"
        ? service.edit(existingId, expense)
        : service.delete(existingId);
      await expect(result).rejects.toMatchObject({
        code: "OPENING_BALANCE_PROTECTED",
        field: "transactionId",
      });
    },
  );
  it("creates a validated transaction and deterministic audit in one unit of work call", async () => {
    const { service, uow, clock } = setup();
    const result = await service.create(expense);
    expect(result).toMatchObject({
      id: "new",
      categoryId: "food",
      description: "lunch",
      amount: 250,
      currency: USD,
      effectiveAt: "2026-07-28T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(uow.createTransaction).toHaveBeenCalledOnce();
    expect(uow.createTransaction).toHaveBeenCalledWith(result, {
      id: "audit", timestamp: now, action: "transaction.created",
      entityType: "transaction", entityId: "new", description: "Transaction created",
    });
  });

  it("rejects an unknown runtime transaction type before reads or writes", async () => {
    const { service, reads, uow } = setup();
    const malformed = {
      ...expense,
      type: "refund",
      destinationAccountId: "destination",
    } as unknown as TransactionDraft;
    await expect(service.create(malformed)).rejects.toMatchObject({
      code: "INVALID_TYPE",
      field: "type",
    });
    expect(reads.getAccount).not.toHaveBeenCalled();
    expect(reads.getTransaction).not.toHaveBeenCalled();
    expect(uow.createTransaction).not.toHaveBeenCalled();
  });

  it("creates an income with its exact shape and audit", async () => {
    const { service, uow, clock } = setup();
    const result = await service.create({
      type: "income", status: "planned", amount: "0.75",
      date: "2026-07-28", destinationAccountId: "destination",
      categoryId: "salary",
    });
    expect(result).toEqual({
      id: "new", type: "income", status: "planned", purpose: "standard",
      amount: 75, currency: USD,
      effectiveAt: "2026-07-28T00:00:00.000Z",
      destinationAccountId: destinationId,
      categoryId: "salary", createdAt: now, updatedAt: now,
    });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(uow.createTransaction).toHaveBeenCalledTimes(1);
    expect(uow.createTransaction).toHaveBeenCalledWith(result, {
      id: "audit", timestamp: now, action: "transaction.created",
      entityType: "transaction", entityId: "new", description: "Transaction created",
    });
  });

  it("creates a transfer with its exact shape and audit", async () => {
    const { service, uow, clock } = setup();
    const result = await service.create({
      type: "transfer", status: "completed", amount: "0.50",
      date: "2026-07-28", sourceAccountId: "source",
      destinationAccountId: "destination",
    });
    expect(result).toEqual({
      id: "new", type: "transfer", status: "completed", purpose: "standard",
      amount: 50, currency: USD,
      effectiveAt: "2026-07-28T00:00:00.000Z",
      sourceAccountId: sourceId, destinationAccountId: destinationId,
      createdAt: now, updatedAt: now,
    });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(uow.createTransaction).toHaveBeenCalledTimes(1);
    expect(uow.createTransaction).toHaveBeenCalledWith(result, {
      id: "audit", timestamp: now, action: "transaction.created",
      entityType: "transaction", entityId: "new", description: "Transaction created",
    });
  });

  it.each([
    [{ ...expense, amount: "0" }, "INVALID_AMOUNT", "amount"],
    [{ ...expense, amount: "999999999999999999999999" }, "INVALID_AMOUNT", "amount"],
    [{ ...expense, date: "today" }, "INVALID_DATE", "date"],
    [{ ...expense, categoryId: "   " }, "REQUIRED", "categoryId"],
    [{ ...expense, categoryId: "x".repeat(65) }, "INVALID_CATEGORY", "categoryId"],
    [{ ...expense, note: "x".repeat(241) }, "INVALID_NOTE", "note"],
    [{ ...expense, note: "before\u0000after" }, "INVALID_NOTE", "note"],
    [{ ...expense, date: "2026-02-30" }, "INVALID_DATE", "date"],
  ] as const)("rejects invalid drafts", async (draft, code, field) => {
    const { service, uow } = setup();
    await expect(service.create(draft)).rejects.toMatchObject({ code, field });
    expect(uow.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects missing and archived account references", async () => {
    for (const [accountValue, code] of [
      [undefined, "ACCOUNT_NOT_FOUND"],
      [account(sourceId, USD, "archived"), "ACCOUNT_ARCHIVED"],
    ] as const) {
      const { service, reads } = setup();
      vi.mocked(reads.getAccount).mockResolvedValue(accountValue);
      await expect(service.create(expense)).rejects.toMatchObject({ code, field: "sourceAccountId" });
    }
  });

  it("requires distinct same-currency transfer accounts", async () => {
    const { service, reads } = setup();
    await expect(service.create({
      type: "transfer", status: "completed", amount: "0.01",
      date: "2026-07-28", sourceAccountId: "source",
      destinationAccountId: "source",
    })).rejects.toMatchObject({ code: "SAME_ACCOUNT", field: "destinationAccountId" });
    vi.mocked(reads.getAccount).mockImplementation(async (id) =>
      id === sourceId ? account(sourceId) : account(destinationId, "EUR" as CurrencyCode));
    await expect(service.create({
      type: "transfer", status: "completed", amount: "0.01",
      date: "2026-07-28", sourceAccountId: "source",
      destinationAccountId: "destination",
    })).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
  });

  it("omits a blank description", async () => {
    const { service } = setup();
    expect(await service.create({ ...expense, note: "  " })).not.toHaveProperty("description");
  });

  it("edits while preserving identity and creation time", async () => {
    const { service, uow, clock } = setup();
    const result = await service.edit("existing", { ...expense, amount: "3.00" });
    expect(result).toMatchObject({ id: existingId, createdAt: existing.createdAt, updatedAt: now, amount: 300 });
    expect(clock).toHaveBeenCalledTimes(1);
    expect(uow.replaceTransaction).toHaveBeenCalledTimes(1);
    expect(uow.replaceTransaction).toHaveBeenCalledWith(existing, result, expect.objectContaining({
      action: "transaction.updated", entityId: existingId, description: "Transaction updated", timestamp: now,
    }));
  });

  it("fetches before delete and writes a deterministic audit", async () => {
    const { service, reads, uow, clock } = setup();
    await service.delete("existing");
    expect(reads.getTransaction).toHaveBeenCalledWith(existingId);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(uow.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(uow.deleteTransaction).toHaveBeenCalledWith(existing, expect.objectContaining({
      action: "transaction.deleted", entityId: existingId, description: "Transaction deleted", timestamp: now,
    }));
  });

  it("rejects missing edit and delete targets without unit of work calls", async () => {
    const { service, reads, uow } = setup();
    vi.mocked(reads.getTransaction).mockResolvedValue(undefined);
    await expect(service.edit("missing", expense)).rejects.toMatchObject({
      code: "TRANSACTION_NOT_FOUND", field: "transactionId",
    });
    await expect(service.delete("missing")).rejects.toMatchObject({
      code: "TRANSACTION_NOT_FOUND", field: "transactionId",
    });
    expect(uow.replaceTransaction).not.toHaveBeenCalled();
    expect(uow.deleteTransaction).not.toHaveBeenCalled();
  });

  it("rejects empty or colliding generated IDs", async () => {
    await expect(setup({ transactionId: "" }).service.create(expense)).rejects.toBeInstanceOf(ValidationError);
    await expect(setup({ transactionId: "same", auditId: "same" }).service.create(expense))
      .rejects.toMatchObject({ code: "ID_COLLISION", field: "auditId" });
  });

  it("propagates unit of work rejection without retry", async () => {
    const { service, uow } = setup();
    vi.mocked(uow.createTransaction).mockRejectedValue(new Error("storage failed"));
    await expect(service.create(expense)).rejects.toThrow("storage failed");
    expect(uow.createTransaction).toHaveBeenCalledTimes(1);
  });

  it("propagates edit and delete rejections without retry", async () => {
    const editSetup = setup();
    vi.mocked(editSetup.uow.replaceTransaction).mockRejectedValue(new Error("edit failed"));
    await expect(editSetup.service.edit("existing", expense))
      .rejects.toThrow("edit failed");
    expect(editSetup.uow.replaceTransaction).toHaveBeenCalledTimes(1);
    expect(editSetup.clock).toHaveBeenCalledTimes(1);

    const deleteSetup = setup();
    vi.mocked(deleteSetup.uow.deleteTransaction).mockRejectedValue(new Error("delete failed"));
    await expect(deleteSetup.service.delete("existing"))
      .rejects.toThrow("delete failed");
    expect(deleteSetup.uow.deleteTransaction).toHaveBeenCalledTimes(1);
    expect(deleteSetup.clock).toHaveBeenCalledTimes(1);
  });

  it("rejects system categories for standard entries and all categories on transfers", async () => {
    const { service } = setup();
    await expect(service.create({
      ...expense,
      categoryId: "system:opening-balance",
    })).rejects.toMatchObject({
      code: "INVALID_CATEGORY",
      field: "categoryId",
    });
    await expect(service.create({
      type: "transfer",
      status: "completed",
      amount: "0.01",
      date: "2026-07-28",
      sourceAccountId: "source",
      destinationAccountId: "destination",
      categoryId: "food",
    } as unknown as TransactionDraft)).rejects.toMatchObject({
      code: "INVALID_CATEGORY",
      field: "categoryId",
    });
  });

  it("enforces the fixed category catalog and transaction-type ownership on create", async () => {
    const { service, uow } = setup();
    await expect(service.create({
      ...expense,
      categoryId: "my-unregistered-category",
    })).rejects.toMatchObject({
      code: "INVALID_CATEGORY",
      field: "categoryId",
    });
    await expect(service.create({
      ...expense,
      categoryId: "salary",
    })).rejects.toMatchObject({
      code: "INVALID_CATEGORY",
      field: "categoryId",
    });
    expect(uow.createTransaction).not.toHaveBeenCalled();
  });

  it("preserves an unchanged imported legacy category on edit but rejects changing to another unknown category", async () => {
    const legacy = {
      ...existing,
      categoryId: "legacy-groceries" as CategoryId,
    };
    const preserved = setup();
    vi.mocked(preserved.reads.getTransaction).mockResolvedValue(legacy);

    await expect(preserved.service.edit("existing", {
      ...expense,
      categoryId: "legacy-groceries",
    })).resolves.toMatchObject({ categoryId: "legacy-groceries" });

    const changed = setup();
    vi.mocked(changed.reads.getTransaction).mockResolvedValue(legacy);
    await expect(changed.service.edit("existing", {
      ...expense,
      categoryId: "new-unknown",
    })).rejects.toMatchObject({
      code: "INVALID_CATEGORY",
      field: "categoryId",
    });
    expect(changed.uow.replaceTransaction).not.toHaveBeenCalled();
  });
});
