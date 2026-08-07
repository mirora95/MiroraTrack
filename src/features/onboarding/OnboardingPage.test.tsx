import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InitializeCommand, InitializationState } from '../../application/initializationService'
import type { AccountListItem, UpdateAccountCommand } from '../../application/accountService'
import type { Account } from '../../finance/types'
import { AppRouter } from '../../app/App'
import type { AppRuntime } from '../../app/runtime'

afterEach(cleanup)

function runtimeWithState(
  state: InitializationState,
  initialize = vi.fn<(command: InitializeCommand) => Promise<void>>(),
): AppRuntime {
  return {
    initialization: {
      getState: vi.fn().mockResolvedValue(state),
      initialize,
    },
    accounts: {
      list: vi.fn<() => Promise<readonly AccountListItem[]>>().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn<(command: UpdateAccountCommand) => Promise<Account>>(),
      archive: vi.fn<(id: string) => Promise<void>>(),
      reactivate: vi.fn<(id: string) => Promise<void>>(),
    },
    transactions: {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 0, summaries: [], facets: { types: { income: 0, expense: 0, transfer: 0 }, statuses: { completed: 0, planned: 0, cancelled: 0 }, currencies: [], accounts: [], categories: [] } }),
      exportFiltered: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      edit: vi.fn(),
      delete: vi.fn(),
    },
    activity: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 0 }) },
    budgets: {
      list: vi.fn(), availableCurrencies: vi.fn(), create: vi.fn(), update: vi.fn(),
      archive: vi.fn(), reactivate: vi.fn(), delete: vi.fn(),
    },
    dashboard: { load: vi.fn() },
    settings: {} as AppRuntime['settings'],
    dataManagement: {} as AppRuntime['dataManagement'],
  }
}

describe('onboarding route and flow', () => {
  it('shows a loading state, then routes an uninitialized workspace to onboarding', async () => {
    let resolveState!: (state: InitializationState) => void
    const runtime = runtimeWithState({ status: 'uninitialized' })
    runtime.initialization.getState = vi.fn<() => Promise<InitializationState>>(
      () => new Promise((resolve) => { resolveState = resolve }),
    )
    window.location.hash = '#/'

    render(<AppRouter runtime={runtime} />)

    expect(screen.getByRole('status', { name: 'Preparing your private workspace' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'MiroraTrack' })).toBeVisible()
    resolveState({ status: 'uninitialized' })
    expect(await screen.findByRole('heading', { name: 'Choose your home currency' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'MiroraTrack' })).toBeVisible()
    expect(screen.getByText('MiroraTrack')).toBeVisible()
    expect(screen.getByText('No account. No cloud sync. No MiroraTrack analytics.')).toBeVisible()
    expect(screen.queryByText('No account. No cloud. No tracking.')).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/onboarding')
  })

  it('completes four retained steps and initializes a differently denominated first account once', async () => {
    let resolveInitialize!: () => void
    const initialize = vi.fn<(command: InitializeCommand) => Promise<void>>(
      () => new Promise((resolve) => { resolveInitialize = resolve }),
    )
    const runtime = runtimeWithState({ status: 'uninitialized' }, initialize)
    const user = userEvent.setup()
    window.location.hash = '#/onboarding'
    render(<AppRouter runtime={runtime} />)

    await screen.findByRole('heading', { name: 'Choose your home currency' })
    await user.selectOptions(screen.getByLabelText('Base currency'), 'USD')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Set your date format' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Date format'), 'dd/MM/yyyy')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Base currency')).toHaveValue('USD')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Add your first account' })).toBeVisible()
    await user.type(screen.getByLabelText('Account name'), 'Everyday checking')
    await user.selectOptions(screen.getByLabelText('Account currency'), 'EUR')
    await user.selectOptions(screen.getByLabelText('Account type'), 'checking')
    await user.selectOptions(screen.getByLabelText('Account icon'), 'landmark')
    await user.selectOptions(screen.getByLabelText('Account color'), 'teal')
    await user.clear(screen.getByLabelText('Opening balance'))
    await user.type(screen.getByLabelText('Opening balance'), '-42.50')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByRole('heading', { name: 'Ready when you are' })).toBeVisible()
    expect(screen.getByText('Everyday checking')).toBeVisible()
    expect(screen.getByText(/demo data/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Create my workspace' }))
    const busy = screen.getByRole('button', { name: 'Setting up MiroraTrack' })
    expect(busy).toBeDisabled()
    await user.click(busy)

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1))
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      baseCurrency: 'USD',
      dateFormat: 'dd/MM/yyyy',
      account: expect.objectContaining({
        name: 'Everyday checking',
        currency: 'EUR',
        type: 'checking',
        icon: 'landmark',
        color: 'teal',
        openingBalance: -4250,
      }),
    }))
    resolveInitialize()
    await waitFor(() => expect(window.location.hash).toBe('#/'))
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  it('keeps form values and announces a failed initialization without navigating', async () => {
    const initialize = vi.fn().mockRejectedValue(new Error('disk unavailable'))
    const runtime = runtimeWithState({ status: 'uninitialized' }, initialize)
    const user = userEvent.setup()
    window.location.hash = '#/onboarding'
    render(<AppRouter runtime={runtime} />)

    await screen.findByRole('heading', { name: 'Choose your home currency' })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Account name'), 'Cash')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create my workspace' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not create')
    expect(window.location.hash).toBe('#/onboarding')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Account name')).toHaveValue('Cash')
  })

  it('validates a signed opening balance before calling initialization', async () => {
    const initialize = vi.fn<(command: InitializeCommand) => Promise<void>>()
    const runtime = runtimeWithState({ status: 'uninitialized' }, initialize)
    const user = userEvent.setup()
    window.location.hash = '#/onboarding'
    render(<AppRouter runtime={runtime} />)

    await screen.findByRole('heading', { name: 'Choose your home currency' })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.type(screen.getByLabelText('Account name'), 'Cash')
    await user.clear(screen.getByLabelText('Opening balance'))
    await user.type(screen.getByLabelText('Opening balance'), '12.345')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await user.click(screen.getByRole('button', { name: 'Create my workspace' }))

    expect(screen.getByRole('alert')).toHaveTextContent('valid opening balance')
    expect(initialize).not.toHaveBeenCalled()
  })

  it('redirects ready users away from onboarding and blocks recovery state', async () => {
    window.location.hash = '#/onboarding'
    const { unmount } = render(<AppRouter runtime={runtimeWithState({ status: 'ready' })} />)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeVisible()
    expect(window.location.hash).toBe('#/')
    unmount()

    window.location.hash = '#/accounts'
    render(
      <AppRouter runtime={runtimeWithState({
        status: 'recovery-required',
        reason: 'invalid-records',
      })} />,
    )
    expect(await screen.findByRole('heading', { name: 'Your data needs attention' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'MiroraTrack' })).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Primary navigation' })).not.toBeInTheDocument()
  })
})
