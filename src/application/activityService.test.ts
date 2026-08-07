import { describe, expect, it, vi } from "vitest";

import { ActivityService } from "./activityService";
import type { ActivityReadPort } from "./ports";
import type { AuditEntry } from "../finance/types";

const entries: readonly AuditEntry[] = [
  {
    id: "second" as never,
    timestamp: "2026-07-29T11:00:00.000Z",
    action: "transaction.updated",
    entityType: "transaction",
    entityId: "tx" as never,
    description: "C:\\Users\\person\\secret.json",
  },
  {
    id: "first" as never,
    timestamp: "2026-07-29T10:00:00.000Z",
    action: "account.created",
    entityType: "account",
    entityId: "account" as never,
    description: "<img src=x onerror=alert(1)>",
  },
];

describe("ActivityService", () => {
  it("maps records to fixed safe messages and never exposes stored descriptions, ids, or paths", async () => {
    const reads: ActivityReadPort = {
      listAuditEntries: vi.fn(async () => entries),
    };

    const result = await new ActivityService(reads).list({
      search: "",
      page: 1,
      pageSize: 25,
    });

    expect(result.items).toEqual([
      {
        id: "second",
        timestamp: "2026-07-29T11:00:00.000Z",
        action: "transaction.updated",
        message: "Transaction updated",
      },
      {
        id: "first",
        timestamp: "2026-07-29T10:00:00.000Z",
        action: "account.created",
        message: "Account created",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("<img");
    expect(JSON.stringify(result)).not.toContain("\"tx\"");
  });

  it("searches only fixed messages and paginates deterministically", async () => {
    const reads: ActivityReadPort = {
      listAuditEntries: vi.fn(async () => entries),
    };
    const result = await new ActivityService(reads).list({
      search: "account",
      page: 1,
      pageSize: 25,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.message).toBe("Account created");
  });

  it("ignores an unknown corrupted action instead of reflecting unsafe text", async () => {
    const reads: ActivityReadPort = {
      listAuditEntries: vi.fn(async () => [{
        ...entries[0],
        action: "backup.C:\\secret" as never,
        description: "C:\\secret",
      }]),
    };
    await expect(new ActivityService(reads).list({
      page: 1,
      pageSize: 25,
    })).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageCount: 0,
    });
  });

  it("ignores corrupted timestamps rather than projecting path-like data", async () => {
    const reads: ActivityReadPort = {
      listAuditEntries: vi.fn(async () => [{
        ...entries[0],
        timestamp: "C:\\Users\\person\\private.json",
      }]),
    };
    const result = await new ActivityService(reads).list({
      page: 1,
      pageSize: 25,
    });
    expect(result.items).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
