import { performance } from 'node:perf_hooks'
import { describe, expect, it, vi } from 'vitest'
import { DashboardService } from '../../src/application/dashboardService'
import type { DashboardReadPort } from '../../src/application/ports'
import { deriveBalances, summarize } from '../../src/finance/ledger'
import type { Account, AccountId, CalculationCache, CurrencyCode } from '../../src/finance/types'
import { tenThousandTransactions } from '../fixtures/ten-thousand-transactions'

const account: Account = {
  id: 'perf-account' as AccountId,
  name: 'Performance account',
  type: 'checking',
  status: 'active',
  currency: 'USD' as CurrencyCode,
  icon: 'landmark',
  color: 'blue',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('10,000 transaction performance guardrails', () => {
  it('derives balances and a broad cash-flow range in under two seconds', () => {
    const rows = tenThousandTransactions()
    deriveBalances([account], rows.slice(0, 100))
    const started = performance.now()
    const balances = deriveBalances([account], rows)
    const cashFlow = summarize(rows, {
      start: '2026-01-01T00:00:00.000Z',
      end: '2026-12-31T23:59:59.999Z',
    })
    const elapsed = performance.now() - started
    expect(balances.get(account.id)).toBeTypeOf('number')
    expect(cashFlow.income).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2_000)
  })

  it('keeps a warm in-memory filter interaction responsive', () => {
    const rows = tenThousandTransactions()
    rows.filter((row) => row.categoryId === 'groceries')
    const started = performance.now()
    const result = rows.filter((row) =>
      row.categoryId === 'groceries' && row.description?.includes('9'),
    )
    expect(result.length).toBeGreaterThan(0)
    expect(performance.now() - started).toBeLessThan(100)
  })

  it('serves the second 10,000-row dashboard request from cache without recomputation', async () => {
    let cache: CalculationCache | undefined
    const listTransactions = vi.fn(async () => tenThousandTransactions())
    const port: DashboardReadPort = {
      getSettings: vi.fn(async () => ({
        key: 'primary', baseCurrency: 'USD' as CurrencyCode,
        locale: 'en-US', dateFormat: 'MM/dd/yyyy',
        automaticBackupsEnabled: true, automaticBackupIntervalHours: 24,
      })),
      listAccounts: vi.fn(async () => [account]),
      listTransactions,
      listBudgets: vi.fn(async () => []),
      getMetadata: vi.fn(async () => ({
        key: 'app', schemaVersion: 5, calculationVersion: 2,
        ledgerRevision: 10_000, createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-12-31T23:59:59.999Z',
      })),
      getCalculationCache: vi.fn(async () => cache),
      putCalculationCache: vi.fn(async (next) => { cache = next }),
    }
    const subject = new DashboardService(port)
    const query = {
      currency: 'USD' as CurrencyCode,
      range: { start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T23:59:59.999Z' },
    } as const
    const started = performance.now()
    const first = await subject.load(query)
    expect(performance.now() - started).toBeLessThan(2_000)
    const second = await subject.load(query)
    expect(second).toBe(cache?.value)
    expect(first).toEqual(second)
    expect(listTransactions).toHaveBeenCalledTimes(1)
  })
})
