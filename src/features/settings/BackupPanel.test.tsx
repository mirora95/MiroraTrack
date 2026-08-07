import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupMetadata, Settings } from '../../finance/types'
import { BackupPanel } from './BackupPanel'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

const settings: Settings = {
  key: 'primary',
  baseCurrency: 'USD' as never,
  locale: 'en-US',
  dateFormat: 'yyyy-MM-dd',
  automaticBackupsEnabled: true,
  automaticBackupIntervalHours: 24,
}

function renderPanel(
  metadata?: BackupMetadata,
  options: {
    nextEligibleAt?: string
    retryAutomaticBackup?: NonNullable<
      Parameters<typeof BackupPanel>[0]['dataManagement']['retryAutomaticBackup']
    >
  } = {},
) {
  render(
    <BackupPanel
      settings={settings}
      metadata={metadata}
      nextEligibleAt={options.nextEligibleAt}
      dataManagement={{
        getBackupStatus: vi.fn(),
        chooseBackupFolder: vi.fn(),
        resetBackupFolder: vi.fn(),
        exportJson: vi.fn(),
        exportCsv: vi.fn(),
        selectImport: vi.fn(),
        restore: vi.fn(),
        invalidateRestoreCandidate: vi.fn(),
        ...(options.retryAutomaticBackup === undefined
          ? {}
          : { retryAutomaticBackup: options.retryAutomaticBackup }),
      }}
      onSettingsChanged={vi.fn()}
      onOpenRestore={vi.fn()}
    />,
  )
  const panel = screen.getByRole('region', { name: 'Backup and export' })
  return within(panel).getByText('Next attempt').parentElement
}

describe('BackupPanel next attempt', () => {
  it('uses the coordinator next eligible time during its active cooldown', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'))
    const fact = renderPanel(undefined, {
      nextEligibleAt: '2026-07-30T12:01:00.000Z',
    })

    expect(fact).toHaveTextContent(/Jul 30, 2026/)
    expect(fact).not.toHaveTextContent('Due after the next application start')
  })

  it('shows due on next activation when no backup has succeeded', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'))
    const fact = renderPanel({
      id: 'automatic' as never,
      status: 'failed',
      lastAttemptAt: '2026-07-30T11:00:00.000Z',
      schemaVersion: 5,
    })

    expect(fact).toHaveTextContent('Due after the next application start')
  })

  it('uses the last success and reports overdue despite a recent failed attempt', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T12:00:00.000Z'))
    const fact = renderPanel({
      id: 'automatic' as never,
      status: 'failed',
      lastAttemptAt: '2026-07-30T11:30:00.000Z',
      lastSuccessfulAt: '2026-07-28T10:00:00.000Z',
      schemaVersion: 5,
    })

    expect(fact).toHaveTextContent('Overdue — will retry after the next application start')
  })
})

describe('BackupPanel retry outcome', () => {
  it.each([
    [
      'success',
      { phase: 'success', result: { success: true, path: 'D:\\backup.json', directory: 'D:\\' } },
      'Backup completed successfully.',
    ],
    [
      'warning',
      {
        phase: 'warning',
        result: {
          success: true,
          path: 'D:\\backup.json',
          directory: 'D:\\',
          warning: { code: 'RETENTION_WARNING' },
        },
      },
      'Backup saved, but older backups could not be cleaned up.',
    ],
    [
      'failure',
      {
        phase: 'failed',
        result: {
          success: false,
          errorCode: 'PERMISSION_DENIED',
          message: 'Backup folder permission was denied',
        },
      },
      'Backup folder permission was denied',
    ],
  ] as const)('announces an accurate %s result', async (_label, outcome, message) => {
    const user = userEvent.setup()
    const retry = vi.fn().mockResolvedValue(outcome)
    renderPanel(undefined, { retryAutomaticBackup: retry })

    await user.click(screen.getByRole('button', { name: 'Retry now' }))

    expect(await screen.findByRole('status')).toHaveTextContent(message)
  })
})
