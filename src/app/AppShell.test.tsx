/// <reference types="node" />
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { Dialog } from '../components/Dialog'
import { EmptyState } from '../components/EmptyState'
import { StatusState } from '../components/StatusState'
import {
  hydratePreferences,
  PREFERENCES_STORAGE_KEY,
  usePreferences,
} from '../stores/preferences'
import { AppRouter } from './App'
import type { AppRuntime } from './runtime'
import indexHtmlSource from '../../index.html?raw'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('premium application shell', () => {
  beforeEach(() => {
    window.location.hash = '#/'
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    usePreferences.setState({ theme: 'system', sidebarCollapsed: false })
  })

  it('renders the six destinations in order and marks Dashboard current', async () => {
    renderReadyApp()

    const navigation = await screen.findByRole('navigation', {
      name: 'Primary navigation',
    })
    expect(screen.getByRole('img', { name: 'MiroraTrack' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'MiroraTrack home' })).toBeVisible()
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Dashboard',
      'Transactions',
      'Accounts',
      'Budgets',
      'Activity',
      'Settings',
    ])
    expect(within(navigation).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('navigates in the desktop document and redirects unknown hashes to Dashboard', async () => {
    const user = userEvent.setup()
    renderReadyApp()

    await user.click(await screen.findByRole('link', { name: 'Budgets' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Budgets' }, { timeout: 4_000 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Budgets' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    window.location.hash = '#/not-a-route'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 1, name: 'Dashboard' }),
      ).toBeInTheDocument(),
    )
  })

  it('switches theme and restores a persisted preference', async () => {
    const user = userEvent.setup()
    renderReadyApp()

    const chooser = await screen.findByLabelText('Theme')
    expect(chooser).toHaveValue('system')
    await user.selectOptions(chooser, 'dark')

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).toContain(
      '"theme":"dark"',
    )

    usePreferences.setState({ theme: 'light', sidebarCollapsed: false })
    hydratePreferences()
    expect(usePreferences.getState().theme).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('falls back from invalid persisted preferences', () => {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, '{"theme":"sepia"}')

    expect(() => hydratePreferences()).not.toThrow()
    expect(usePreferences.getState().theme).toBe('system')
    expect(usePreferences.getState().sidebarCollapsed).toBe(false)
  })

  it('persists sidebar collapse and exposes its expanded state', async () => {
    const user = userEvent.setup()
    renderReadyApp()

    const collapse = await screen.findByRole('button', { name: 'Collapse sidebar' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await user.click(collapse)

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.queryByRole('img', { name: 'MiroraTrack' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MiroraTrack home' })).toBeVisible()
    expect(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)).toContain(
      '"sidebarCollapsed":true',
    )
  })

  it('provides a keyboard-operable global quick-add transaction dialog', async () => {
    const user = userEvent.setup()
    renderReadyApp()

    const quickAdd = await screen.findByRole('button', {
      name: 'Quick add transaction',
    })
    quickAdd.focus()
    expect(quickAdd).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('dialog', { name: 'Add transaction' }),
    ).toBeInTheDocument()
  })

  it('moves focus to the labelled main content from the skip link', async () => {
    const user = userEvent.setup()
    renderReadyApp()

    const skip = await screen.findByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#main-content')
    await user.click(skip)

    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus())
    expect(screen.getByRole('main')).toHaveAccessibleName('Dashboard')
  })

  it('traps dialog focus, closes on Escape, and restores invoker focus', async () => {
    const user = userEvent.setup()
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open confirmation</Button>
          <Dialog
            open={open}
            title="Confirm action"
            description="Review this action before continuing."
            onClose={() => setOpen(false)}
          >
            <Button>Cancel</Button>
            <Button>Confirm</Button>
          </Dialog>
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open confirmation' })
    await user.click(trigger)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Confirm' })
    await waitFor(() => expect(cancel).toHaveFocus())
    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('gives empty and status states text semantics independent of color', () => {
    render(
      <>
        <Card aria-label="Summary">Card content</Card>
        <EmptyState
          title="Nothing here yet"
          description="Add the first item to begin."
          action={<Button>Add item</Button>}
        />
        <StatusState tone="success">Backup complete</StatusState>
        <Button loading loadingLabel="Saving transaction">
          Save
        </Button>
      </>,
    )

    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nothing here yet' })).toBeInTheDocument()
    expect(screen.getByText('Add the first item to begin.')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Backup complete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saving transaction' })).toBeDisabled()
  })

  it('renders when localStorage and matchMedia are unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied')
    })
    vi.stubGlobal('matchMedia', () => {
      throw new Error('media query denied')
    })
    const user = userEvent.setup()

    expect(() => renderReadyApp()).not.toThrow()
    await user.selectOptions(await screen.findByLabelText('Theme'), 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  })

  it('keeps all routes and theme selection available at narrow widths', () => {
    const stylesSource = readFileSync(resolve('src/styles/index.css'), 'utf8')
    const narrowStyles = stylesSource.slice(
      stylesSource.indexOf('@media (max-width: 640px)'),
    )
    const navigationRule = narrowStyles.match(
      /\.sidebar__nav\s*\{([^}]*)\}/s,
    )?.[1]
    const themeRule = narrowStyles.match(/\.theme-control\s*\{([^}]*)\}/s)?.[1]

    expect(navigationRule).toMatch(/display:\s*grid/)
    expect(navigationRule).not.toMatch(/display:\s*none/)
    expect(themeRule).toMatch(/display:\s*flex/)
  })

  it('focuses an empty dialog panel and keeps Tab inside', async () => {
    const user = userEvent.setup()
    function EmptyDialogHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open empty dialog</Button>
          <Dialog open={open} title="Empty dialog" onClose={() => setOpen(false)}>
            <span>No interactive content</span>
          </Dialog>
        </>
      )
    }

    render(<EmptyDialogHarness />)
    const trigger = screen.getByRole('button', { name: 'Open empty dialog' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Empty dialog' })).toBeInTheDocument()

    const close = screen.getByRole('button', { name: 'Close dialog' })
    await waitFor(() => expect(close).toHaveFocus())
    await user.tab()
    expect(close).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
  })

  it('uses status foreground tokens with at least 4.5:1 light contrast', () => {
    const tokensSource = readFileSync(resolve('src/styles/tokens.css'), 'utf8')
    const pairs = [
      ['--status-success-foreground', '--status-income', 0.11],
      ['--status-error-foreground', '--status-expense', 0.11],
      ['--status-warning-foreground', '--status-warning', 0.11],
      ['--status-neutral-foreground', '--action-primary', 0.1],
    ] as const

    for (const [foregroundToken, tintToken, tintOpacity] of pairs) {
      const foreground = tokensSource.match(
        new RegExp(`${foregroundToken}:\\s*(#[0-9a-f]{6})`, 'i'),
      )?.[1]
      const tint = tokensSource.match(
        new RegExp(`${tintToken}:\\s*(#[0-9a-f]{6})`, 'i'),
      )?.[1]
      expect(
        foreground,
        `${foregroundToken} must be a six-digit hex token`,
      ).toBeDefined()
      expect(tint, `${tintToken} must be a six-digit hex token`).toBeDefined()
      expect(
        contrastRatio(
          foreground!,
          blendHex(tint!, '#ffffff', tintOpacity),
        ),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('bootstraps the stored theme before the application module', () => {
    const bootstrap = indexHtmlSource.match(
      /<script data-theme-bootstrap>([\s\S]*?)<\/script>/,
    )?.[1]
    expect(bootstrap).toContain(PREFERENCES_STORAGE_KEY)
    expect(indexHtmlSource.indexOf('data-theme-bootstrap')).toBeLessThan(
      indexHtmlSource.indexOf('src="/src/main.tsx"'),
    )

    const root = document.documentElement
    root.removeAttribute('data-theme')
    const run = new Function('localStorage', 'window', 'document', bootstrap!)
    run(
      { getItem: () => '{"theme":"dark","sidebarCollapsed":false}' },
      { matchMedia: () => ({ matches: false }) },
      document,
    )
    expect(root).toHaveAttribute('data-theme', 'dark')

    root.removeAttribute('data-theme')
    expect(() =>
      run(
        {
          getItem: () => {
            throw new Error('denied')
          },
        },
        { matchMedia: () => ({ matches: false }) },
        document,
      ),
    ).not.toThrow()
    expect(root).toHaveAttribute('data-theme', 'light')
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

function renderReadyApp() {
  return render(<AppRouter runtime={readyRuntime} />)
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      )
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const light = Math.max(luminance(foreground), luminance(background))
  const dark = Math.min(luminance(foreground), luminance(background))
  return (light + 0.05) / (dark + 0.05)
}

function blendHex(foreground: string, background: string, opacity: number): string {
  const channels = (color: string) =>
    color
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16))
  const foregroundChannels = channels(foreground)
  const backgroundChannels = channels(background)
  return `#${foregroundChannels
    .map((channel, index) =>
      Math.round(channel * opacity + backgroundChannels[index] * (1 - opacity))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
