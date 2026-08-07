import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Sheet,
} from 'lucide-react'
import type { BackupMetadata, Settings } from '../../finance/types'
import type { DataManagementApplication } from '../../app/runtime'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { DEFAULT_BACKUP_FOLDER_LABEL } from '../../application/dataManagementService'

interface BackupPanelProps {
  settings: Settings
  metadata?: BackupMetadata | undefined
  nextEligibleAt?: string | undefined
  dataManagement: DataManagementApplication
  onSettingsChanged(): Promise<void>
  onOpenRestore(): void
}

type Operation = 'folder' | 'reset' | 'json' | 'csv' | 'retry'

export function BackupPanel({
  settings,
  metadata,
  nextEligibleAt,
  dataManagement,
  onSettingsChanged,
  onOpenRestore,
}: BackupPanelProps) {
  const [operation, setOperation] = useState<Operation | null>(null)
  const operationRef = useRef<Operation | null>(null)
  const [notice, setNotice] = useState<string>()
  const generation = useRef(0)

  useEffect(() => () => { generation.current += 1 }, [])

  const run = async (key: Operation, task: () => Promise<string | undefined>) => {
    if (operationRef.current !== null) return
    const token = ++generation.current
    operationRef.current = key
    setOperation(key)
    setNotice(undefined)
    try {
      const message = await task()
      if (token === generation.current) setNotice(message)
    } catch {
      if (token === generation.current) {
        setNotice('That operation could not be completed. Your finance data was not changed.')
      }
    } finally {
      if (token === generation.current) {
        operationRef.current = null
        setOperation(null)
      }
    }
  }

  const folder = settings.backupFolderPath ?? DEFAULT_BACKUP_FOLDER_LABEL
  const health = backupHealth(metadata)
  const nextAttempt = nextBackupAttempt(settings, metadata, nextEligibleAt)

  return (
    <section role="region" aria-label="Backup and export" className="settings-section">
      <div className="settings-section__heading">
        <div>
          <p className="eyebrow">Local resilience</p>
          <h2>Backup and export</h2>
        </div>
        <DatabaseBackup aria-hidden="true" />
      </div>

      <Card className="backup-health">
        <div className={`backup-health__status backup-health__status--${health.tone}`}>
          {health.tone === 'success'
            ? <CheckCircle2 aria-hidden="true" />
            : <AlertTriangle aria-hidden="true" />}
          <div>
            <strong>{health.title}</strong>
            <span>{health.description}</span>
          </div>
        </div>
        <dl className="backup-facts">
          <div><dt>Backup folder</dt><dd className="configured-path">{folder}</dd></div>
          <div><dt>Last attempt</dt><dd>{formatTimestamp(metadata?.lastAttemptAt)}</dd></div>
          <div><dt>Last successful backup</dt><dd>{formatTimestamp(metadata?.lastSuccessfulAt)}</dd></div>
          <div><dt>Next attempt</dt><dd>{nextAttempt}</dd></div>
        </dl>
        <div className="settings-actions">
          <Button
            variant="secondary"
            icon={<FolderOpen size={17} aria-hidden="true" />}
            loading={operation === 'folder'}
            loadingLabel="Choosing folder"
            disabled={operation !== null}
            onClick={() => void run('folder', async () => {
              const result = await dataManagement.chooseBackupFolder()
              if (result.status === 'cancelled') return undefined
              if (result.status === 'failed') return result.message
              await onSettingsChanged()
              return 'Backup folder updated.'
            })}
          >
            Choose folder
          </Button>
          <Button
            variant="ghost"
            icon={<RotateCcw size={17} aria-hidden="true" />}
            loading={operation === 'reset'}
            loadingLabel="Resetting"
            disabled={operation !== null || settings.backupFolderPath === undefined}
            onClick={() => void run('reset', async () => {
              await dataManagement.resetBackupFolder()
              await onSettingsChanged()
              return 'The default Documents backup folder will be used.'
            })}
          >
            Use default
          </Button>
          <Button
            variant="ghost"
            icon={<RefreshCw size={17} aria-hidden="true" />}
            disabled={operation !== null || dataManagement.retryAutomaticBackup === undefined}
            title={dataManagement.retryAutomaticBackup
              ? undefined
              : 'Available when automatic backup scheduling starts'}
            onClick={() => void run('retry', async () => {
              const outcome = await dataManagement.retryAutomaticBackup?.()
              await onSettingsChanged()
              return retryNotice(outcome)
            })}
          >
            Retry now
          </Button>
        </div>
      </Card>

      <div className="data-action-grid">
        <Card>
          <Download aria-hidden="true" />
          <h3>JSON backup</h3>
          <p>A complete, portable copy of your local MiroraTrack workspace.</p>
          <Button
            disabled={operation !== null}
            loading={operation === 'json'}
            loadingLabel="Exporting JSON"
            onClick={() => void run('json', async () =>
              fileNotice(await dataManagement.exportJson(), 'JSON backup exported.'))}
          >
            Export JSON
          </Button>
        </Card>
        <Card>
          <Sheet aria-hidden="true" />
          <h3>Transaction CSV</h3>
          <p>Export every ledger transaction in a spreadsheet-friendly format.</p>
          <Button
            variant="secondary"
            disabled={operation !== null}
            loading={operation === 'csv'}
            loadingLabel="Exporting CSV"
            onClick={() => void run('csv', async () =>
              fileNotice(await dataManagement.exportCsv(), 'Transaction CSV exported.'))}
          >
            Export all CSV
          </Button>
        </Card>
        <Card className="data-action-card--warning">
          <AlertTriangle aria-hidden="true" />
          <h3>Restore backup</h3>
          <p>Validate and preview a JSON backup before replacing local records.</p>
          <Button variant="danger" disabled={operation !== null} onClick={onOpenRestore}>
            Restore from JSON
          </Button>
        </Card>
      </div>
      {notice ? <p className="operation-notice" role="status" aria-live="polite">{notice}</p> : null}
    </section>
  )
}

