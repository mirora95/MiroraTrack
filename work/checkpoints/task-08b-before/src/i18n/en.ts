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
