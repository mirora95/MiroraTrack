import { describe, expect, it, vi } from "vitest";

import { AccountService } from "./accountService";
import type { AccountReadPort, AccountUnitOfWork } from "./ports";
import type {
  Account,
  AccountId,
  AuditEntryId,
  CurrencyCode,
  Transaction,
  TransactionId,
  Settings,
} from "../finance/types";

const now = "2026-07-29T09:00:00.000Z";
const USD = "USD" as CurrencyCode;

function account(
  id: string,
  status: Account["status"] = "active",
): Account {
  return {
    id: id as AccountId,
    name: id,
    type: "checking",
    status,
    currency: USD,
    color: "blue",
    icon: "landmark",
    createdAt: now,
    updatedAt: now,
  };
}

function setup(accounts = [account("one"), account("two")], transactions: Transaction[] = []) {
  const reads: AccountReadPort = {
    getSettings: vi.fn(async () => ({
      key: "primary", baseCurrency: USD, locale: "en-US",
      dateFormat: "yyyy-MM-dd", defaultAccountId: "one" as AccountId,
      automaticBackupsEnabled: true,
    } as Settings)),
    listAccounts: vi.fn(async () => accounts),
    listTransactions: vi.fn(async () => transactions),
  };
  const uow: AccountUnitOfWork = {
    initialize: vi.fn(async () => undefined),
    createAccount: vi.fn(async () => undefined),
    updateAccount: vi.fn(async () => undefined),
    setAccountStatus: vi.fn(async () => undefined),
  };
  let audit = 0;
  const service = new AccountService({
    reads, uow, clock: () => now,
    accountId: () => "created" as AccountId,
    transactionId: () => "opening:created" as TransactionId,
    auditId: () => `audit:${++audit}` as AuditEntryId,
  });
  return { service, uow };
}

describe("AccountService", () => {
  it("lists ledger-derived balances per account currency", async () => {
    const income: Transaction = {
      id: "income" as TransactionId, type: "income", status: "completed",
      purpose: "standard", amount: 500 as never, currency: USD,
      effectiveAt: now, destinationAccountId: "one" as AccountId,
      categoryId: "salary" as never, createdAt: now, updatedAt: now,
    };
    const result = await setup(undefined, [income]).service.list();
    expect(result.map(({ account: item, balance }) => [item.id, balance]))
      .toEqual([["one", 500], ["two", 0]]);
  });

  it("creates a later account and opening record atomically", async () => {
    const { service, uow } = setup();
    await service.create({
      name: " Savings ", type: "savings", currency: "USD",
      color: "gold", icon: "piggy-bank", openingBalance: 300,
    });
    expect(uow.createAccount).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({ id: "created", name: "Savings" }),
      openingTransaction: expect.objectContaining({
        type: "income", purpose: "opening-balance", amount: 300,
      }),
    }));
  });

  it("passes account updates to the atomic UoW and preserves identity", async () => {
    const { service, uow } = setup();
    await service.update({
      id: "one", name: " Primary ", type: "credit", currency: "USD",
      color: "slate", icon: "credit-card", creditLimit: 10_000,
    });
    expect(uow.updateAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "one", name: "Primary", type: "credit", creditLimit: 10_000,
        createdAt: now,
      }),
      expect.objectContaining({ action: "account.updated" }),
    );
  });

  it("rejects invalid names and credit limits before writes", async () => {
    const { service, uow } = setup();
    await expect(service.create({
      name: " ", type: "cash", currency: "USD", color: "green",
      icon: "banknote", openingBalance: 0,
    })).rejects.toMatchObject({ code: "INVALID_ACCOUNT_NAME", field: "name" });
    await expect(service.create({
      name: "Cash", type: "cash", currency: "USD", color: "green",
      icon: "banknote", creditLimit: 100, openingBalance: 0,
    })).rejects.toMatchObject({
      code: "CREDIT_LIMIT_NOT_ALLOWED", field: "creditLimit",
    });
    expect(uow.createAccount).not.toHaveBeenCalled();
  });

  it("archives with deterministic default reassignment and supports reactivation", async () => {
    const { service, uow } = setup();
    await service.archive("one");
    expect(uow.setAccountStatus).toHaveBeenCalledWith(
      "one", "archived", "two",
      expect.objectContaining({ action: "account.archived" }),
    );
    await service.reactivate("one");
    expect(uow.setAccountStatus).toHaveBeenLastCalledWith(
      "one", "active", undefined,
      expect.objectContaining({ action: "account.reactivated" }),
    );
  });

  it("allows archiving the last active account and clears the default", async () => {
    const { service, uow } = setup([account("one")]);
    await service.archive("one");
    expect(uow.setAccountStatus).toHaveBeenCalledWith(
      "one", "archived", undefined, expect.anything(),
    );
  });
});
