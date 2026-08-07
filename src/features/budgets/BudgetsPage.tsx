import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, CircleCheck, PiggyBank, Plus, RotateCcw, Trash2, TriangleAlert, OctagonAlert } from 'lucide-react'
import type { BudgetsApplication } from '../../app/runtime'
import type { BudgetListResult, BudgetListRow } from '../../application/budgetService'
import type { Budget } from '../../finance/types'
import { formatMinor } from '../../finance/money'
import { currencyCode } from '../../finance/money'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Dialog } from '../../components/Dialog'
import { EmptyState } from '../../components/EmptyState'
import { StatusState } from '../../components/StatusState'
import { BudgetForm } from './BudgetForm'

type Action = { kind: 'archive' | 'reactivate' | 'delete'; budget: Budget }

export function BudgetsPage({
  service,
  initialMonth = localMonth(),
}: {
  service: BudgetsApplication
  initialMonth?: string
}) {
  const [month, setMonth] = useState(initialMonth)
  const [currency, setCurrency] = useState('')
  const [currencies, setCurrencies] = useState<readonly string[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [result, setResult] = useState<BudgetListResult | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [editor, setEditor] = useState<Budget | 'new' | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [actionError, setActionError] = useState('')
  const [acting, setActing] = useState(false)
  const [message, setMessage] = useState('')
  const requestRef = useRef(0)
  const mutationPending = useRef(false)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setState((current) => current === 'ready' ? current : 'loading')
    try {
      const available = currencies.length ? currencies : await service.availableCurrencies()
      const selected = currency || available[0]
      if (!selected) throw new Error('No supported currency')
      const next = await service.list({ month, currency: currencyCode(selected), includeArchived })
      if (request !== requestRef.current) return
      setCurrencies(available)
      setCurrency(selected)
      setResult(next)
      setState('ready')
    } catch {
      if (request === requestRef.current) setState('error')
    }
  }, [currencies, currency, includeArchived, month, service])

  useEffect(() => { void load() }, [load])

  const save = async (draft: Parameters<BudgetsApplication['create']>[0]) => {
    if (mutationPending.current || !editor) return
    mutationPending.current = true
    setSaving(true)
    setFormError('')
    try {
      if (editor === 'new') await service.create(draft)
      else await service.update(editor.id, draft)
      setEditor(null)
      setMessage(editor === 'new' ? 'Budget created.' : 'Budget updated.')
      await load()
    } catch {
      setFormError('MiroraTrack could not save this budget. Your values are still here.')
    } finally {
      mutationPending.current = false
      setSaving(false)
    }
  }

  const confirmAction = async () => {
    if (!action || mutationPending.current) return
    mutationPending.current = true
    setActing(true)
    setActionError('')
    try {
      await service[action.kind](action.budget.id)
      setMessage(action.kind === 'delete' ? 'Budget deleted.' : action.kind === 'archive' ? 'Budget archived.' : 'Budget reactivated.')
      setAction(null)
      setActionError('')
      await load()
    } catch {
      setActionError('This budget could not be changed. Review the latest local data and try again.')
    } finally {
      mutationPending.current = false
      setActing(false)
    }
  }

  return (
    <div className="budgets-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Spend with intention</p>
          <h1 id="page-title">Budgets</h1>
          <p className="page-hero__description">Shape a monthly plan, then let your ledger measure the progress.</p>
        </div>
        <Button icon={<Plus size={18} aria-hidden="true" />} onClick={() => { setFormError(''); setEditor('new') }}>Create budget</Button>
      </section>
      <Card className="budget-toolbar">
        <label>Month<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label>Currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label className="toggle-control"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived</label>
        <Button variant="ghost" aria-label="Refresh budgets" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => void load()}>Refresh</Button>
      </Card>
      {message ? <StatusState tone={message.includes('could not') ? 'error' : 'success'} role={message.includes('could not') ? 'alert' : 'status'}>{message}</StatusState> : null}
      {state === 'loading' ? <div className="workspace-state" role="status"><span className="workspace-state__spinner" /><p>Loading budgets</p></div> : null}
      {state === 'error' ? <div className="workspace-state" role="alert"><h2>Budgets could not be refreshed</h2><p>{result ? 'The last successful results remain visible below.' : 'Your local data has not been changed.'}</p><Button onClick={() => void load()}>Try again</Button></div> : null}
      {result && result.rows.length === 0 ? (
        <Card className="budgets-empty"><EmptyState icon={<PiggyBank aria-hidden="true" />} title="A calmer month starts here" description="Create a category budget and MiroraTrack will measure it from completed ledger expenses." action={<Button onClick={() => setEditor('new')}>Create budget</Button>} /></Card>
      ) : null}
      {result && result.rows.length > 0 ? (
        <>
          <div className="budget-totals" aria-label="Budget totals">
            <Card><span>Planned</span><strong>{formatMinor(result.totals.budgeted, result.currency, 'en-US')}</strong></Card>
            <Card><span>Spent</span><strong>{formatMinor(result.totals.spent, result.currency, 'en-US')}</strong></Card>
            <Card><span>Remaining</span><strong>{formatMinor(result.totals.remaining, result.currency, 'en-US')}</strong></Card>
          </div>
          <div className="budget-grid">{result.rows.map((row) => <BudgetCard key={row.budget.id} row={row} onEdit={() => { setFormError(''); setEditor(row.budget) }} onAction={(kind) => { setActionError(''); setAction({ kind, budget: row.budget }) }} />)}</div>
        </>
      ) : null}
      <Dialog open={editor !== null} title={editor === 'new' ? 'Create budget' : 'Edit budget'} description="Budget usage is always rebuilt from your transaction ledger." dismissible={!saving} onClose={() => { if (!saving) setEditor(null) }}>
        {editor ? <BudgetForm {...(editor === 'new' ? {} : { budget: editor })} month={month} currency={currency || 'USD'} currencies={currencies.length ? currencies : [currency || 'USD']} pending={saving} error={formError} onSubmit={(draft) => void save(draft)} onCancel={() => setEditor(null)} /> : null}
      </Dialog>
      <Dialog open={action !== null} title={`${actionLabel(action?.kind)} budget?`} description={action?.kind === 'delete' ? 'Only archived budgets can be permanently deleted.' : 'This changes the budget lifecycle without changing transactions.'} dismissible={!acting} onClose={() => { if (!acting) { setAction(null); setActionError('') } }}>
        <div className="confirmation"><p>{action?.budget.name}</p>{actionError ? <p className="form-error form-error--banner" role="alert">{actionError}</p> : null}<div className="form-actions form-actions--end"><Button variant="ghost" disabled={acting} onClick={() => { setAction(null); setActionError('') }}>Cancel</Button><Button variant={action?.kind === 'delete' ? 'danger' : 'secondary'} loading={acting} loadingLabel={`${actionLabel(action?.kind)} budget`} onClick={() => void confirmAction()}>{actionLabel(action?.kind)} budget</Button></div></div>
      </Dialog>
    </div>
  )
}

