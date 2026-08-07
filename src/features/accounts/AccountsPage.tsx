import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Archive,
  Banknote,
  ChartLine,
  CreditCard,
  Landmark,
  Pencil,
  PiggyBank,
  Plus,
  RotateCcw,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import type { AccountsApplication } from '../../app/runtime'
import type { AccountListItem, UpdateAccountCommand } from '../../application/accountService'
import type { AccountDraft } from '../../application/accountRecords'
import type { Account, AccountIcon } from '../../finance/types'
import { formatMinor } from '../../finance/money'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Dialog } from '../../components/Dialog'
import { EmptyState } from '../../components/EmptyState'
import { StatusState } from '../../components/StatusState'
import { AccountForm } from './AccountForm'
import { en } from '../../i18n/en'

const iconMap: Record<AccountIcon, LucideIcon> = {
  banknote: Banknote,
  landmark: Landmark,
  'piggy-bank': PiggyBank,
  'credit-card': CreditCard,
  'chart-line': ChartLine,
  wallet: Wallet,
}

export function AccountsPage({
  service,
  locale = 'en-US',
}: {
  service: AccountsApplication
  locale?: string
}) {
  const [items, setItems] = useState<readonly AccountListItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editor, setEditor] = useState<Account | 'create' | null>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Account | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveFailure, setArchiveFailure] = useState('')
  const [reactivating, setReactivating] = useState<ReadonlySet<string>>(new Set())
  const reactivatingRef = useRef(new Set<string>())
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setState('loading')
    try {
      setItems(await service.list())
      setState('ready')
    } catch {
      setState('error')
    }
  }, [service])

  useEffect(() => { void load() }, [load])

  const save = async (command: AccountDraft | UpdateAccountCommand) => {
    const editing = 'id' in command
    if (editing) await service.update(command)
    else await service.create(command)
    setEditor(null)
    setMessage({
      tone: 'success',
      text: editing ? 'Account updated successfully.' : 'Account created successfully.',
    })
    await load()
  }

  const confirmArchive = async () => {
    if (!archiveTarget || archiveBusy) return
    setArchiveBusy(true)
    setMessage(null)
    setArchiveFailure('')
    try {
      await service.archive(archiveTarget.id)
      setArchiveTarget(null)
      setMessage({ tone: 'success', text: 'Account archived.' })
      await load()
    } catch {
      setArchiveFailure('MiroraTrack could not archive this account. Please try again.')
    } finally {
      setArchiveBusy(false)
    }
  }

  const reactivate = async (account: Account) => {
    if (reactivatingRef.current.has(account.id)) return
    reactivatingRef.current.add(account.id)
    setReactivating(new Set(reactivatingRef.current))
    setMessage(null)
    try {
      await service.reactivate(account.id)
      setMessage({ tone: 'success', text: 'Account reactivated.' })
      await load()
    } catch {
      setMessage({ tone: 'error', text: 'MiroraTrack could not reactivate this account. Please try again.' })
    } finally {
      reactivatingRef.current.delete(account.id)
      setReactivating(new Set(reactivatingRef.current))
    }
  }

  const active = items.filter(({ account }) => account.status === 'active')
  const archived = items.filter(({ account }) => account.status === 'archived')

  return (
    <div className="accounts-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Your financial foundation</p>
          <h1 id="page-title">{en.accounts.title}</h1>
          <p className="page-hero__description">
            Every balance is rebuilt from your private ledger and shown in the account’s own currency.
          </p>
        </div>
        <Button icon={<Plus aria-hidden="true" size={18} />} onClick={() => setEditor('create')}>
          {en.accounts.add}
        </Button>
      </section>

      {message ? (
        <StatusState tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </StatusState>
      ) : null}

      {state === 'loading' ? (
        <div className="workspace-state" role="status" aria-label="Loading accounts">
          <span className="workspace-state__spinner" aria-hidden="true" />
          <p>Loading accounts</p>
        </div>
      ) : null}
      {state === 'error' ? (
        <div className="workspace-state" role="alert">
          <h2>We could not load your accounts</h2>
          <p>Your local data has not been changed.</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      ) : null}
      {state === 'ready' && items.length === 0 ? (
        <Card className="accounts-empty">
          <EmptyState
            icon={<Landmark aria-hidden="true" />}
            title="Bring your accounts together"
            description="Add your first account. Balances stay private and are always derived from your transaction ledger."
            action={<Button onClick={() => setEditor('create')}>Create first account</Button>}
          />
        </Card>
      ) : null}
      {state === 'ready' && items.length > 0 ? (
        <>
          {active.length > 0 ? (
            <AccountGroup
              title="Active accounts"
              items={active}
              locale={locale}
              onEdit={setEditor}
              onArchive={setArchiveTarget}
              onReactivate={reactivate}
              reactivating={reactivating}
            />
          ) : (
            <Card className="accounts-empty">
              <EmptyState
                icon={<Archive aria-hidden="true" />}
                title="All accounts are archived"
                description="Reactivate an account below whenever you are ready to use it again."
              />
            </Card>
          )}
          {archived.length > 0 ? (
            <AccountGroup
              title="Archived accounts"
              items={archived}
              locale={locale}
              onEdit={setEditor}
              onArchive={setArchiveTarget}
              onReactivate={reactivate}
              reactivating={reactivating}
            />
          ) : null}
        </>
      ) : null}

      <Dialog
        open={editor !== null}
        title={editor === 'create' ? 'Add an account' : `Edit ${editor?.name ?? 'account'}`}
        description="Account details stay on this computer."
        dismissible={!editorBusy}
        onClose={() => { if (!editorBusy) setEditor(null) }}
      >
        {editor ? (
          <AccountForm
            {...(editor === 'create' ? {} : { account: editor })}
            onSave={save}
            onCancel={() => setEditor(null)}
            onBusyChange={setEditorBusy}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={archiveTarget !== null}
        title={`Archive ${archiveTarget?.name ?? 'account'}?`}
        description="Archived accounts keep their full transaction history and can be reactivated later."
        onClose={() => !archiveBusy && setArchiveTarget(null)}
      >
        <div className="confirmation">
          <div className="privacy-note">
            <ShieldCheck aria-hidden="true" size={18} />
            No finance records will be deleted.
          </div>
          {archiveFailure ? (
            <p className="form-error form-error--banner" role="alert">{archiveFailure}</p>
          ) : null}
          <div className="form-actions form-actions--end">
            <Button variant="ghost" disabled={archiveBusy} onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={archiveBusy}
              loadingLabel="Archiving account"
              onClick={() => void confirmArchive()}
            >
              Archive account
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function AccountGroup({
  title,
  items,
  locale,
  onEdit,
  onArchive,
  onReactivate,
  reactivating,
}: {
  title: string
  items: readonly AccountListItem[]
  locale: string
  onEdit: (account: Account) => void
  onArchive: (account: Account) => void
  onReactivate: (account: Account) => void
  reactivating: ReadonlySet<string>
}) {
  return (
    <section className="account-group" aria-label={title}>
      <div className="account-group__heading">
        <h2>{title}</h2>
        <span>{items.length} {items.length === 1 ? 'account' : 'accounts'}</span>
      </div>
      <div className="account-grid">
        {items.map(({ account, balance }) => {
          const Icon = iconMap[account.icon]
          return (
            <Card key={account.id} className={`account-card account-card--${account.color}`} interactive>
              <div className="account-card__top">
                <div className="account-card__icon"><Icon aria-hidden="true" /></div>
                <span className="account-card__currency">{account.currency}</span>
              </div>
              <p className="account-card__type">{titleCase(account.type)}</p>
              <h3>{account.name}</h3>
              <p className="account-card__balance">
                {formatMinor(balance, account.currency, locale)}
              </p>
              <div className="account-card__actions">
                {account.status === 'active' ? (
                  <>
                    <Button variant="ghost" icon={<Pencil aria-hidden="true" size={16} />} aria-label={`Edit ${account.name}`} onClick={() => onEdit(account)}>
                      Edit
                    </Button>
                    <Button variant="ghost" icon={<Archive aria-hidden="true" size={16} />} aria-label={`Archive ${account.name}`} onClick={() => onArchive(account)}>
                      Archive
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    icon={<RotateCcw aria-hidden="true" size={16} />}
                    aria-label={reactivating.has(account.id)
                      ? `Reactivating ${account.name}`
                      : `Reactivate ${account.name}`}
                    loading={reactivating.has(account.id)}
                    loadingLabel="Reactivating"
                    onClick={() => void onReactivate(account)}
                  >
                    Reactivate
                  </Button>
                )}
              </div>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase())
}
