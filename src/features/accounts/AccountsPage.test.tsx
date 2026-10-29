import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountListItem, UpdateAccountCommand } from '../../application/accountService'
import type { AccountDraft } from '../../application/accountRecords'
import { minorAmount, type Account, type AccountId, type CurrencyCode } from '../../finance/types'
import { AccountsPage } from './AccountsPage'
import type { AccountsApplication } from '../../app/runtime'

afterEach(cleanup)

function account(
  id: string,
  name: string,
  currency: string,
  balance: number,
  status: Account['status'] = 'active',
): AccountListItem {
  return {
    account: {
      id: id as AccountId,
      name,
      type: 'checking',
      status,
      currency: currency as CurrencyCode,
      color: 'blue',
      icon: 'landmark',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    balance: minorAmount(balance),
  }
}

function service(items: readonly AccountListItem[] = []): AccountsApplication {
  return {
    list: vi.fn().mockResolvedValue(items),
    create: vi.fn().mockResolvedValue(items[0]?.account),
    update: vi.fn<(command: UpdateAccountCommand) => Promise<Account>>(),
    archive: vi.fn().mockResolvedValue(undefined),
    reactivate: vi.fn().mockResolvedValue(undefined),
  }
}

describe('accounts workspace', () => {
  it('opens an imported account with its currency and four-decimal credit limit', async () => {
    const original = account('imported', 'Imported card', 'CLF', 0)
    const item: AccountListItem = {
      ...original,
      account: { ...original.account, type: 'credit', creditLimit: minorAmount(12345) },
    }
    const user = userEvent.setup()
    render(<AccountsPage service={service([item])} locale="en-US" />)

    await user.click(await screen.findByRole('button', { name: 'Edit Imported card' }))
    expect(screen.getByLabelText('Account currency')).toHaveValue('CLF')
    expect(screen.getByLabelText('Credit limit')).toHaveValue('1.2345')
  })

  it.each([
    ['USD', Number.MAX_SAFE_INTEGER],
    ['JPY', Number.MAX_SAFE_INTEGER],
    ['USD', 1029],
    ['CLF', 12345],
  ] as const)('preserves an unchanged %s credit limit of %s when renaming an account', async (currency, creditLimit) => {
    const original = account('credit', 'Rewards card', currency, 0)
    const item: AccountListItem = {
      ...original,
      account: { ...original.account, type: 'credit', creditLimit: minorAmount(creditLimit) },
    }
    const accounts = service([item])
    vi.mocked(accounts.update).mockResolvedValue(item.account)
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)

    await user.click(await screen.findByRole('button', { name: 'Edit Rewards card' }))
    await user.clear(screen.getByLabelText('Account name'))
    await user.type(screen.getByLabelText('Account name'), 'Renamed card')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(accounts.update).toHaveBeenCalledWith(expect.objectContaining({
      id: 'credit', name: 'Renamed card', currency, creditLimit,
    })))
  })

  it('shows loading, retryable errors, and a premium empty state', async () => {
    const accounts = service()
    vi.mocked(accounts.list)
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce([])
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)

    expect(screen.getByRole('status', { name: 'Loading accounts' })).toBeVisible()
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Bring your accounts together' })).toBeVisible()
  })

  it('renders active and archived accounts without summing currencies', async () => {
    const accounts = service([
      account('usd', 'Checking', 'USD', 12550),
      account('eur', 'Travel', 'EUR', 4000),
      account('old', 'Old savings', 'USD', 100, 'archived'),
    ])
    render(<AccountsPage service={accounts} locale="en-US" />)

    const active = await screen.findByRole('region', { name: 'Active accounts' })
    expect(within(active).getByText('$125.50')).toBeVisible()
    expect(within(active).getByText('€40.00')).toBeVisible()
    expect(screen.queryByText(/total balance/i)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Archived accounts' })).getByText('Old savings')).toBeVisible()
  })

  it('creates an account once, validates credit limit, and reports success', async () => {
    const accounts = service([])
    let resolveCreate!: (value: Account) => void
    vi.mocked(accounts.create).mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve }),
    )
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)
    await screen.findByRole('heading', { name: 'Bring your accounts together' })

    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Account name'), 'Rewards card')
    await user.selectOptions(screen.getByLabelText('Account type'), 'credit')
    await user.clear(screen.getByLabelText('Credit limit'))
    await user.type(screen.getByLabelText('Credit limit'), '-10')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('non-negative')

    await user.clear(screen.getByLabelText('Credit limit'))
    await user.type(screen.getByLabelText('Credit limit'), '10.999')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('valid credit limit')

    await user.clear(screen.getByLabelText('Credit limit'))
    await user.type(screen.getByLabelText('Credit limit'), '2500')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    const busy = screen.getByRole('button', { name: 'Creating account' })
    expect(busy).toBeDisabled()
    await user.click(busy)

    await waitFor(() => expect(accounts.create).toHaveBeenCalledTimes(1))
    expect(accounts.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Rewards card',
      type: 'credit',
      creditLimit: 250000,
    }) satisfies Partial<AccountDraft>)
    resolveCreate(account('credit', 'Rewards card', 'USD', 0).account)
    expect(await screen.findByRole('status')).toHaveTextContent('Account created')
  })

  it('edits, confirms archive, and reactivates while surfacing operation errors', async () => {
    const active = account('usd', 'Checking', 'USD', 12550)
    const archived = account('old', 'Old savings', 'USD', 100, 'archived')
    const accounts = service([active, archived])
    vi.mocked(accounts.update).mockResolvedValue({ ...active.account, name: 'Main checking' })
    vi.mocked(accounts.archive).mockRejectedValueOnce(new Error('locked'))
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)

    await screen.findByText('$125.50')
    await user.click(screen.getByRole('button', { name: 'Edit Checking' }))
    await user.clear(screen.getByLabelText('Account name'))
    await user.type(screen.getByLabelText('Account name'), 'Main checking')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(accounts.update).toHaveBeenCalledWith(expect.objectContaining({
      id: 'usd',
      name: 'Main checking',
    })))

    await user.click(screen.getByRole('button', { name: 'Archive Checking' }))
    expect(screen.getByRole('dialog', { name: 'Archive Checking?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Archive account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not archive')
    expect(screen.getByRole('dialog', { name: 'Archive Checking?' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Reactivate Old savings' }))
    await waitFor(() => expect(accounts.reactivate).toHaveBeenCalledWith('old'))
  })

  it('shows an all-archived state with a direct reactivation action', async () => {
    const accounts = service([account('old', 'Old savings', 'USD', 100, 'archived')])
    render(<AccountsPage service={accounts} locale="en-US" />)

    expect(await screen.findByRole('heading', { name: 'All accounts are archived' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reactivate Old savings' })).toBeVisible()
  })

  it('blocks every create-dialog dismissal while saving and retains values after failure', async () => {
    const accounts = service([])
    let rejectCreate!: (reason: Error) => void
    vi.mocked(accounts.create).mockImplementation(
      () => new Promise((_, reject) => { rejectCreate = reject }),
    )
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)
    await screen.findByRole('heading', { name: 'Bring your accounts together' })
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await user.type(screen.getByLabelText('Account name'), 'Patient savings')
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByRole('presentation'))
    expect(screen.getByRole('dialog', { name: 'Add an account' })).toBeVisible()
    expect(accounts.create).toHaveBeenCalledTimes(1)

    rejectCreate(new Error('write failed'))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not create')
    expect(screen.getByRole('dialog', { name: 'Add an account' })).toBeVisible()
    expect(screen.getByLabelText('Account name')).toHaveValue('Patient savings')
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeEnabled()
  })

  it('keeps edit dismissal locked until the deferred save completes', async () => {
    const existing = account('usd', 'Checking', 'USD', 12550)
    const accounts = service([existing])
    let resolveUpdate!: (value: Account) => void
    vi.mocked(accounts.update).mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve }),
    )
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)
    await screen.findByText('$125.50')
    await user.click(screen.getByRole('button', { name: 'Edit Checking' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'Edit Checking' })).toBeVisible()

    resolveUpdate(existing.account)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit Checking' })).not.toBeInTheDocument(),
    )
  })

  it('guards reactivation per account against rapid duplicate requests', async () => {
    const archived = account('old', 'Old savings', 'USD', 100, 'archived')
    const accounts = service([archived])
    let resolveReactivate!: () => void
    vi.mocked(accounts.reactivate).mockImplementation(
      () => new Promise((resolve) => { resolveReactivate = resolve }),
    )
    const user = userEvent.setup()
    render(<AccountsPage service={accounts} locale="en-US" />)
    await screen.findByRole('heading', { name: 'All accounts are archived' })

    const reactivate = screen.getByRole('button', { name: 'Reactivate Old savings' })
    await user.dblClick(reactivate)
    expect(accounts.reactivate).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Reactivating Old savings' })).toBeDisabled()

    resolveReactivate()
    expect(await screen.findByRole('status')).toHaveTextContent('reactivated')
  })
})
