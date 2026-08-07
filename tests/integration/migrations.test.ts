import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import {
  APP_METADATA_KEY,
  CALCULATION_VERSION,
  DATABASE_VERSION,
  MiroraTrackDatabase,
  openMiroraTrackDatabase,
} from "../../src/database/db";
import {
  V1_STORES,
  V2_STORES,
  V3_STORES,
  V4_STORES,
  V5_STORES,
} from "../../src/database/schema";
import type { MigrationStage } from "../../src/database/migrations";

const databaseNames = new Set<string>();
const openConnections = new Set<Dexie>();
const now = "2026-07-28T10:00:00.000Z";

function track<T extends Dexie>(db: T): T {
  openConnections.add(db);
  return db;
}

function uniqueName(): string {
  const name = `miroratrack-test-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

async function seedV1(name: string): Promise<void> {
  const legacy = track(new Dexie(name));
  legacy.version(1).stores(V1_STORES);
  await legacy.open();
  await legacy.table("metadata").put({
    key: APP_METADATA_KEY,
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.table("settings").put({
    key: "primary",
    baseCurrency: "USD",
    locale: "en-US",
    dateFormat: "yyyy-MM-dd",
  });
  await legacy.table("budgets").put({
    id: "budget-1",
    name: "Food",
    categoryId: "food",
    currency: "USD",
    amount: 10000,
    month: "2026-07",
    createdAt: now,
    updatedAt: now,
  });
  await legacy.table("backupMetadata").put({
    id: "automatic",
    status: "idle",
  });
  await legacy.table("calculationCaches").put({
    key: "dashboard",
    calculationVersion: 1,
    sourceRevision: 0,
    value: {},
    updatedAt: now,
  });
  legacy.close();
}

async function seedV2(name: string, openingBalance = 2500): Promise<void> {
  const legacy = track(new Dexie(name));
  legacy.version(2).stores(V2_STORES);
  await legacy.open();
  await legacy.table("metadata").put({
    key: APP_METADATA_KEY,
    schemaVersion: 2,
    calculationVersion: 1,
    ledgerRevision: 4,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.table("settings").put({
    key: "primary", baseCurrency: "USD", locale: "en-US",
    dateFormat: "yyyy-MM-dd", defaultAccountId: "cash",
    automaticBackupsEnabled: true,
  });
  await legacy.table("accounts").put({
    id: "cash", name: "Cash", type: "cash", status: "active",
    currency: "USD", openingBalance, createdAt: now, updatedAt: now,
  });
  await legacy.table("calculationCaches").put({
    key: "dashboard", calculationVersion: 1, sourceRevision: 4,
    value: { balance: openingBalance }, updatedAt: now,
  });
  legacy.close();
}

async function seedV3(name: string): Promise<void> {
  const legacy = track(new Dexie(name));
  legacy.version(3).stores(V3_STORES);
  await legacy.open();
  await legacy.table("metadata").put({
    key: APP_METADATA_KEY,
    schemaVersion: 3,
    calculationVersion: 1,
    ledgerRevision: 4,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.table("budgets").put({
    id: "budget-1",
    name: "Food",
    categoryId: "food",
    currency: "USD",
    amount: 10000,
    month: "2026-07",
    rollover: false,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.table("backupMetadata").put({
    id: "automatic",
    status: "success",
    schemaVersion: 3,
  });
  await legacy.table("calculationCaches").put({
    key: "dashboard",
    calculationVersion: 1,
    sourceRevision: 4,
    value: {},
    updatedAt: now,
  });
  legacy.close();
}

async function seedV4(name: string): Promise<void> {
  const legacy = track(new Dexie(name));
  legacy.version(4).stores(V4_STORES);
  await legacy.open();
  await legacy.table("metadata").put({
    key: APP_METADATA_KEY,
    schemaVersion: 4,
    calculationVersion: 2,
    ledgerRevision: 9,
    createdAt: now,
    updatedAt: now,
  });
  await legacy.table("settings").put({
    key: "primary",
    baseCurrency: "USD",
    locale: "en-US",
    dateFormat: "yyyy-MM-dd",
    automaticBackupsEnabled: true,
  });
  await legacy.table("backupMetadata").put({
    id: "automatic",
    status: "success",
    schemaVersion: 4,
    lastSuccessfulAt: now,
  });
  await legacy.table("calculationCaches").put({
    key: "dashboard",
    calculationVersion: 2,
    sourceRevision: 9,
    value: {},
    updatedAt: now,
  });
  legacy.close();
}

afterEach(async () => {
  for (const connection of openConnections) connection.close();
  openConnections.clear();
  try {
    for (const name of databaseNames) {
      await Dexie.delete(name);
    }
  } finally {
    databaseNames.clear();
  }
});

describe("MiroraTrack database migrations", () => {
  it("migrates v4 settings and metadata to v5 without changing ledger revision", async () => {
    const name = uniqueName();
    await seedV4(name);
    const result = await openMiroraTrackDatabase({ name, clock: () => now });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    track(result.db);
    expect(await result.db.settings.get("primary")).toMatchObject({
      automaticBackupIntervalHours: 24,
    });
    expect(await result.db.metadata.get(APP_METADATA_KEY)).toMatchObject({
      schemaVersion: 5,
      ledgerRevision: 9,
    });
    expect(await result.db.backupMetadata.get("automatic")).toMatchObject({
      schemaVersion: 5,
      status: "success",
    });
    expect(await result.db.calculationCaches.count()).toBe(0);
  });

  it.each([
    "afterSettings", "afterMetadata", "afterCacheClear", "beforeCommit",
  ] as const)("rolls v4 migration back at %s", async (stage) => {
    const name = uniqueName();
    await seedV4(name);
    const before = await snapshotV4(name);
    const result = await openMiroraTrackDatabase({
      name,
      clock: () => now,
      onMigrationStage: (current) => {
        if (current === stage) throw new Error(`fail:${stage}`);
      },
    });
    expect(result).toEqual({
      status: "read-only-recovery",
      reason: "migration-failed",
    });
    expect(await snapshotV4(name)).toEqual(before);
  });

  it.each([
    ["invalid interval", "settings", { automaticBackupIntervalHours: 48 }],
    ["negative revision", "metadata", { ledgerRevision: -1 }],
    ["unsafe revision", "metadata", {
      ledgerRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
    ["exhausted revision", "metadata", {
      ledgerRevision: Number.MAX_SAFE_INTEGER,
    }],
    ["stale calculation version", "metadata", { calculationVersion: 1 }],
    ["failed status without an error", "backupMetadata", {
      status: "failed",
      errorCode: undefined,
    }],
    ["unknown failed error", "backupMetadata", {
      status: "failed",
      errorCode: "NOT_REAL",
    }],
    ["legacy warning status", "backupMetadata", {
      status: "warning",
      warningCode: "RETENTION_WARNING",
    }],
  ] as const)("fails closed and rolls v4 back for %s", async (
    _name,
    table,
    changes,
  ) => {
    const name = uniqueName();
    await seedV4(name);
    const legacy = track(new Dexie(name));
    legacy.version(4).stores(V4_STORES);
    await legacy.open();
    await legacy.table(table).update(
      table === "metadata" ? "app" : table === "settings" ? "primary" : "automatic",
      changes,
    );
    legacy.close();
    const before = await snapshotV4(name);
    expect(await openMiroraTrackDatabase({ name, clock: () => now })).toEqual({
      status: "read-only-recovery",
      reason: "migration-failed",
    });
    expect(await snapshotV4(name)).toEqual(before);
  });

  it.each(["success", "idle"] as const)(
    "clears stale v4 error and warning fields for %s metadata",
    async (status) => {
      const name = uniqueName();
      await seedV4(name);
      const legacy = track(new Dexie(name));
      legacy.version(4).stores(V4_STORES);
      await legacy.open();
      await legacy.table("backupMetadata").update("automatic", {
        status,
        errorCode: "WRITE_FAILED",
        errorMessage: "stale",
        warningCode: "RETENTION_WARNING",
        warningMessage: "stale",
      });
      legacy.close();
      const result = await openMiroraTrackDatabase({ name, clock: () => now });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      track(result.db);
      expect(await result.db.backupMetadata.get("automatic")).toEqual({
        id: "automatic",
        status,
        schemaVersion: 5,
        lastSuccessfulAt: now,
      });
    },
  );
  it("migrates v3 budgets to active and upgrades metadata atomically", async () => {
    const name = uniqueName();
    await seedV3(name);
    const result = await openMiroraTrackDatabase({ name, clock: () => now });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    track(result.db);
    expect(await result.db.budgets.get("budget-1")).toMatchObject({
      status: "active",
      rollover: false,
    });
    expect(await result.db.metadata.get(APP_METADATA_KEY)).toMatchObject({
      schemaVersion: 5,
      calculationVersion: 2,
      ledgerRevision: 5,
    });
    expect(await result.db.backupMetadata.get("automatic")).toMatchObject({
      schemaVersion: 5,
    });
    expect(await result.db.calculationCaches.count()).toBe(0);
  });

  it.each([
    "afterBudgets",
    "afterMetadata",
    "afterCacheClear",
    "beforeCommit",
  ] as const)("rolls v3 migration back at %s", async (stage) => {
    const name = uniqueName();
    await seedV3(name);
    const before = await snapshotV3(name);
    const result = await openMiroraTrackDatabase({
      name,
      clock: () => now,
      onMigrationStage: (current) => {
        if (current === stage) throw new Error(`fail:${stage}`);
      },
    });
    expect(result).toEqual({
      status: "read-only-recovery",
      reason: "migration-failed",
    });
    expect(await snapshotV3(name)).toEqual(before);
  });

  it("fails closed when legacy budgets contain duplicate active scopes", async () => {
    const name = uniqueName();
    await seedV3(name);
    const legacy = track(new Dexie(name));
    legacy.version(3).stores(V3_STORES);
    await legacy.open();
    await legacy.table("budgets").add({
      ...(await legacy.table("budgets").get("budget-1")),
      id: "budget-2",
    });
    legacy.close();
    const before = await snapshotV3(name);
    expect(await openMiroraTrackDatabase({ name, clock: () => now })).toEqual({
      status: "read-only-recovery",
      reason: "migration-failed",
    });
    expect(await snapshotV3(name)).toEqual(before);
  });

  it("migrates v2 opening balances into ledger records without changing balance", async () => {
    const name = uniqueName();
    await seedV2(name, -2500);
    const result = await openMiroraTrackDatabase({ name, clock: () => now });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    track(result.db);
    expect(await result.db.accounts.get("cash")).toEqual({
      id: "cash", name: "Cash", type: "cash", status: "active",
      currency: "USD", color: "green", icon: "banknote",
      createdAt: now, updatedAt: now,
    });
    expect(await result.db.transactions.toArray()).toEqual([
      expect.objectContaining({
        id: "opening-balance:cash", type: "expense", status: "completed",
        purpose: "opening-balance", amount: 2500, sourceAccountId: "cash",
        categoryId: "system:opening-balance",
      }),
    ]);
    expect(await result.db.auditEntries.toArray()).toEqual([
      expect.objectContaining({
        id: "audit:opening-balance:cash", action: "transaction.created",
        entityType: "transaction", entityId: "opening-balance:cash",
      }),
    ]);
    expect(await result.db.metadata.get(APP_METADATA_KEY)).toMatchObject({
      schemaVersion: 5, calculationVersion: 2, ledgerRevision: 6,
    });
    expect(await result.db.calculationCaches.count()).toBe(0);
  });

  it("fails closed when a generated opening ID collides", async () => {
    const name = uniqueName();
    await seedV2(name);
    const legacy = track(new Dexie(name));
    legacy.version(2).stores(V2_STORES);
    await legacy.open();
    await legacy.table("transactions").add({
      id: "opening-balance:cash", type: "income", status: "completed",
      amount: 1, currency: "USD", effectiveAt: now,
      destinationAccountId: "cash", categoryId: "other",
      createdAt: now, updatedAt: now,
    });
    legacy.close();
    const before = await snapshotV2(name);
    expect(await openMiroraTrackDatabase({ name, clock: () => now }))
      .toEqual({ status: "read-only-recovery", reason: "migration-failed" });
    expect(await snapshotV2(name)).toEqual(before);
  });

  it.each([
    "afterAccounts", "afterTransactions", "afterAudits", "afterMetadata",
    "afterCacheClear", "beforeCommit",
  ] as const)("rolls v2 migration back at %s", async (stage) => {
    const name = uniqueName();
    await seedV2(name);
    const before = await snapshotV2(name);
    const seen: MigrationStage[] = [];
    const result = await openMiroraTrackDatabase({
      name, clock: () => now,
      onMigrationStage: (current) => {
        seen.push(current);
        if (current === stage) throw new Error(`fail:${stage}`);
      },
    });
    expect(result).toEqual({
      status: "read-only-recovery", reason: "migration-failed",
    });
    expect(seen).toContain(stage);
    expect(await snapshotV2(name)).toEqual(before);
  });
  it("creates one current metadata record in a fresh database", async () => {
    const db = track(new MiroraTrackDatabase(uniqueName(), () => now));
    await db.open();

    expect(await db.metadata.toArray()).toEqual([{
      key: APP_METADATA_KEY,
      schemaVersion: DATABASE_VERSION,
      calculationVersion: CALCULATION_VERSION,
      ledgerRevision: 0,
      createdAt: now,
      updatedAt: now,
    }]);
    db.close();
  });

  it("migrates v1 defaults, preserves records, and clears caches", async () => {
    const name = uniqueName();
    await seedV1(name);

    const result = await openMiroraTrackDatabase({ name, clock: () => now });
    if (result.status === "ready") track(result.db);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;

    expect(await result.db.settings.get("primary")).toMatchObject({
      automaticBackupsEnabled: true,
    });
    expect(await result.db.budgets.get("budget-1")).toMatchObject({
      rollover: false,
    });
    expect(await result.db.backupMetadata.get("automatic")).toMatchObject({
      schemaVersion: DATABASE_VERSION,
    });
    expect(await result.db.calculationCaches.count()).toBe(0);
    expect(await result.db.metadata.get(APP_METADATA_KEY)).toMatchObject({
      schemaVersion: DATABASE_VERSION,
      calculationVersion: CALCULATION_VERSION,
      ledgerRevision: 2,
      updatedAt: now,
    });
    result.db.close();
  });

  it("returns recovery without exposing a mutable database for a newer physical version", async () => {
    const name = uniqueName();
    const future = track(new Dexie(name));
    future.version(DATABASE_VERSION + 1).stores(V1_STORES);
    await future.open();
    future.close();

    const result = await openMiroraTrackDatabase({ name, clock: () => now });

    expect(result).toEqual({
      status: "read-only-recovery",
      reason: "physical-version-newer",
      databaseVersion: DATABASE_VERSION + 1,
    });
    expect("db" in result).toBe(false);
  });

  it("rejects newer metadata before upgrading or mutating a physical v1 database", async () => {
    const name = uniqueName();
    const legacy = track(new Dexie(name));
    legacy.version(1).stores(V1_STORES);
    await legacy.open();
    try {
      await legacy.table("metadata").put({
        key: APP_METADATA_KEY,
        schemaVersion: 99,
        createdAt: now,
        updatedAt: now,
      });
      await legacy.table("accounts").put({
        id: "cash",
        name: "Cash",
        type: "cash",
        status: "active",
        currency: "USD",
        openingBalance: 2500,
        createdAt: now,
        updatedAt: now,
      });
      await legacy.table("calculationCaches").put({
        key: "dashboard",
        calculationVersion: 1,
        sourceRevision: 0,
        value: { total: 2500 },
        updatedAt: now,
      });
    } finally {
      legacy.close();
    }

    const before = await snapshotV1(name);
    const result = await openMiroraTrackDatabase({ name, clock: () => now });
    const after = await snapshotV1(name);

    expect(result).toEqual({
      status: "read-only-recovery",
      reason: "schema-version-newer",
      schemaVersion: 99,
    });
    expect("db" in result).toBe(false);
    expect(after).toEqual(before);
  });

  it("rolls back every v1 mutation when migration fails before metadata commit", async () => {
    const name = uniqueName();
    await seedV1(name);
    const before = await snapshotV1(name);

    const result = await openMiroraTrackDatabase({
      name,
      clock: () => now,
      beforeSchemaVersionCommit: () => {
        throw new Error("injected migration failure");
      },
    });

    expect(result).toEqual({
      status: "read-only-recovery",
      reason: "migration-failed",
    });
    expect(await snapshotV1(name)).toEqual(before);
  });

  it("does not reseed metadata when a fresh database is reopened", async () => {
    const name = uniqueName();
    const db = track(new MiroraTrackDatabase(name, () => now));
    await db.open();
    db.close();

    const reopened = track(new MiroraTrackDatabase(
      name,
      () => "2027-01-01T00:00:00.000Z",
    ));
    await reopened.open();
    try {
      expect(await reopened.metadata.toArray()).toEqual([{
        key: APP_METADATA_KEY,
        schemaVersion: DATABASE_VERSION,
        calculationVersion: CALCULATION_VERSION,
        ledgerRevision: 0,
        createdAt: now,
        updatedAt: now,
      }]);
    } finally {
      reopened.close();
    }
  });

  it("registers the exact approved v1 and v2 table schemas", () => {
    expect(V1_STORES).toEqual({
      metadata: "&key",
      settings: "&key",
      accounts: "&id,status,currency,createdAt,updatedAt",
      transactions:
        "&id,type,status,currency,effectiveAt,sourceAccountId,destinationAccountId,categoryId,createdAt,updatedAt",
      budgets: "&id,month,categoryId,currency,createdAt,updatedAt",
      auditEntries: "&id,timestamp,action,entityType,entityId",
      backupMetadata: "&id,status,lastSuccessfulAt",
      calculationCaches: "&key,calculationVersion,sourceRevision,updatedAt",
    });
    expect(V2_STORES).toEqual(V1_STORES);
    expect(V3_STORES).toEqual(V2_STORES);
    expect(V4_STORES).toEqual({
      ...V3_STORES,
      budgets:
        "&id,status,month,categoryId,currency,[month+categoryId+currency],createdAt,updatedAt",
    });
    expect(V5_STORES).toEqual(V4_STORES);
  });

  it("preserves existing defaults and authoritative rows during migration", async () => {
    const name = uniqueName();
    await seedV1(name);
    const legacy = track(new Dexie(name));
    legacy.version(1).stores(V1_STORES);
    await legacy.open();
    try {
      await legacy.table("settings").update("primary", {
        automaticBackupsEnabled: false,
      });
      await legacy.table("budgets").update("budget-1", { rollover: true });
      await legacy.table("accounts").put({
        id: "cash",
        name: "Cash",
        type: "cash",
        status: "active",
        currency: "USD",
        openingBalance: 2500,
        createdAt: now,
        updatedAt: now,
      });
    } finally {
      legacy.close();
    }

    const result = await openMiroraTrackDatabase({ name, clock: () => now });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    track(result.db);
    try {
      expect(await result.db.settings.get("primary")).toMatchObject({
        automaticBackupsEnabled: false,
      });
      expect(await result.db.budgets.get("budget-1")).toMatchObject({
        rollover: false,
      });
      expect(await result.db.accounts.get("cash")).toMatchObject({
        color: "green",
        icon: "banknote",
      });
      expect(await result.db.transactions.get("opening-balance:cash"))
        .toMatchObject({ purpose: "opening-balance", amount: 2500 });
      expect(await result.db.calculationCaches.count()).toBe(0);
      expect(await result.db.metadata.get(APP_METADATA_KEY)).toMatchObject({
        schemaVersion: DATABASE_VERSION,
      });
    } finally {
      result.db.close();
    }
  });
});

async function snapshotV2(name: string) {
  const db = track(new Dexie(name));
  db.version(2).stores(V2_STORES);
  await db.open();
  try {
    return {
      version: db.verno,
      metadata: await db.table("metadata").toArray(),
      settings: await db.table("settings").toArray(),
      accounts: await db.table("accounts").toArray(),
      transactions: await db.table("transactions").toArray(),
      auditEntries: await db.table("auditEntries").toArray(),
      calculationCaches: await db.table("calculationCaches").toArray(),
    };
  } finally {
    db.close();
  }
}

async function snapshotV3(name: string) {
  const db = track(new Dexie(name));
  db.version(3).stores(V3_STORES);
  await db.open();
  try {
    return {
      version: db.verno,
      metadata: await db.table("metadata").toArray(),
      settings: await db.table("settings").toArray(),
      accounts: await db.table("accounts").toArray(),
      transactions: await db.table("transactions").toArray(),
      budgets: await db.table("budgets").toArray(),
      auditEntries: await db.table("auditEntries").toArray(),
      backupMetadata: await db.table("backupMetadata").toArray(),
      calculationCaches: await db.table("calculationCaches").toArray(),
    };
  } finally {
    db.close();
  }
}

async function snapshotV4(name: string) {
  const db = track(new Dexie(name));
  db.version(4).stores(V4_STORES);
  await db.open();
  try {
    return {
      version: db.verno,
      metadata: await db.table("metadata").toArray(),
      settings: await db.table("settings").toArray(),
      backupMetadata: await db.table("backupMetadata").toArray(),
      calculationCaches: await db.table("calculationCaches").toArray(),
    };
  } finally {
    db.close();
  }
}

async function snapshotV1(name: string): Promise<{
  readonly version: number;
  readonly metadata: unknown[];
  readonly settings: unknown[];
  readonly accounts: unknown[];
  readonly transactions: unknown[];
  readonly budgets: unknown[];
  readonly auditEntries: unknown[];
  readonly backupMetadata: unknown[];
  readonly calculationCaches: unknown[];
}> {
  const db = track(new Dexie(name));
  db.version(1).stores(V1_STORES);
  await db.open();
  try {
    return {
      version: db.verno,
      metadata: await db.table("metadata").toArray(),
      settings: await db.table("settings").toArray(),
      accounts: await db.table("accounts").toArray(),
      transactions: await db.table("transactions").toArray(),
      budgets: await db.table("budgets").toArray(),
      auditEntries: await db.table("auditEntries").toArray(),
      backupMetadata: await db.table("backupMetadata").toArray(),
      calculationCaches: await db.table("calculationCaches").toArray(),
    };
  } finally {
    db.close();
  }
}
