import type {
  ActivityReadPort,
  TransactionReadPort,
} from "../application/ports";
import type { Account, AuditEntry, Transaction } from "../finance/types";
import type { MiroraTrackDatabase } from "./db";

export class DexieTransactionReadRepository implements TransactionReadPort {
  private readonly db: MiroraTrackDatabase;

  constructor(db: MiroraTrackDatabase) {
    this.db = db;
  }

  listTransactions(): Promise<Transaction[]> {
    return this.db.transactions.toArray();
  }

  listAccounts(): Promise<Account[]> {
    return this.db.accounts.toArray();
  }
}

export class DexieActivityReadRepository implements ActivityReadPort {
  private readonly db: MiroraTrackDatabase;

  constructor(db: MiroraTrackDatabase) {
    this.db = db;
  }

  listAuditEntries(): Promise<AuditEntry[]> {
    return this.db.auditEntries.toArray();
  }
}
