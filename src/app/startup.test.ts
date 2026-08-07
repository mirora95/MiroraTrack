import { beforeEach, describe, expect, it, vi } from "vitest";
import { MiroraTrackDatabase } from "../database/db";
import type { Settings } from "../finance/types";
import {
  prepareDatabaseForStartup,
  scheduleAfterFirstRender,
} from "./startup";

const settings: Settings = {
  key: "primary",
  baseCurrency: "USD" as never,
  locale: "en-US",
  dateFormat: "yyyy-MM-dd",
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
};

describe("startup database preparation", () => {
  let db: MiroraTrackDatabase;

  beforeEach(async () => {
    db = new MiroraTrackDatabase(`startup-${crypto.randomUUID()}`);
    await db.open();
  });

  it("atomically removes only caches that do not match current metadata", async () => {
    await seedInitialized(db);
    await db.metadata.update("app", { ledgerRevision: 7 });
    await db.calculationCaches.bulkPut([
      cache("valid", 2, 7),
      cache("old-calculation", 1, 7),
      cache("old-ledger", 2, 6),
    ]);

    await expect(prepareDatabaseForStartup(db)).resolves.toEqual({
      status: "ready",
    });
    expect((await db.calculationCaches.toArray()).map(({ key }) => key))
      .toEqual(["valid"]);
  });

  it("rolls cache cleanup back when preparation is interrupted", async () => {
    await seedInitialized(db);
    await db.calculationCaches.put(cache("stale", 1, 0));

    await expect(prepareDatabaseForStartup(db, {
      beforeCommit: () => {
        throw new Error("interrupted");
      },
    })).resolves.toEqual({
      status: "recovery-required",
      reason: "startup-preparation-failed",
    });
    expect(await db.calculationCaches.count()).toBe(1);
  });

  it("does not mutate records when current settings are invalid", async () => {
    await db.settings.put({ ...settings, automaticBackupIntervalHours: 13 } as never);
    await db.calculationCaches.put(cache("stale", 1, 0));

    await expect(prepareDatabaseForStartup(db)).resolves.toEqual({
      status: "recovery-required",
      reason: "invalid-settings",
    });
    expect(await db.calculationCaches.count()).toBe(1);
  });

  it("fails closed on an array locale without purging existing caches", async () => {
    await db.settings.put({ ...settings, locale: ["en-US"] } as never);
    await db.calculationCaches.put(cache("stale", 1, 0));

    await expect(prepareDatabaseForStartup(db)).resolves.toEqual({
      status: "recovery-required",
      reason: "invalid-settings",
    });
    expect((await db.calculationCaches.toArray()).map(({ key }) => key))
      .toEqual(["stale"]);
  });

  it("does not mutate records when metadata is invalid", async () => {
    await db.metadata.update("app", { calculationVersion: 99 });
    await db.calculationCaches.put(cache("stale", 1, 0));

    await expect(prepareDatabaseForStartup(db)).resolves.toEqual({
      status: "recovery-required",
      reason: "invalid-metadata",
    });
    expect(await db.calculationCaches.count()).toBe(1);
  });

  it("rejects unknown metadata fields without purging caches", async () => {
    const metadata = await db.metadata.get("app");
    await db.metadata.put({ ...metadata!, unexpected: true } as never);
    await db.calculationCaches.put(cache("stale", 1, 0));

    await expect(prepareDatabaseForStartup(db)).resolves.toEqual({
      status: "recovery-required",
      reason: "invalid-metadata",
    });
    expect(await db.calculationCaches.count()).toBe(1);
  });

  it("treats partial initialization and broken default accounts as invalid settings", async () => {
    await db.settings.put({
      ...settings,
      defaultAccountId: "missing-account" as never,
    });
    await db.calculationCaches.put(cache("stale", 1, 0));

    await expect(prepareDatabaseForStartup(db)).resolves.toEqual({
      status: "recovery-required",
      reason: "invalid-settings",
    });
    expect(await db.calculationCaches.count()).toBe(1);
  });
});

describe("post-render scheduling", () => {
  it("waits for the idle callback and supports cancellation", () => {
    const callback = vi.fn();
    let idleTask: (() => void) | undefined;
    const cancelIdle = vi.fn();
    const cancel = scheduleAfterFirstRender(callback, {
      requestIdle: (task) => {
        idleTask = task;
        return 41;
      },
      cancelIdle,
      setFallback: vi.fn(),
      clearFallback: vi.fn(),
    });

    expect(callback).not.toHaveBeenCalled();
    idleTask?.();
    expect(callback).toHaveBeenCalledTimes(1);
    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(41);
  });

  it("uses a cancellable timer when requestIdleCallback is unavailable", () => {
    const callback = vi.fn();
    let fallbackTask: (() => void) | undefined;
    const clearFallback = vi.fn();
    const cancel = scheduleAfterFirstRender(callback, {
      setFallback: (task) => {
        fallbackTask = task;
        return 9;
      },
      clearFallback,
    });

    expect(callback).not.toHaveBeenCalled();
    fallbackTask?.();
    expect(callback).toHaveBeenCalledTimes(1);
    cancel();
    expect(clearFallback).toHaveBeenCalledWith(9);
  });
});

function cache(key: string, calculationVersion: number, sourceRevision: number) {
  return {
    key: key as never,
    calculationVersion,
    sourceRevision,
    value: {},
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

async function seedInitialized(db: MiroraTrackDatabase) {
  const accountId = "checking" as never;
  await db.accounts.put({
    id: accountId,
    name: "Checking",
    type: "checking",
    status: "active",
    currency: "USD" as never,
    color: "blue",
    icon: "landmark",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
  });
  await db.settings.put({ ...settings, defaultAccountId: accountId });
}
