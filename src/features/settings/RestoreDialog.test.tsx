import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RestoreDialog } from './RestoreDialog'

afterEach(cleanup)

function service() {
  return {
    selectImport: vi.fn().mockResolvedValue({
      candidateId: 'candidate-1',
      exportedAt: '2026-07-28T12:00:00.000Z',
      schemaVersion: 4,
      counts: {
        metadata: 1,
        settings: 1,
        accounts: 2,
        transactions: 14,
        budgets: 3,
        auditEntries: 20,
        backupMetadata: 1,
        calculationCaches: 0,
      },
    }),
    restore: vi.fn().mockResolvedValue({
      reloadRequired: true as const,
      counts: {
        metadata: 1,
        settings: 1,
        accounts: 2,
        transactions: 14,
        budgets: 3,
        auditEntries: 20,
        backupMetadata: 1,
        calculationCaches: 0,
      },
    }),
    invalidateRestoreCandidate: vi.fn(),
  }
}

describe('RestoreDialog', () => {
  it('previews counts and requires the exact replacement phrase', async () => {
    const user = userEvent.setup()
    const dataManagement = service()
    render(
      <RestoreDialog
        open
        dataManagement={dataManagement}
        onClose={vi.fn()}
        onRestoreComplete={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Choose JSON backup' }))
    expect(await screen.findByText('14 transactions')).toBeVisible()
    expect(screen.getByText(/28 Jul 2026/i)).toBeVisible()
    const restore = screen.getByRole('button', { name: 'Replace local data' })
    expect(restore).toBeDisabled()
    await user.type(screen.getByLabelText('Type REPLACE MY DATA to continue'), 'REPLACE MY DATA')
    expect(restore).toBeEnabled()
    await user.click(restore)
    await waitFor(() => expect(dataManagement.restore).toHaveBeenCalledWith(
      'candidate-1',
      'REPLACE MY DATA',
    ))
  })

  it('blocks dismissal during restore and exposes only one restart action after success', async () => {
    const user = userEvent.setup()
    const dataManagement = service()
    let finish!: (value: Awaited<ReturnType<typeof dataManagement.restore>>) => void
    dataManagement.restore.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    const onComplete = vi.fn()
    render(
      <RestoreDialog
        open
        dataManagement={dataManagement}
        onClose={onClose}
        onRestoreComplete={onComplete}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Choose JSON backup' }))
    await user.type(await screen.findByLabelText('Type REPLACE MY DATA to continue'), 'REPLACE MY DATA')
    await user.click(screen.getByRole('button', { name: 'Replace local data' }))
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    finish({
      reloadRequired: true,
      counts: {
        metadata: 1, settings: 1, accounts: 2, transactions: 14,
        budgets: 3, auditEntries: 20, backupMetadata: 1, calculationCaches: 0,
      },
    })
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })

  it('maps invalid candidates and safety failures to fixed messages', async () => {
    const user = userEvent.setup()
    const dataManagement = service()
    dataManagement.selectImport.mockRejectedValueOnce(new Error('C:\\private\\secret'))
    const { rerender } = render(
      <RestoreDialog open dataManagement={dataManagement} onClose={vi.fn()} onRestoreComplete={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Choose JSON backup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This file is not a compatible MiroraTrack backup.',
    )
    expect(screen.queryByText(/private\\secret/i)).not.toBeInTheDocument()

    dataManagement.selectImport.mockResolvedValueOnce({
      candidateId: 'candidate-2',
      exportedAt: '2026-07-28T12:00:00.000Z',
      schemaVersion: 4,
      counts: {
        metadata: 1, settings: 1, accounts: 0, transactions: 0,
        budgets: 0, auditEntries: 0, backupMetadata: 0, calculationCaches: 0,
      },
    })
    dataManagement.restore.mockRejectedValueOnce(new Error('Safety backup failed: WRITE_FAILED'))
    rerender(<RestoreDialog open dataManagement={dataManagement} onClose={vi.fn()} onRestoreComplete={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Choose JSON backup' }))
    await user.type(await screen.findByLabelText('Type REPLACE MY DATA to continue'), 'REPLACE MY DATA')
    await user.click(screen.getByRole('button', { name: 'Replace local data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Restore stopped because a safety backup could not be created.',
    )
    expect(screen.queryByText('Validated backup')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replace local data' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose JSON backup' })).toBeEnabled()

    dataManagement.selectImport.mockResolvedValueOnce({
      candidateId: 'candidate-3',
      exportedAt: '2026-07-29T12:00:00.000Z',
      schemaVersion: 4,
      counts: {
        metadata: 1, settings: 1, accounts: 1, transactions: 2,
        budgets: 0, auditEntries: 2, backupMetadata: 0, calculationCaches: 0,
      },
    })
    await user.click(screen.getByRole('button', { name: 'Choose JSON backup' }))
    expect(await screen.findByText('2 transactions')).toBeVisible()
    expect(dataManagement.invalidateRestoreCandidate).toHaveBeenCalled()
  })
})
