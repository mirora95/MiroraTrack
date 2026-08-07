export interface EnglishDictionary {
  readonly product: {
    readonly name: string;
    readonly tagline: string;
  };
  readonly privacy: {
    readonly localOnly: string;
  };
  readonly transaction: {
    readonly type: {
      readonly income: string;
      readonly expense: string;
      readonly transfer: string;
    };
    readonly status: {
      readonly completed: string;
      readonly planned: string;
      readonly cancelled: string;
    };
  };
  readonly validation: {
    readonly amount: {
      readonly required: string;
      readonly invalid: string;
      readonly positive: string;
    };
    readonly currency: {
      readonly invalid: string;
    };
    readonly account: {
      readonly required: string;
      readonly different: string;
    };
  };
  readonly onboarding: {
    readonly title: string;
    readonly privacy: string;
    readonly submit: string;
  };
  readonly accounts: {
    readonly title: string;
    readonly add: string;
    readonly active: string;
    readonly archived: string;
  };
  readonly ledger: {
    readonly title: string;
    readonly add: string;
    readonly export: string;
    readonly empty: string;
  };
  readonly activity: {
    readonly title: string;
    readonly empty: string;
  };
  readonly budgets: {
    readonly title: string;
    readonly add: string;
    readonly empty: string;
    readonly onTrack: string;
    readonly warning: string;
    readonly overBudget: string;
  };
  readonly dashboard: {
    readonly title: string;
    readonly netWorth: string;
    readonly income: string;
    readonly expenses: string;
    readonly netFlow: string;
    readonly savingsRate: string;
  };
  readonly settings: {
    readonly title: string;
    readonly save: string;
    readonly backup: string;
    readonly exportJson: string;
    readonly exportCsv: string;
    readonly restore: string;
    readonly restart: string;
  };
}

export const en = {
  product: {
    name: "MiroraTrack",
    tagline: "Private personal finance, kept on your device.",
  },
  privacy: {
    localOnly: "Your financial data stays on this device.",
  },
  transaction: {
    type: {
      income: "Income",
      expense: "Expense",
      transfer: "Transfer",
    },
    status: {
      completed: "Completed",
      planned: "Planned",
      cancelled: "Cancelled",
    },
  },
  validation: {
    amount: {
      required: "Enter an amount.",
      invalid: "Enter a valid amount.",
      positive: "Amount must be greater than zero.",
    },
    currency: {
      invalid: "Choose a valid currency.",
    },
    account: {
      required: "Choose an account.",
      different: "Choose two different accounts.",
    },
  },
  onboarding: {
    title: "Create your private financial workspace.",
    privacy: "No account. No cloud sync. No MiroraTrack analytics.",
    submit: "Create my workspace",
  },
  accounts: {
    title: "Accounts",
    add: "Add account",
    active: "Active accounts",
    archived: "Archived accounts",
  },
  ledger: {
    title: "Transactions",
    add: "Add transaction",
    export: "Export CSV",
    empty: "Your ledger is ready",
  },
  activity: {
    title: "Activity",
    empty: "No activity yet",
  },
  budgets: {
    title: "Budgets",
    add: "Create budget",
    empty: "A calmer month starts here",
    onTrack: "On track",
    warning: "Warning",
    overBudget: "Over budget",
  },
  dashboard: {
    title: "Dashboard",
    netWorth: "Net worth",
    income: "Income",
    expenses: "Expenses",
    netFlow: "Net flow",
    savingsRate: "Savings rate",
  },
  settings: {
    title: "Settings",
    save: "Save preferences",
    backup: "Backup and export",
    exportJson: "Export JSON",
    exportCsv: "Export all CSV",
    restore: "Restore from JSON",
    restart: "Restart MiroraTrack",
  },
} as const satisfies EnglishDictionary;

type DottedKey<T> = {
  [Key in keyof T & string]: T[Key] extends string
    ? Key
    : T[Key] extends Readonly<Record<string, unknown>>
      ? `${Key}.${DottedKey<T[Key]>}`
      : never;
}[keyof T & string];

export type MessageKey = DottedKey<EnglishDictionary>;
export type EnglishMessageKey = MessageKey;
