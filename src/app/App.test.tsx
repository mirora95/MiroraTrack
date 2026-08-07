import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRouter } from './App'
import type { AppRuntime } from './runtime'

afterEach(cleanup)

describe('MiroraTrack desktop application', () => {
  it('renders the product identity inside the routed desktop shell', async () => {
    window.location.hash = '#/'
    render(<AppRouter runtime={readyRuntime} />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('MiroraTrack')).toBeVisible()
    expect(screen.getByRole('img', { name: 'MiroraTrack' })).toBeVisible()
    expect(screen.getByRole('main')).toHaveAccessibleName('Dashboard')
  })

  it('renders before starting backups at idle and remains idempotent in StrictMode', async () => {
    const idleTasks: Array<() => void> = []
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: vi.fn((task: () => void) => {
        idleTasks.push(task)
        return idleTasks.length
      }),
    })
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: vi.fn(),
    })
    const automaticBackups = {
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      notifyStructuredDataChanged: vi.fn(),
      retryNow: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockReturnValue({ phase: 'idle' as const }),
      subscribe: vi.fn().mockReturnValue(vi.fn()),
    }
    const { unmount } = render(
      <StrictMode>
        <AppRouter runtime={{ ...readyRuntime, automaticBackups }} />
      </StrictMode>,
    )
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })
    expect(automaticBackups.start).not.toHaveBeenCalled()

    idleTasks.forEach((task) => task())
    expect(automaticBackups.start).toHaveBeenCalledTimes(1)

    unmount()
    expect(automaticBackups.stop).toHaveBeenCalledTimes(1)
    Reflect.deleteProperty(window, 'requestIdleCallback')
    Reflect.deleteProperty(window, 'cancelIdleCallback')
  })
})

const readyRuntime: AppRuntime = {
  initialization: {
    getState: async () => ({ status: 'ready' }),
    initialize: async () => undefined,
  },
  accounts: {
    list: async () => [],
    create: async () => { throw new Error('not used') },
    update: async () => { throw new Error('not used') },
    archive: async () => undefined,
    reactivate: async () => undefined,
  },
  transactions: {
    list: async () => ({ items: [], total: 0, page: 1, pageCount: 0, summaries: [], facets: { types: { income: 0, expense: 0, transfer: 0 }, statuses: { completed: 0, planned: 0, cancelled: 0 }, currencies: [], accounts: [], categories: [] } }),
    exportFiltered: async () => null,
    create: async () => { throw new Error('not used') },
    edit: async () => { throw new Error('not used') },
    delete: async () => undefined,
  },
  activity: { list: async () => ({ items: [], total: 0, page: 1, pageCount: 0 }) },
  budgets: {
    list: async () => ({ month: '2026-07' as never, currency: 'USD' as never, rows: [], totals: { budgeted: 0 as never, spent: 0 as never, remaining: 0 as never } }),
    availableCurrencies: async () => ['USD' as never],
    create: async () => { throw new Error('not used') },
    update: async () => { throw new Error('not used') },
    archive: async () => undefined,
    reactivate: async () => undefined,
    delete: async () => undefined,
  },
  dashboard: {
    load: async () => ({
      currency: 'USD' as never, availableCurrencies: ['USD' as never],
      range: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-31T23:59:59.999Z' },
      netWorth: 0 as never, income: 0 as never, expenses: 0 as never, netCashFlow: 0 as never, savingsRatePercent: null,
      accountBalances: [], cashFlow: [], budgetUsage: [], categoryBreakdown: [], recentTransactions: [],
    }),
  },
  settings: {} as AppRuntime['settings'],
  dataManagement: {} as AppRuntime['dataManagement'],
}
