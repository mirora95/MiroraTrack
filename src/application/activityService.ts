import type { ActivityReadPort } from "./ports";
import { ValidationError } from "./validation";
import type { AuditEntry } from "../finance/types";

export interface ActivityFilters {
  readonly search?: string;
  readonly page: number;
  readonly pageSize: 25 | 50 | 100;
}

export interface ActivityItem {
  readonly id: string;
  readonly timestamp: string;
  readonly action: AuditEntry["action"];
  readonly message: string;
}

export interface ActivityPage {
  readonly items: readonly ActivityItem[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

const SAFE_MESSAGES: Readonly<Record<AuditEntry["action"], string>> = {
  "transaction.created": "Transaction created",
  "transaction.updated": "Transaction updated",
  "transaction.deleted": "Transaction deleted",
  "account.created": "Account created",
  "account.updated": "Account updated",
  "account.archived": "Account archived",
  "account.reactivated": "Account reactivated",
  "settings.initialized": "Settings initialized",
  "budget.created": "Budget created",
  "budget.updated": "Budget updated",
  "budget.archived": "Budget archived",
  "budget.reactivated": "Budget reactivated",
  "budget.deleted": "Budget deleted",
};

export class ActivityService {
  private readonly reads: ActivityReadPort;

  constructor(reads: ActivityReadPort) {
    this.reads = reads;
  }

  async list(filters: ActivityFilters): Promise<ActivityPage> {
    if (!Number.isSafeInteger(filters.page) || filters.page < 1) {
      throw new ValidationError("INVALID_FILTER", "page");
    }
    if (![25, 50, 100].includes(filters.pageSize)) {
      throw new ValidationError("INVALID_FILTER", "pageSize");
    }
    const search = (filters.search ?? "").trim().toLocaleLowerCase("en-US");
    if (search.includes("\u0000") || search.length > 100) {
      throw new ValidationError("INVALID_FILTER", "search");
    }
    const rows = (await this.reads.listAuditEntries())
      .flatMap((entry): ActivityItem[] => {
        const message = SAFE_MESSAGES[entry.action];
        return message === undefined || !isIsoTimestamp(entry.timestamp) ? [] : [{
          id: entry.id,
          timestamp: entry.timestamp,
          action: entry.action,
          message,
        }];
      })
      .filter((entry) => entry.message.toLocaleLowerCase("en-US").includes(search))
      .sort((left, right) =>
        -left.timestamp.localeCompare(right.timestamp) ||
        left.id.localeCompare(right.id));
    const offset = (filters.page - 1) * filters.pageSize;
    return {
      items: rows.slice(offset, offset + filters.pageSize),
      total: rows.length,
      page: filters.page,
      pageCount: Math.ceil(rows.length / filters.pageSize),
    };
  }
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value;
}