function BudgetCard({ row, onEdit, onAction }: { row: BudgetListRow; onEdit: () => void; onAction: (kind: Action['kind']) => void }) {
  const Icon = row.status === 'on-track' ? CircleCheck : row.status === 'warning' ? TriangleAlert : OctagonAlert
  const health = row.status === 'on-track' ? 'On track' : row.status === 'warning' ? 'Warning' : 'Over budget'
  return (
    <Card className={`budget-card budget-card--${row.status}${row.budget.status === 'archived' ? ' budget-card--archived' : ''}`}>
      <div className="budget-card__heading"><div><span>{row.budget.month} · {row.budget.currency}</span><h2>{row.categoryLabel}</h2></div><Icon aria-hidden="true" /></div>
      <div className="budget-card__amount"><strong>{formatMinor(row.spent, row.budget.currency, 'en-US')}</strong><span>of {formatMinor(row.budgeted, row.budget.currency, 'en-US')}</span></div>
      <div className="budget-progress" role="progressbar" aria-label={`${row.categoryLabel} budget usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(100, Math.max(0, row.percentUsed)))} aria-valuetext={`${row.percentUsed.toFixed(0)}% used${row.status === 'over-budget' ? ', over budget' : ''}`}><span style={{ width: `${Math.min(100, Math.max(0, row.percentUsed))}%` }} /></div>
      <div className="budget-card__status"><strong>{health}</strong><span>{row.percentUsed.toFixed(0)}% used · {formatMinor(row.remaining, row.budget.currency, 'en-US')} left</span></div>
      <div className="budget-card__actions">
        <Button variant="ghost" onClick={onEdit}>Edit</Button>
        {row.budget.status === 'active' ? <Button variant="ghost" aria-label={`Archive ${row.categoryLabel} budget`} icon={<Archive size={15} aria-hidden="true" />} onClick={() => onAction('archive')}>Archive</Button> : <>
          <Button variant="secondary" onClick={() => onAction('reactivate')}>Reactivate</Button>
          <Button variant="danger" aria-label={`Delete ${row.categoryLabel} budget`} icon={<Trash2 size={15} aria-hidden="true" />} onClick={() => onAction('delete')}>Delete</Button>
        </>}
      </div>
    </Card>
  )
}

function localMonth(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function actionLabel(kind?: Action['kind']): string {
  return kind === 'reactivate' ? 'Reactivate' : kind === 'delete' ? 'Delete' : 'Archive'
}
