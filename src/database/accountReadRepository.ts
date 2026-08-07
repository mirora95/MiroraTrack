import type {
  AccountReadPort,
  InitializationReadPort,
} from "../application/ports";
import type { Account, Settings, Transaction } from "../finance/types";
import type { MiroraTrackDatabase } from "./db";

export class DexieAccountReadRepository
implements AccountReadPort, InitializationReadPort {
  private readonly db: MiroraTrackDatabase;

  constructor(db: MiroraTrackDatabase) {
    this.db = db;
  }

  getSettings(): Promise<Settings | undefined> {
    return this.db.settings.get("primary");
  }

  listAccounts(): Promise<Account[]> {
    return this.db.accounts.toArray();
  }

  listTransactions(): Promise<Transaction[]> {
    return this.db.transactions.toArray();
  }
}
