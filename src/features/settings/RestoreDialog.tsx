import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileJson2, RotateCcw } from 'lucide-react'
import type {
  DataManagementApplication,
} from '../../app/runtime'
import type { RestorePreview } from '../../application/dataManagementService'
import type { RestoreCounts } from '../../application/ports'
import { Button } from '../../components/Button'
import { Dialog } from '../../components/Dialog'

interface RestoreDialogProps {
  open: boolean
  dataManagement: Pick<
    DataManagementApplication,
    'selectImport' | 'restore' | 'invalidateRestoreCandidate'
  >
  onClose(): void
  onRestoreComplete(counts: RestoreCounts): void
}

const CONFIRMATION = 'REPLACE MY DATA'

export function RestoreDialog({
  open,
  dataManagement,
  onClose,
  onRestoreComplete,
}: RestoreDialogProps) {
  const [preview, setPreview] = useState<RestorePreview>()
  const [confirmation, setConfirmation] = useState('')
  const [pending, setPending] = useState<'picker' | 'restore'>()
  const pendingRef = useRef<'picker' | 'restore' | undefined>(undefined)
  const [error, setError] = useState<string>()
  const generation = useRef(0)

  const invalidate = () => {
    generation.current += 1
    pendingRef.current = undefined
    setPending(undefined)
    dataManagement.invalidateRestoreCandidate()
    setPreview(undefined)
    setConfirmation('')
    setError(undefined)
  }

  useEffect(() => {
    if (open) return
    generation.current += 1
    dataManagement.invalidateRestoreCandidate()
    setPreview(undefined)
    setConfirmation('')
    setError(undefined)
    setPending(undefined)
    pendingRef.current = undefined
  }, [dataManagement, open])

  useEffect(() => () => {
    generation.current += 1
    dataManagement.invalidateRestoreCandidate()
  }, [dataManagement])

  const close = () => {
    if (pendingRef.current === 'restore') return
    invalidate()
    onClose()
  }

  const choose = async () => {
    if (pendingRef.current) return
    invalidate()
    const token = generation.current
    pendingRef.current = 'picker'
    setPending('picker')
    try {
      const candidate = await dataManagement.selectImport()
      if (token !== generation.current) return
      if (candidate) setPreview(candidate)
    } catch {
      if (token === generation.current) {
        setError('This file is not a compatible MiroraTrack backup.')
      }
    } finally {
      if (token === generation.current) {
        pendingRef.current = undefined
        setPending(undefined)
      }
    }
  }

  const restore = async () => {
    if (!preview || confirmation !== CONFIRMATION || pendingRef.current) return
    const token = generation.current
    pendingRef.current = 'restore'
    setPending('restore')
    setError(undefined)
    try {
      const result = await dataManagement.restore(preview.candidateId, confirmation)
      if (token !== generation.current) return
      onRestoreComplete(result.counts)
    } catch (failure) {
      if (token !== generation.current) return
      const message = failure instanceof Error &&
          failure.message.startsWith('Safety backup failed:')
        ? 'Restore stopped because a safety backup could not be created.'
        : 'Restore stopped safely. Your existing finance data was not changed.'
      dataManagement.invalidateRestoreCandidate()
      setPreview(undefined)
      setConfirmation('')
      setError(message)
      pendingRef.current = undefined
      setPending(undefined)
    }
  }

  return (
    <Dialog
      open={open}
      title="Restore a local backup"
      description="The selected file is validated before any local records are changed."
      onClose={close}
      dismissible={pending !== 'restore'}
    >
      <div className="restore-dialog">
        {!preview ? (
          <div className="restore-picker">
            <span className="restore-picker__icon"><FileJson2 aria-hidden="true" /></span>
            <h3>Choose a MiroraTrack JSON backup</h3>
            <p>Invalid files, backups from another app, and newer unsupported schemas are rejected before preview.</p>
            <Button
              icon={<FileJson2 size={17} aria-hidden="true" />}
              loading={pending === 'picker'}
              loadingLabel="Opening file picker"
              onClick={() => void choose()}
            >
              Choose JSON backup
            </Button>
          </div>
        ) : (
          <>
            <div className="restore-preview">
              <div>
                <p className="eyebrow">Validated backup</p>
                <h3>{formatExportedAt(preview.exportedAt)}</h3>
                <p>Schema version {preview.schemaVersion}</p>
              </div>
              <dl>
                <div><dt>Accounts</dt><dd>{preview.counts.accounts}</dd></div>
                <div><dt>Transactions</dt><dd><span>{preview.counts.transactions} transactions</span></dd></div>
                <div><dt>Budgets</dt><dd>{preview.counts.budgets}</dd></div>
                <div><dt>Activity entries</dt><dd>{preview.counts.auditEntries}</dd></div>
              </dl>
              <p className="sr-summary">
                {preview.counts.accounts} accounts, {preview.counts.transactions} transactions,
                {' '}{preview.counts.budgets} budgets
              </p>
            </div>
            <div className="restore-warning">
              <AlertTriangle aria-hidden="true" />
              <p>
                A safety backup must complete before replacement starts.
                MiroraTrack will then replace all local finance records atomically.
              </p>
            </div>
            <label className="field">
              <span>Type {CONFIRMATION} to continue</span>
              <input
                value={confirmation}
                autoComplete="off"
                spellCheck={false}
                disabled={pending === 'restore'}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <Button
                variant="ghost"
                icon={<RotateCcw size={17} aria-hidden="true" />}
                disabled={pending === 'restore'}
                onClick={() => void choose()}
              >
                Choose another file
              </Button>
              <Button
                variant="danger"
                loading={pending === 'restore'}
                loadingLabel="Creating safety backup"
                disabled={confirmation !== CONFIRMATION}
                onClick={() => void restore()}
              >
                Replace local data
              </Button>
            </div>
          </>
        )}
        {error ? <p className="form-error form-error--banner" role="alert" aria-live="assertive">{error}</p> : null}
      </div>
    </Dialog>
  )
}

function formatExportedAt(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Backup date unavailable'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