function backupHealth(metadata?: BackupMetadata): {
  tone: 'success' | 'warning'
  title: string
  description: string
} {
  if (metadata?.status === 'success') {
    return {
      tone: 'success',
      title: 'Automatic backups are healthy',
      description: 'The latest local snapshot completed successfully.',
    }
  }
  if (metadata?.status === 'failed') {
    const permission = metadata.errorCode === 'PERMISSION_DENIED'
    return {
      tone: 'warning',
      title: 'Automatic backup needs attention',
      description: permission
        ? 'MiroraTrack does not have permission to use the configured backup folder.'
        : 'The last automatic backup could not be completed.',
    }
  }
  if (metadata?.status === 'warning') {
    return {
      tone: 'warning',
      title: 'Backup saved with a warning',
      description: 'The snapshot was saved, but older backups could not be cleaned up.',
    }
  }
  return {
    tone: 'warning',
    title: 'No automatic backup yet',
    description: 'MiroraTrack will show backup health after the first scheduled attempt.',
  }
}

function formatTimestamp(value?: string): string {
  if (!value) return 'Not yet'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Unavailable'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function nextBackupAttempt(
  settings: Settings,
  metadata?: BackupMetadata,
  nextEligibleAt?: string,
): string {
  if (!settings.automaticBackupsEnabled) return 'Automatic backups are off'
  if (nextEligibleAt !== undefined) return formatTimestamp(nextEligibleAt)
  if (!metadata?.lastSuccessfulAt) return 'Due after the next application start'
  const next = new Date(metadata.lastSuccessfulAt).getTime() +
    settings.automaticBackupIntervalHours * 60 * 60 * 1000
  if (!Number.isFinite(next)) return 'Unavailable'
  if (next <= Date.now()) {
    return 'Overdue — will retry after the next application start'
  }
  return formatTimestamp(new Date(next).toISOString())
}

function retryNotice(
  outcome: Awaited<
    ReturnType<NonNullable<DataManagementApplication['retryAutomaticBackup']>>
  > | undefined,
): string {
  if (outcome === undefined) {
    return 'Automatic backup scheduling is unavailable.'
  }
  if (outcome.phase === 'success') return 'Backup completed successfully.'
  if (outcome.phase === 'warning') {
    return 'Backup saved, but older backups could not be cleaned up.'
  }
  return outcome.result.message ?? 'Automatic backup could not be completed.'
}

function fileNotice(
  result: Awaited<ReturnType<DataManagementApplication['exportJson']>>,
  success: string,
): string | undefined {
  if (result.status === 'cancelled') return undefined
  if (result.status === 'failed') return result.message
  return result.warning
    ? `${success} Older automatic backups still need attention.`
    : success
}
