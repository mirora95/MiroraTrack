import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BudgetsApplication } from '../../app/runtime'
import { currencyCode } from '../../finance/money'
import { minorAmount, type Budget, type BudgetId, type BudgetMonth, type CategoryId } from '../../finance/types'
import { BudgetsPage } from './BudgetsPage'

afterEach(cleanup)

const budget: Budget = {
  id: 'budget-food' as BudgetId,
  name: 'Food',
  categoryId: 'food' as CategoryId,
  currency: currencyCode('USD'),
  amount: minorAmount(50_000),
  month: '2026-07' as BudgetMonth,
  rollover: false,
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

function service(rows: Budget[] = [budget]): BudgetsApplication {
  return {
    availableCurrencies: vi.fn().mockResolvedValue([currencyCode('USD')]),
    listCategoryIds: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({
      month: '2026-07',
      currency: currencyCode('USD'),
      rows: rows.map((item) => ({
        budget: item,
        categoryLabel: item.name,
        budgeted: item.amount,
        spent: minorAmount(42_500),
        remaining: minorAmount(7_500),
        percentUsed: 85,
        status: 'warning',
        transactionIds: [],
      })),
      totals: { budgeted: minorAmount(50_000), spent: minorAmount(42_500), remaining: minorAmount(7_500) },
    }),
    create: vi.fn().mockResolvedValue(budget),
    update: vi.fn().mockResolvedValue(budget),
    archive: vi.fn().mockResolvedValue(undefined),
    reactivate: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }
}

describe('BudgetsPage', () => {
  it('offers custom categories previously created outside the selected budget view', async () => {
    const app = service([])
    vi.mocked(app.listCategoryIds!).mockResolvedValueOnce(['custom:expense:pet care'])
    const user = userEvent.setup()
    render(<BudgetsPage service={app} initialMonth="2026-07" />)

    expect(await screen.findByText('A calmer month starts here')).toBeVisible()
    await user.click(screen.getAllByRole('button', { name: 'Create budget' })[0]!)
    expect(await screen.findByRole('option', { name: 'Pet care' })).toBeVisible()
  })

  it('shows numeric progress with text health and keeps a failed form intact', async () => {
    const app = service([])
    vi.mocked(app.create).mockRejectedValueOnce(new Error('disk busy'))
    const user = userEvent.setup()
    render(<BudgetsPage service={app} initialMonth="2026-07" />)

    expect(await screen.findByText('A calmer month starts here')).toBeVisible()
    await user.click(screen.getAllByRole('button', { name: 'Create budget' })[0]!)
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    await user.type(screen.getByLabelText('Amount'), '500')
    await user.click(screen.getByRole('button', { name: 'Save budget' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('values are still here')
    expect(screen.getByLabelText('Amount')).toHaveValue('500')
  })

  it('guards duplicate archive submission and retains the last successful rows during refresh failure', async () => {
    const app = service()
    let resolveArchive!: () => void
    vi.mocked(app.archive).mockImplementation(() => new Promise<void>((resolve) => { resolveArchive = resolve }))
    const user = userEvent.setup()
    render(<BudgetsPage service={app} initialMonth="2026-07" />)

    expect(await screen.findByRole('progressbar', { name: 'Food budget usage' })).toHaveAttribute('aria-valuenow', '85')
    expect(screen.getByText('Warning')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Archive Food budget' }))
    await user.dblClick(screen.getByRole('button', { name: 'Archive budget' }))
    expect(app.archive).toHaveBeenCalledTimes(1)
    resolveArchive()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    vi.mocked(app.list).mockRejectedValueOnce(new Error('read failed'))
    await user.click(screen.getByRole('button', { name: 'Refresh budgets' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('last successful results remain visible')
    expect(screen.getByText('Food')).toBeVisible()
  })

  it('keeps failed lifecycle confirmation visible with an inline retryable alert', async () => {
    const app = service()
    vi.mocked(app.archive).mockRejectedValueOnce(new Error('concurrent'))
    const user = userEvent.setup()
    render(<BudgetsPage service={app} initialMonth="2026-07" />)
    await screen.findByText('Food')
    await user.click(screen.getByRole('button', { name: 'Archive Food budget' }))
    await user.click(screen.getByRole('button', { name: 'Archive budget' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive budget?' })
    expect(dialog).toBeVisible()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('could not be changed')
    await user.click(within(dialog).getByRole('button', { name: 'Archive budget' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(app.archive).toHaveBeenCalledTimes(2)
  })

  it('clamps over-budget progress semantics while preserving the true percentage in text', async () => {
    const app = service()
    vi.mocked(app.list).mockResolvedValue({
      month: '2026-07' as BudgetMonth,
      currency: currencyCode('USD'),
      rows: [{
        budget,
        categoryLabel: 'Food',
        budgeted: minorAmount(50_000),
        spent: minorAmount(60_000),
        remaining: minorAmount(-10_000),
        percentUsed: 120,
        status: 'over-budget',
        transactionIds: [],
      }],
      totals: { budgeted: minorAmount(50_000), spent: minorAmount(60_000), remaining: minorAmount(-10_000) },
    })
    render(<BudgetsPage service={app} initialMonth="2026-07" />)
    const progress = await screen.findByRole('progressbar', { name: 'Food budget usage' })
    expect(progress).toHaveAttribute('aria-valuenow', '100')
    expect(progress).toHaveAttribute('aria-valuetext', '120% used, over budget')
  })
})
