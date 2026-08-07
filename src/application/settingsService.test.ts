import { describe, expect, it, vi } from "vitest";

import { SettingsService } from "./settingsService";
import type { Settings } from "../finance/types";

const current: Settings = {
  key: "primary",
  baseCurrency: "USD" as never,
  locale: "en-US",
  dateFormat: "yyyy-MM-dd",
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
};

describe("SettingsService", () => {
  it("requires explicit acknowledgement before changing base currency", async () => {
    const uow = { replaceSettings: vi.fn() };
    const service = new SettingsService({
      reads: { getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: current,
        revision: 7,
      }) },
      uow,
    });

    await expect(service.update({
      ...current,
      baseCurrency: "EUR" as never,
    })).rejects.toMatchObject({ code: "BASE_CURRENCY_ACKNOWLEDGEMENT_REQUIRED" });
    expect(uow.replaceSettings).not.toHaveBeenCalled();
  });

  it("canonicalizes locale and atomically replaces the expected settings", async () => {
    const replaceSettings = vi.fn();
    const service = new SettingsService({
      reads: { getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: current,
        revision: 7,
      }) },
      uow: { replaceSettings },
    });

    const updated = await service.update({
      ...current,
      locale: "EN-us",
      automaticBackupIntervalHours: 168,
    });

    expect(updated.locale).toBe("en-US");
    expect(replaceSettings).toHaveBeenCalledWith(current, updated, 7);
  });

  it.each([
    ["locale", { ...current, locale: "not_a_locale" }],
    ["dateFormat", { ...current, dateFormat: "DD-YY" }],
    ["automaticBackupIntervalHours", {
      ...current,
      automaticBackupIntervalHours: 48,
    }],
  ])("rejects invalid %s", async (_field, candidate) => {
    const service = new SettingsService({
      reads: { getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: current,
        revision: 7,
      }) },
      uow: { replaceSettings: vi.fn() },
    });
    await expect(service.update(candidate as Settings)).rejects.toBeTruthy();
  });

  it("rejects unknown fields and unsafe default account identifiers", async () => {
    const replaceSettings = vi.fn();
    const service = new SettingsService({
      reads: { getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: current,
        revision: 7,
      }) },
      uow: { replaceSettings },
    });
    await expect(service.update({
      ...current,
      unexpected: "not persisted",
    } as Settings)).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
    await expect(service.update({
      ...current,
      defaultAccountId: " bad " as never,
    })).rejects.toMatchObject({ code: "INVALID_SETTINGS" });
    expect(replaceSettings).not.toHaveBeenCalled();
  });

  it.each([
    ["locale array", ["en-US"]],
    ["boxed locale", new String("en-US")],
    ["locale object", { toString: (): string => "en-US" }],
    ["locale with controls", "en-US\n"],
  ])("rejects a non-primitive or unsafe %s", async (_description, locale) => {
    const replaceSettings = vi.fn();
    const service = new SettingsService({
      reads: { getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: current,
        revision: 7,
      }) },
      uow: { replaceSettings },
    });

    await expect(service.update({
      ...current,
      locale,
    } as unknown as Settings)).rejects.toMatchObject({
      code: "INVALID_LOCALE",
      field: "locale",
    });
    expect(replaceSettings).not.toHaveBeenCalled();
  });

  it("constructs only the exact approved persisted settings fields", async () => {
    const replaceSettings = vi.fn();
    const service = new SettingsService({
      reads: { getSettingsSnapshot: vi.fn().mockResolvedValue({
        settings: current,
        revision: 7,
      }) },
      uow: { replaceSettings },
    });
    const updated = await service.update({
      ...current,
      defaultAccountId: "cash" as never,
      backupFolderPath: "D:\\Backups",
    });
    expect(Object.keys(updated).sort()).toEqual([
      "automaticBackupIntervalHours",
      "automaticBackupsEnabled",
      "backupFolderPath",
      "baseCurrency",
      "dateFormat",
      "defaultAccountId",
      "key",
      "locale",
    ]);
  });
});
