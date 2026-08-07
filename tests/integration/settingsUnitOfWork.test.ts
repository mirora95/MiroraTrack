import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import { MiroraTrackDatabase } from "../../src/database/db";
import { DexieSettingsUnitOfWork } from "../../src/database/settingsUnitOfWork";
import type { Settings } from "../../src/finance/types";

const names = new Set<string>();
const now = "2026-07-29T10:00:00.000Z";
const original: Settings = {
  key: "primary",
  baseCurrency: "USD" as never,
  locale: "en-US",
  dateFormat: "yyyy-MM-dd",
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
};

afterEach(async () => {
  for (const name of names) await Dexie.delete(name);
  names.clear();
});

async function seeded() {
  const name = `settings-${crypto.randomUUID()}`;
  names.add(name);
  const db = new MiroraTrackDatabase(name, () => now);
  await db.open();
  await db.settings.put(original);
  await db.calculationCaches.put({
    key: "dashboard" as never,
    calculationVersion: 2,
    sourceRevision: 0,
    value: {},
    updatedAt: now,
  });
  return db;
}

describe("DexieSettingsUnitOfWork", () => {
  it("replaces settings, bumps revision, and clears caches atomically", async () => {
    const db = await seeded();
    const next = { ...original, locale: "fr-FR" };
    await new DexieSettingsUnitOfWork(db).replaceSettings(original, next, 0);
    expect(await db.settings.get("primary")).toEqual(next);
    expect((await db.metadata.get("app"))?.ledgerRevision).toBe(1);
    expect(await db.calculationCaches.count()).toBe(0);
    db.close();
  });

  it("rolls back every write when interrupted before commit", async () => {
    const db = await seeded();
    const before = {
      settings: await db.settings.toArray(),
      metadata: await db.metadata.toArray(),
      caches: await db.calculationCaches.toArray(),
    };
    await expect(new DexieSettingsUnitOfWork(db, {
      onStage: (stage) => {
        if (stage === "beforeCommit") throw new Error("interrupt");
      },
    }).replaceSettings(original, { ...original, locale: "fr-FR" }, 0))
      .rejects.toThrow("interrupt");
    expect({
      settings: await db.settings.toArray(),
      metadata: await db.metadata.toArray(),
      caches: await db.calculationCaches.toArray(),
    }).toEqual(before);
    db.close();
  });

  it("rejects stale expected settings and revisions", async () => {
    const db = await seeded();
    const uow = new DexieSettingsUnitOfWork(db);
    await expect(uow.replaceSettings(
      { ...original, locale: "de-DE" },
      original,
      0,
    )).rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    await expect(uow.replaceSettings(original, original, 9))
      .rejects.toMatchObject({ code: "CONCURRENT_MODIFICATION" });
    db.close();
  });
});
