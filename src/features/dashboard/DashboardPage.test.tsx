import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { DashboardApplication } from '../../app/runtime'
import type { DashboardPayload } from '../../application/dashboardService'
import { currencyCode } from '../../finance/money'
import { minorAmount, type AccountId, type BudgetId, type CategoryId, type TransactionId } from '../../finance/types'
import { DashboardPage } from './DashboardPage'
import { cashFlowDrilldownLink, categoryDrilldownLink } from './drilldown'

afterEach(cleanup)

function service(): DashboardApplication {
  return {
    load: vi.fn().mockResolvedValue(dashboardPayload()),
  }
}

function dashboardPayload(): DashboardPayload {
  return {
      currency: currencyCode('USD'),
      availableCurrencies: [currencyCode('USD')],
      range: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-31T23:59:59.999Z' },
      netWorth: minorAmount(350_000),
      income: minorAmount(500_000),
      expenses: minorAmount(150_000),
      netCashFlow: minorAmount(350_000),
      savingsRatePercent: 70,
      accountBalances: [{ accountId: 'checking' as AccountId, name: 'Checking', type: 'checking', status: 'active', balance: minorAmount(350_000) }],
      cashFlow: [{ date: '2026-07-10', income: minorAmount(500_000), expenses: minorAmount(150_000), netCashFlow: minorAmount(350_000), transactionIds: ['tx-1' as TransactionId] }],
      budgetUsage: [{ budgetId: 'budget-1' as BudgetId, name: 'Food', categoryId: 'food' as CategoryId, categoryLabel: 'Food', month: '2026-07', budgeted: minorAmount(200_000), spent: minorAmount(150_000), remaining: minorAmount(50_000), percentUsed: 75, status: 'on-track', transactionIds: ['tx-1' as TransactionId] }],
      categoryBreakdown: [{ categoryId: 'food' as CategoryId, label: 'Food', amount: minorAmount(150_000), percentOfExpenses: 100, transactionIds: ['tx-1' as TransactionId] }],
      recentTransactions: [],
    }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

describe('DashboardPage', () => {
  it('renders ledger KPIs and accessible chart alternatives', async () => {
    render(<MemoryRouter><DashboardPage service={service()} /></MemoryRouter>)
    expect((await screen.findAllByText('$3,500.00'))[0]).toBeVisible()
    expect(screen.getAllByText('$5,000.00')[0]).toBeVisible()
    expect(await screen.findByRole('table', { name: 'Cash flow details' }, { timeout: 10_000 })).toBeVisible()
    expect(await screen.findByRole('table', { name: 'Spending category details' }, { timeout: 10_000 })).toBeVisible()
    expect(screen.getByText('70%')).toBeVisible()
  })

  it('uses exact encoded transaction drill-down filters and ignores stale loads', async () => {
    const app = service()
    const user = userEvent.setup()
    render(<MemoryRouter><DashboardPage service={app} /></MemoryRouter>)
    await screen.findByText('Cash flow')
    await user.click(screen.getByRole('link', { name: 'View Food expenses' }))
    expect(window.location.hash || document.location.href).not.toContain('undefined')
    expect(screen.getByRole('link', { name: 'View Food expenses' })).toHaveAttribute(
      'href',
      '/transactions?currency=USD&type=expense&categoryId=food&fromDate=2026-07-01&toDate=2026-07-31',
    )

    await user.selectOptions(screen.getByLabelText('Dashboard range'), 'last-month')
    await waitFor(() => expect(app.load).toHaveBeenLastCalledWith(expect.objectContaining({ range: 'last-month' })))
  })

  it('loads this and next month and keeps invalid custom drafts out of the service', async () => {
    const app = service()
    const user = userEvent.setup()
    render(<MemoryRouter><DashboardPage service={app} /></MemoryRouter>)
    await screen.findByText('70%')

    await user.selectOptions(screen.getByLabelText('Dashboard range'), 'this-and-next-month')
    await waitFor(() => expect(app.load).toHaveBeenLastCalledWith(expect.objectContaining({ range: 'this-and-next-month' })))

    await user.selectOptions(screen.getByLabelText('Dashboard range'), 'custom')
    const callsBeforeInvalidDraft = vi.mocked(app.load).mock.calls.length
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2027-01-01' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('From date must be before')
    expect(app.load).toHaveBeenCalledTimes(callsBeforeInvalidDraft)

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2027-12-31' } })
    await waitFor(() => expect(app.load).toHaveBeenLastCalledWith(expect.objectContaining({
      range: { kind: 'custom', start: '2027-01-01', end: '2027-12-31' },
    })))
  })

  it('maps pointer chart drilldowns to the same exact encoded transaction filters', () => {
    const payload = dashboardPayload()
    expect(cashFlowDrilldownLink(payload.cashFlow[0]!, payload.currency)).toBe(
      '/transactions?currency=USD&fromDate=2026-07-10&toDate=2026-07-10',
    )
    expect(categoryDrilldownLink(payload.categoryBreakdown[0]!, payload.currency, payload.range)).toBe(
      '/transactions?currency=USD&type=expense&categoryId=food&fromDate=2026-07-01&toDate=2026-07-31',
    )
  })

  it('reverts failed controls to the retained payload without letting a stale failure revert a newer success', async () => {
    const app = service()
    const user = userEvent.setup()
    render(<MemoryRouter><DashboardPage service={app} /></MemoryRouter>)
    await screen.findByText('70%')
    await waitFor(() => expect(app.load).toHaveBeenCalledWith(expect.objectContaining({ currency: 'USD' })))

    vi.mocked(app.load).mockRejectedValueOnce(new Error('snapshot unstable'))
    await user.selectOptions(screen.getByLabelText('Dashboard range'), 'last-month')
    expect(await screen.findByRole('alert')).toHaveTextContent('last successful results remain visible')
    expect(screen.getByLabelText('Dashboard range')).toHaveValue('this-month')
    expect(screen.getByText('70%')).toBeVisible()

    const older = deferred<DashboardPayload>()
    vi.mocked(app.load).mockImplementation((query) => query.range === 'last-month' ? older.promise : Promise.resolve(dashboardPayload()))
    await user.selectOptions(screen.getByLabelText('Dashboard range'), 'last-month')
    await waitFor(() => expect(app.load).toHaveBeenLastCalledWith(expect.objectContaining({ range: 'last-month' })))
    await user.selectOptions(screen.getByLabelText('Dashboard range'), 'year-to-date')
    await waitFor(() => expect(app.load).toHaveBeenLastCalledWith(expect.objectContaining({ range: 'year-to-date' })))
    older.reject(new Error('old request failed'))
    await waitFor(() => expect(screen.getByLabelText('Dashboard range')).toHaveValue('year-to-date'))
  })
})
