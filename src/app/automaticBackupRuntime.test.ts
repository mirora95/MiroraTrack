import { describe, expect, it, vi } from "vitest";

import {
  decorateRuntimeWithAutomaticBackups,
  type AutomaticBackupsApplication,
} from "./productionRuntime";
import type { AppRuntime } from "./runtime";

function runtime(): AppRuntime {
  return {
    initialization: {
      getState: vi.fn().mockResolvedValue({ status: "ready" }),
      initialize: vi.fn().mockResolvedValue(undefined),
    },
    accounts: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "account" }),
      update: vi.fn().mockResolvedValue({ id: "account" }),
      archive: vi.fn().mockResolvedValue(undefined),
      reactivate: vi.fn().mockResolvedValue(undefined),
    },
    transactions: {
      list: vi.fn().mockResolvedValue({ rows: [] }),
      exportFiltered: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "transaction" }),
      edit: vi.fn().mockResolvedValue({ id: "transaction" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    activity: { list: vi.fn().mockResolvedValue({ rows: [] }) },
    budgets: {
      list: vi.fn().mockResolvedValue({ rows: [] }),
      availableCurrencies: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "budget" }),
      update: vi.fn().mockResolvedValue({ id: "budget" }),
      archive: vi.fn().mockResolvedValue(undefined),
      reactivate: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    dashboard: { load: vi.fn().mockResolvedValue({}) },
    settings: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    dataManagement: {
      getBackupStatus: vi.fn().mockResolvedValue(undefined),
      chooseBackupFolder: vi.fn().mockResolvedValue({
        status: "success",
        folderPath: "D:\\Backups",
      }),
      resetBackupFolder: vi.fn().mockResolvedValue(undefined),
      exportJson: vi.fn().mockResolvedValue({ status: "cancelled" }),
      exportCsv: vi.fn().mockResolvedValue({ status: "cancelled" }),
      selectImport: vi.fn().mockResolvedValue(null),
      restore: vi.fn().mockResolvedValue({
        reloadRequired: true,
        counts: {},
      }),
      invalidateRestoreCandidate: vi.fn(),
    },
  } as unknown as AppRuntime;
}

function automaticBackups(): AutomaticBackupsApplication {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn(),
    notifyStructuredDataChanged: vi.fn(),
    retryNow: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockReturnValue({ phase: "idle" }),
    subscribe: vi.fn().mockReturnValue(vi.fn()),
  };
}

describe("automatic backup runtime mutation boundary", () => {
  it("notifies once after each successful structured mutation and never after reads or exports", async () => {
    const base = runtime();
    const backups = automaticBackups();
    const decorated = decorateRuntimeWithAutomaticBackups(base, backups);
    const calls = [
      decorated.initialization.initialize({} as never),
      decorated.accounts.create({} as never),
      decorated.accounts.update({} as never),
      decorated.accounts.archive("account"),
      decorated.accounts.reactivate("account"),
      decorated.transactions.create({} as never),
      decorated.transactions.edit("transaction", {} as never),
      decorated.transactions.delete("transaction"),
      decorated.budgets.create({} as never),
      decorated.budgets.update("budget", {} as never),
      decorated.budgets.archive("budget"),
      decorated.budgets.reactivate("budget"),
      decorated.budgets.delete("budget"),
      decorated.settings.update({} as never),
      decorated.dataManagement.chooseBackupFolder(),
      decorated.dataManagement.resetBackupFolder(),
    ];
    await Promise.all(calls);
    expect(backups.notifyStructuredDataChanged).toHaveBeenCalledTimes(calls.length);

    await decorated.initialization.getState();
    await decorated.accounts.list();
    await decorated.transactions.list({} as never);
    await decorated.transactions.exportFiltered({} as never);
    await decorated.activity.list({} as never);
    await decorated.budgets.list({} as never);
    await decorated.budgets.availableCurrencies();
    await decorated.dashboard.load({} as never);
    await decorated.settings.get();
    await decorated.dataManagement.getBackupStatus();
    await decorated.dataManagement.exportJson();
    await decorated.dataManagement.exportCsv();
    await decorated.dataManagement.selectImport();
    decorated.dataManagement.invalidateRestoreCandidate();
    expect(backups.notifyStructuredDataChanged).toHaveBeenCalledTimes(calls.length);
  });

  it("does not notify for failed or cancelled mutations", async () => {
    const base = runtime();
    vi.mocked(base.accounts.create).mockRejectedValueOnce(new Error("failed"));
    vi.mocked(base.dataManagement.chooseBackupFolder).mockResolvedValueOnce({
      status: "cancelled",
    });
    const backups = automaticBackups();
    const decorated = decorateRuntimeWithAutomaticBackups(base, backups);

    await expect(decorated.accounts.create({} as never)).rejects.toThrow("failed");
    await decorated.dataManagement.chooseBackupFolder();

    expect(backups.notifyStructuredDataChanged).not.toHaveBeenCalled();
  });

  it("pauses before restore, resumes after failure, and stays stopped after success", async () => {
    const failedBase = runtime();
    vi.mocked(failedBase.dataManagement.restore).mockRejectedValueOnce(
      new Error("restore failed"),
    );
    const failedBackups = automaticBackups();
    const failed = decorateRuntimeWithAutomaticBackups(
      failedBase,
      failedBackups,
    );

    await expect(
      failed.dataManagement.restore("candidate", "REPLACE MY DATA"),
    ).rejects.toThrow("restore failed");
    expect(failedBackups.pause).toHaveBeenCalledBefore(
      vi.mocked(failedBase.dataManagement.restore),
    );
    expect(failedBackups.resume).toHaveBeenCalledTimes(1);
    expect(failedBackups.stop).not.toHaveBeenCalled();

    const successBase = runtime();
    const successBackups = automaticBackups();
    const success = decorateRuntimeWithAutomaticBackups(
      successBase,
      successBackups,
    );
    await success.dataManagement.restore("candidate", "REPLACE MY DATA");
    expect(successBackups.pause).toHaveBeenCalledBefore(
      vi.mocked(successBase.dataManagement.restore),
    );
    expect(successBackups.stop).toHaveBeenCalledTimes(1);
    expect(successBackups.resume).not.toHaveBeenCalled();
  });

  it("exposes lifecycle, status subscription, and retry through narrow runtime surfaces", async () => {
    const backups = automaticBackups();
    const decorated = decorateRuntimeWithAutomaticBackups(runtime(), backups);
    const listener = vi.fn();

    decorated.automaticBackups?.start();
    decorated.automaticBackups?.subscribe(listener);
    await decorated.dataManagement.retryAutomaticBackup?.();

    expect(backups.start).toHaveBeenCalledTimes(1);
    expect(backups.subscribe).toHaveBeenCalledWith(listener);
    expect(backups.retryNow).toHaveBeenCalledTimes(1);
  });
});
