import type { AccountId, CurrencyCode, Transaction, TransactionId } from '../../src/finance/types'

export function tenThousandTransactions(): readonly Transaction[] {
  const account = 'perf-account' as AccountId
  return Array.from({ length: 10_000 }, (_, index): Transaction => ({
    id: `perf-${index.toString().padStart(5, '0')}` as TransactionId,
    type: index % 4 === 0 ? 'income' : 'expense',
    status: 'completed',
    purpose: 'standard',
    amount: 100 + (index % 20_000),
    currency: 'USD' as CurrencyCode,
    effectiveAt: `2026-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 28) + 1).padStart(2, '0')}T12:00:00.000Z`,
    ...(index % 4 === 0
      ? { destinationAccountId: account, categoryId: 'salary' }
      : { sourceAccountId: account, categoryId: index % 2 ? 'groceries' : 'housing' }),
    description: `Performance record ${index}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }))
}
