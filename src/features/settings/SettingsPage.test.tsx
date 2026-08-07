import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFERENCES_STORAGE_KEY } from '../../stores/preferences'
import type { Settings } from '../../finance/types'
import { usePreferences } from '../../stores/preferences'
import { SettingsPage } from './SettingsPage'

afterEach(cleanup)

const settings: Settings = {
  key: 'primary',
  baseCurrency: 'USD' as never,
  locale: 'en-US',
  dateFormat: 'yyyy-MM-dd',
  backupFolderPath: 'E:\\Finance backups',
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
}

function services() {
  let backupListener:
    | ((status: {
      phase: 'success' | 'warning' | 'failed' | 'scheduled'
      nextEligibleAt?: string
    }) => void)
    | undefined
  const unsubscribe = vi.fn()
  return {
    settings: {
      get: vi.fn().mockResolvedValue(settings),
      update: vi.fn().mockImplementation(async (next: Settings) => next),
    },
    dataManagement: {
      getBackupStatus: vi.fn().mockResolvedValue({
        id: 'automatic',
        folderPath: 'E:\\Finance backups',
        lastAttemptAt: '2026-07-29T09:00:00.000Z',
        lastSuccessfulAt: '2026-07-29T08:00:00.000Z',
        status: 'failed',
        schemaVersion: 5,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'safe',
      }),
      chooseBackupFolder: vi.fn().mockResolvedValue({
        status: 'success',
        folderPath: 'F:\\MiroraTrack',
      }),
      resetBackupFolder: vi.fn().mockResolvedValue(undefined),
      exportJson: vi.fn().mockResolvedValue({ status: 'cancelled' }),
      exportCsv: vi.fn().mockResolvedValue({ status: 'cancelled' }),
      selectImport: vi.fn().mockResolvedValue(null),
      restore: vi.fn(),
      invalidateRestoreCandidate: vi.fn(),
    },
    automaticBackups: {
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      notifyStructuredDataChanged: vi.fn(),
      retryNow: vi.fn(),
      status: vi.fn().mockReturnValue({
        phase: 'scheduled',
        nextEligibleAt: '2026-07-30T12:01:00.000Z',
      }),
      subscribe: vi.fn((listener) => {
        backupListener = listener
        return unsubscribe
      }),
    },
    emitBackupStatus(status: Parameters<NonNullable<typeof backupListener>>[0]) {
      backupListener?.(status)
    },
    unsubscribe,
  }
}

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear()
    usePreferences.setState({
      theme: 'system',
      density: 'comfortable',
      selectedDisplayCurrency: 'USD' as never,
    })
  })

  it('updates display preferences and financial settings independently', async () => {
    const user = userEvent.setup()
    const service = services()
    render(<SettingsPage {...service} onRestoreComplete={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Appearance'), 'dark')
    await user.selectOptions(screen.getByLabelText('Density'), 'compact')
    await user.selectOptions(screen.getByLabelText('Locale'), 'en-GB')
    await user.selectOptions(screen.getByLabelText('Date format'), 'dd/MM/yyyy')
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => expect(service.settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'en-GB', dateFormat: 'dd/MM/yyyy' }),
      expect.objectContaining({ acknowledgeNoConversion: false }),
    ))
    expect(usePreferences.getState()).toMatchObject({
      theme: 'dark',
      density: 'compact',
    })
  })

  it('requires explicit no-conversion acknowledgement for base currency', async () => {
    const user = userEvent.setup()
    const service = services()
    render(<SettingsPage {...service} onRestoreComplete={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Settings' })

    await user.selectOptions(screen.getByLabelText('Base currency'), 'EUR')
    expect(screen.getByText(/does not convert existing records/i)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    expect(service.settings.update).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox', {
      name: /I understand existing amounts will not be converted/i,
    }))
    await user.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(service.settings.update).toHaveBeenCalledWith(
      expect.objectContaining({ baseCurrency: 'EUR' }),
      { acknowledgeNoConversion: true },
    ))
  })

  it('offers exactly the finance-engine currencies for base and display currency', async () => {
    const service = services()
    render(<SettingsPage {...service} onRestoreComplete={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Settings' })

    const optionValues = (label: string) =>
      within(screen.getByLabelText(label))
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value)

    expect(optionValues('Base currency')).toEqual(['USD', 'EUR', 'GBP', 'UZS', 'JPY'])
    expect(optionValues('Display currency')).toEqual(['USD', 'EUR', 'GBP', 'UZS', 'JPY'])
  })

  it('persists display currency locally without changing base currency', async () => {
    const user = userEvent.setup()
    const service = services()
    render(<SettingsPage {...service} onRestoreComplete={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Settings' })

    await user.selectOptions(screen.getByLabelText('Display currency'), 'UZS')

    expect(usePreferences.getState().selectedDisplayCurrency).toBe('UZS')
    expect(JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}'))
      .toMatchObject({ selectedDisplayCurrency: 'UZS' })
    expect(service.settings.update).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Base currency')).toHaveValue('USD')
  })

  it('shows safe backup health and guards duplicate folder selection', async () => {
    const user = userEvent.setup()
    const service = services()
    service.settings.get
      .mockResolvedValueOnce(settings)
      .mockResolvedValue({ ...settings, backupFolderPath: 'F:\\MiroraTrack' })
    let resolveFolder!: (value: { status: 'success'; folderPath: string }) => void
    service.dataManagement.chooseBackupFolder.mockReturnValueOnce(
      new Promise((resolve) => { resolveFolder = resolve }),
    )
    render(<SettingsPage {...service} onRestoreComplete={vi.fn()} />)

    const panel = await screen.findByRole('region', { name: 'Backup and export' })
    expect(within(panel).getByText('E:\\Finance backups')).toBeVisible()
    expect(within(panel).getByText(/permission to use the configured backup folder/i)).toBeVisible()
    const choose = within(panel).getByRole('button', { name: 'Choose folder' })
    await user.click(choose)
    await user.click(choose)
    expect(service.dataManagement.chooseBackupFolder).toHaveBeenCalledOnce()
    resolveFolder({ status: 'success', folderPath: 'F:\\MiroraTrack' })
    await waitFor(() => expect(within(panel).getByText('F:\\MiroraTrack')).toBeVisible())
  })

  it('subscribes to live backup status, shows next eligibility, and refreshes metadata on terminal status', async () => {
    const service = services()
    const { unmount } = render(
      <SettingsPage
        {...service}
        onRestoreComplete={vi.fn()}
      />,
    )
    const panel = await screen.findByRole('region', { name: 'Backup and export' })
    expect(within(panel).getByText('Next attempt').parentElement)
      .toHaveTextContent(/Jul 30, 2026/)
    const initialReads = service.dataManagement.getBackupStatus.mock.calls.length

    await act(async () => {
      service.emitBackupStatus({
        phase: 'failed',
        nextEligibleAt: '2026-07-30T12:02:00.000Z',
      })
    })

    await waitFor(() => {
      expect(service.dataManagement.getBackupStatus.mock.calls.length)
        .toBeGreaterThan(initialReads)
    })
    expect(within(panel).getByText('Next attempt').parentElement)
      .toHaveTextContent(/Jul 30, 2026/)

    unmount()
    expect(service.unsubscribe).toHaveBeenCalledOnce()
    const readsAfterUnmount = service.dataManagement.getBackupStatus.mock.calls.length
    await act(async () => {
      service.emitBackupStatus({ phase: 'success' })
    })
    expect(service.dataManagement.getBackupStatus).toHaveBeenCalledTimes(readsAfterUnmount)
  })
})
