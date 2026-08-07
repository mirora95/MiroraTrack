import type { BudgetReadPort } from "../application/ports";
import type {
  Account,
  Budget,
  BudgetId,
  Settings,
  Transaction,
} from "../finance/types";
import type { MiroraTrackDatabase } from "./db";

export class DexieBudgetReadRepository implements BudgetReadPort {
  private readonly db: MiroraTrackDatabase;

  constructor(db: MiroraTrackDatabase) {
    this.db = db;
  }

  getBudget(id: BudgetId): Promise<Budget | undefined> {
    return this.db.budgets.get(id);
  }

  getSettings(): Promise<Settings | undefined> {
    return this.db.settings.get("primary");
  }

  async listBudgets(): Promise<readonly Budget[]> {
    return (await this.db.budgets.toArray()).sort((left, right) =>
      (left.id as string).localeCompare(right.id as string)
    );
  }

  listTransactions(): Promise<readonly Transaction[]> {
    return this.db.transactions.toArray();
  }

  listAccounts(): Promise<readonly Account[]> {
    return this.db.accounts.toArray();
  }
}
