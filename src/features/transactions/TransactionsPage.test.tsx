import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountsApplication, TransactionsApplication } from '../../app/runtime'
import type { AccountListItem } from '../../application/accountService'
import { currencyCode } from '../../finance/money'
import { minorAmount, type Account, type AccountId, type TransactionId } from '../../finance/types'
import { TransactionDialogProvider, useTransactionDialog } from './TransactionDialogProvider'
import { TransactionsPage } from './TransactionsPage'
import { localDateInputValue } from './TransactionForm'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'

afterEach(cleanup)

const account: Account = {
  id: 'account-1' as AccountId,
  name: 'Everyday',
  type: 'checking',
  status: 'active',
  currency: currencyCode('USD'),
  color: 'blue',
  icon: 'landmark',
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
}

const accountList: AccountListItem = { account, balance: minorAmount(0) }

function emptyPage() {
  return {
    items: [],
    total: 0,
    page: 1,
    pageCount: 0,
    summaries: [],
    facets: {
      types: { income: 0, expense: 0, transfer: 0 },
      statuses: { completed: 0, planned: 0, cancelled: 0 },
      currencies: [],
      accounts: [],
      categories: [],
    },
  } as const
}

function services() {
  const transactions: TransactionsApplication = {
    list: vi.fn().mockResolvedValue(emptyPage()),
    exportFiltered: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({
      id: 'transaction-1' as TransactionId,
      type: 'expense',
      status: 'completed',
      purpose: 'standard',
      amount: minorAmount(100),
      currency: currencyCode('USD'),
      effectiveAt: '2026-07-29T00:00:00.000Z',
      sourceAccountId: account.id,
      categoryId: 'food' as never,
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    }),
    edit: vi.fn(),
    delete: vi.fn(),
  }
  const accounts: AccountsApplication = {
    list: vi.fn().mockResolvedValue([accountList]),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    reactivate: vi.fn(),
  }
  return { transactions, accounts }
}

describe('TransactionsPage', () => {
  it('initializes from valid dashboard drill-down parameters and ignores invalid values', async () => {
    const { transactions, accounts } = services()
    render(
      <MemoryRouter initialEntries={['/transactions?currency=USD&type=expense&accountId=account-1&categoryId=food&fromDate=2026-07-01&toDate=2026-07-31&status=bogus']}>
        <TransactionDialogProvider transactions={transactions} accounts={accounts}>
          <TransactionsPage service={transactions} accounts={accounts} />
        </TransactionDialogProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(transactions.list).toHaveBeenCalledWith({
      page: 1,
      pageSize: 25,
      sort: 'newest',
      currency: 'USD',
      type: 'expense',
      accountId: 'account-1',
      categoryId: 'food',
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
    }))
    expect(screen.getByRole('combobox', { name: 'Transaction type' })).toHaveValue('expense')
  })

  it('ignores impossible drill-down dates instead of crashing the route', async () => {
    const { transactions, accounts } = services()
    render(
      <MemoryRouter initialEntries={['/transactions?currency=USD&fromDate=2026-99-40']}>
        <TransactionDialogProvider transactions={transactions} accounts={accounts}>
          <TransactionsPage service={transactions} accounts={accounts} />
        </TransactionDialogProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(transactions.list).toHaveBeenCalledWith({
      page: 1, pageSize: 25, sort: 'newest', currency: 'USD',
    }))
  })

  it('follows same-route Back/Forward query changes and writes UI filters deterministically', async () => {
    const { transactions, accounts } = services()
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/transactions?type=income', '/transactions?type=expense&currency=USD']} initialIndex={1}>
        <TransactionDialogProvider transactions={transactions} accounts={accounts}>
          <TransactionsNavigationHarness service={transactions} accounts={accounts} />
        </TransactionDialogProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(transactions.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'expense', currency: 'USD' })))
    await user.click(screen.getByRole('button', { name: 'Go back' }))
    await waitFor(() => expect(transactions.list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'income' })))
    expect(screen.getByRole('combobox', { name: 'Transaction type' })).toHaveValue('income')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Transaction status' }), 'completed')
    await waitFor(() => expect(screen.getByTestId('current-search')).toHaveTextContent('?type=income&status=completed'))
  })

  it('uses local calendar parts for the new-transaction date across UTC rollovers', () => {
    const positiveOffsetMidnight = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 30,
    }
    const negativeOffsetLateNight = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 28,
    }

    expect(localDateInputValue(positiveOffsetMidnight)).toBe('2026-07-30')
    expect(localDateInputValue(negativeOffsetLateNight)).toBe('2026-07-28')
  })

  it('loads the ledger and applies complete filters', async () => {
    const { transactions, accounts } = services()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TransactionDialogProvider transactions={transactions} accounts={accounts}>
          <TransactionsPage service={transactions} accounts={accounts} />
        </TransactionDialogProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Your ledger is ready')).toBeVisible()
    await user.type(screen.getByRole('textbox', { name: 'Search transactions' }), 'rent')
    await waitFor(() => expect(transactions.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'rent', page: 1, pageSize: 25 }),
    ))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Transaction type' }), 'expense')
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(transactions.list).toHaveBeenLastCalledWith({
      page: 1,
      pageSize: 25,
      sort: 'newest',
    }))
  })

  it('opens global-style quick add as expense, retains values after failure, and blocks repeated submit', async () => {
    const { transactions, accounts } = services()
    let reject!: (reason: Error) => void
    vi.mocked(transactions.create).mockImplementation(() => new Promise((_, rejectPromise) => { reject = rejectPromise }))
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TransactionDialogProvider transactions={transactions} accounts={accounts}>
          <QuickAddHarness />
        </TransactionDialogProvider>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Open quick add' }))
    expect(screen.getByRole('radio', { name: 'Expense' })).toBeChecked()
    await screen.findByRole('option', { name: 'Everyday · USD' })
    await user.type(screen.getByLabelText('Amount'), '12.34')
    await user.selectOptions(screen.getByLabelText('Account'), account.id)
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    const save = screen.getByRole('button', { name: 'Add transaction' })
    await user.dblClick(save)
    expect(transactions.create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Saving transaction' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Add transaction' })).toBeVisible()
    reject(new Error('disk busy'))
    expect(await screen.findByRole('alert')).toHaveTextContent('values are still here')
    expect(screen.getByLabelText('Amount')).toHaveValue('12.34')
  })

  it('closes only after commit and restores focus to the quick-add trigger', async () => {
    const { transactions, accounts } = services()
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TransactionDialogProvider transactions={transactions} accounts={accounts}>
          <QuickAddHarness />
        </TransactionDialogProvider>
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: 'Open quick add' })
    await user.click(trigger)
    await screen.findByRole('option', { name: 'Everyday · USD' })
    await user.type(screen.getByLabelText('Amount'), '1')
    await user.selectOptions(screen.getByLabelText('Account'), account.id)
    await user.selectOptions(screen.getByLabelText('Category'), 'food')
    await user.click(screen.getByRole('button', { name: 'Add transaction' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

function QuickAddHarness() {
  const { openCreate } = useTransactionDialog()
  return <button onClick={openCreate}>Open quick add</button>
}

function TransactionsNavigationHarness({ service, accounts }: { service: TransactionsApplication; accounts: AccountsApplication }) {
  const navigate = useNavigate()
  const location = useLocation()
  return <>
    <button onClick={() => navigate(-1)}>Go back</button>
    <output data-testid="current-search">{location.search}</output>
    <TransactionsPage service={service} accounts={accounts} />
  </>
}
