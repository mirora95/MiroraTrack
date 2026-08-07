import type { DashboardReadPort } from "../application/ports";
import type {
  Account,
  AppMetadata,
  Budget,
  CacheKey,
  CalculationCache,
  Settings,
  Transaction,
} from "../finance/types";
import type { MiroraTrackDatabase } from "./db";

export class DexieDashboardReadRepository implements DashboardReadPort {
  private readonly db: MiroraTrackDatabase;

  constructor(db: MiroraTrackDatabase) {
    this.db = db;
  }

  getSettings(): Promise<Settings | undefined> {
    return this.db.settings.get("primary");
  }

  listAccounts(): Promise<readonly Account[]> {
    return this.db.accounts.toArray();
  }

  listTransactions(): Promise<readonly Transaction[]> {
    return this.db.transactions.toArray();
  }

  listBudgets(): Promise<readonly Budget[]> {
    return this.db.budgets.toArray();
  }

  getMetadata(): Promise<AppMetadata | undefined> {
    return this.db.metadata.get("app");
  }

  getCalculationCache(
    key: CacheKey,
  ): Promise<CalculationCache | undefined> {
    return this.db.calculationCaches.get(key);
  }

  async putCalculationCache(cache: CalculationCache): Promise<void> {
    await this.db.calculationCaches.put(cache);
  }
}
