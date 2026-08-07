import { describe, expect, it, vi } from "vitest";

import { InitializationService } from "./initializationService";
import type {
  AccountUnitOfWork,
  InitializationReadPort,
} from "./ports";
import type {
  Account,
  AccountId,
  AuditEntryId,
  CurrencyCode,
  TransactionId,
  Settings,
} from "../finance/types";

const now = "2026-07-29T08:00:00.000Z";
const USD = "USD" as CurrencyCode;

function account(id = "cash"): Account {
  return {
    id: id as AccountId,
    name: "Cash",
    type: "cash",
    status: "active",
    currency: USD,
    color: "green",
    icon: "banknote",
    createdAt: now,
    updatedAt: now,
  };
}

function setup(
  getSettings: InitializationReadPort["getSettings"] = vi.fn(async () => undefined),
  listAccounts: InitializationReadPort["listAccounts"] = vi.fn(async () => []),
) {
  const reads = { getSettings, listAccounts };
  const uow: AccountUnitOfWork = {
    initialize: vi.fn(async () => undefined),
    createAccount: vi.fn(async () => undefined),
    updateAccount: vi.fn(async () => undefined),
    setAccountStatus: vi.fn(async () => undefined),
  };
  const service = new InitializationService({
    reads,
    uow,
    clock: () => now,
    accountId: () => "cash" as AccountId,
    transactionId: () => "opening:cash" as TransactionId,
    auditId: (() => {
      const values = ["audit:account", "audit:opening"];
      return () => values.shift() as AuditEntryId;
    })(),
  });
  return { service, uow };
}

describe("InitializationService", () => {
  it("detects uninitialized, ready, and partial recovery states from IndexedDB reads", async () => {
    expect(await setup().service.getState()).toEqual({ status: "uninitialized" });
    expect(await setup(
      vi.fn(async () => ({
        key: "primary", baseCurrency: USD, locale: "en-US",
        dateFormat: "yyyy-MM-dd", defaultAccountId: "cash" as AccountId,
        automaticBackupsEnabled: true,
        automaticBackupIntervalHours: 24,
      } as Settings)),
      vi.fn(async () => [account()]),
    ).service.getState()).toEqual({ status: "ready" });
    expect((await setup(
      vi.fn(async () => ({
        key: "primary", baseCurrency: USD, locale: "en-US",
        dateFormat: "yyyy-MM-dd", automaticBackupsEnabled: true,
        automaticBackupIntervalHours: 24,
      } as Settings)),
    ).service.getState()).status).toBe("recovery-required");
  });

  it("treats malformed settings, duplicate accounts, and broken defaults as recovery-required", async () => {
    const valid = {
      key: "primary", baseCurrency: USD, locale: "en-US",
      dateFormat: "yyyy-MM-dd", automaticBackupsEnabled: true,
      automaticBackupIntervalHours: 24,
    } as Settings;
    expect((await setup(
      vi.fn(async () => ({ ...valid, baseCurrency: "usd" as never })),
      vi.fn(async () => [account()]),
    ).service.getState()).status).toBe("recovery-required");
    expect((await setup(
      vi.fn(async () => valid),
      vi.fn(async () => [account(), account()]),
    ).service.getState()).status).toBe("recovery-required");
    expect((await setup(
      vi.fn(async () => ({ ...valid, defaultAccountId: "missing" as AccountId })),
      vi.fn(async () => [account()]),
    ).service.getState()).status).toBe("recovery-required");
  });

  it("initializes settings, account, signed opening ledger record, and audits in one call", async () => {
    const { service, uow } = setup();
    await service.initialize({
      baseCurrency: "USD",
      locale: "en-US",
      dateFormat: "yyyy-MM-dd",
      account: {
        name: "  Main cash  ",
        type: "cash",
        currency: "USD",
        color: "green",
        icon: "banknote",
        openingBalance: -1250,
      },
    });

    expect(uow.initialize).toHaveBeenCalledOnce();
    expect(uow.initialize).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultAccountId: "cash" }),
      account: expect.objectContaining({ name: "Main cash" }),
      openingTransaction: expect.objectContaining({
        id: "opening:cash",
        type: "expense",
        purpose: "opening-balance",
        amount: 1250,
        sourceAccountId: "cash",
        categoryId: "system:opening-balance",
      }),
      accountAudit: expect.objectContaining({
        action: "account.created",
        entityType: "account",
        entityId: "cash",
      }),
      transactionAudit: expect.objectContaining({
        action: "transaction.created",
        entityType: "transaction",
        entityId: "opening:cash",
      }),
    }));
  });

  it("creates no opening transaction or transaction audit for zero", async () => {
    const { service, uow } = setup();
    await service.initialize({
      baseCurrency: "USD", locale: "en-US", dateFormat: "yyyy-MM-dd",
      account: {
        name: "Cash", type: "cash", currency: "USD", color: "green",
        icon: "banknote", openingBalance: 0,
      },
    });
    const records = vi.mocked(uow.initialize).mock.calls[0]![0];
    expect(records).not.toHaveProperty("openingTransaction");
    expect(records).not.toHaveProperty("transactionAudit");
  });

  it("rejects empty persisted settings fields before the atomic write", async () => {
    const { service, uow } = setup();
    await expect(service.initialize({
      baseCurrency: "USD", locale: " ", dateFormat: "yyyy-MM-dd",
      account: {
        name: "Cash", type: "cash", currency: "USD", color: "green",
        icon: "banknote", openingBalance: 0,
      },
    })).rejects.toMatchObject({
      code: "REQUIRED", field: "locale",
    });
    expect(uow.initialize).not.toHaveBeenCalled();
  });
});
