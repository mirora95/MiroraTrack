import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Landmark, PiggyBank, RefreshCw, Sparkles, WalletCards } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardApplication } from '../../app/runtime'
import type { DashboardPayload, DashboardRangePreset } from '../../application/dashboardService'
import { formatMinor } from '../../finance/money'
import type { Transaction } from '../../finance/types'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { transactionLink } from './drilldown'

const CashFlowChart = lazy(() => import('./CashFlowChart').then((module) => ({ default: module.CashFlowChart })))
const CategoryBreakdownChart = lazy(() => import('./CategoryBreakdownChart').then((module) => ({ default: module.CategoryBreakdownChart })))

type RangeChoice = DashboardRangePreset | 'custom'
interface DashboardControls {
  readonly range: RangeChoice
  readonly customStart: string
  readonly customEnd: string
  readonly currency: string
}

export function DashboardPage({ service }: { service: DashboardApplication }) {
  const [range, setRange] = useState<RangeChoice>('this-month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [currency, setCurrency] = useState('')
  const [payload, setPayload] = useState<DashboardPayload | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const requestRef = useRef(0)
  const appliedControlsRef = useRef<DashboardControls | null>(null)
  const suppressNextLoadRef = useRef(false)
  const customRangeError = range === 'custom'
    ? validateCustomRange(customStart, customEnd)
    : ''

  const load = useCallback(async () => {
    if (range === 'custom' && customRangeError) return
    const request = ++requestRef.current
    setState((current) => current === 'ready' ? current : 'loading')
    try {
      const next = await service.load({
        ...(currency ? { currency: currency as DashboardPayload['currency'] } : {}),
        range: range === 'custom' ? { kind: 'custom', start: customStart, end: customEnd } : range,
        recentLimit: 6,
      })
      if (request !== requestRef.current) return
      setPayload(next)
      setCurrency(next.currency)
      setState('ready')
      appliedControlsRef.current = {
        range,
        customStart,
        customEnd,
        currency: next.currency,
      }
    } catch {
      if (request !== requestRef.current) return
      const applied = appliedControlsRef.current
      if (applied) {
        const controlsChanged = range !== applied.range
          || customStart !== applied.customStart
          || customEnd !== applied.customEnd
          || currency !== applied.currency
        if (controlsChanged) {
          suppressNextLoadRef.current = true
          setRange(applied.range)
          setCustomStart(applied.customStart)
          setCustomEnd(applied.customEnd)
          setCurrency(applied.currency)
        }
      }
      setState('error')
    }
  }, [currency, customEnd, customRangeError, customStart, range, service])

  useEffect(() => {
    if (suppressNextLoadRef.current) {
      suppressNextLoadRef.current = false
      return
    }
    void load()
  }, [load])

  const fromDate = payload?.range.start.slice(0, 10) ?? ''
  const toDate = payload?.range.end.slice(0, 10) ?? ''
  return (
    <div className="dashboard-page">
      <section className="page-hero">
        <div><p className="eyebrow">Your financial command center</p><h1 id="page-title">Dashboard</h1><p className="page-hero__description">Ledger-derived clarity across what you own, earn, spend, and save.</p></div>
        <div className="dashboard-controls">
          <select aria-label="Dashboard currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>{payload?.availableCurrencies.map((item) => <option key={item}>{item}</option>)}</select>
          <select aria-label="Dashboard range" value={range} onChange={(event) => {
            const next = event.target.value as RangeChoice
            if (next === 'custom' && (!customStart || !customEnd)) {
              setCustomStart(payload?.range.start.slice(0, 10) ?? '')
              setCustomEnd(payload?.range.end.slice(0, 10) ?? '')
            }
            setRange(next)
          }}>
            <option value="this-month">This month</option><option value="this-and-next-month">This + next month</option><option value="last-month">Last month</option><option value="last-3-months">Last 3 months</option><option value="year-to-date">Year to date</option><option value="custom">Custom</option>
          </select>
          <Button variant="ghost" aria-label="Refresh dashboard" icon={<RefreshCw size={16} aria-hidden="true" />} onClick={() => void load()}>Refresh</Button>
        </div>
      </section>
      {range === 'custom' ? <Card className="custom-range"><label>From<input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} /></label><label>To<input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} /></label>{customRangeError ? <p className="form-error form-error--banner" role="alert">{customRangeError}</p> : null}</Card> : null}
      {state === 'loading' ? <div className="workspace-state" role="status"><span className="workspace-state__spinner" /><p>Building your dashboard from the ledger</p></div> : null}
      {state === 'error' ? <div className="workspace-state" role="alert"><h2>Dashboard could not be refreshed</h2><p>{payload ? 'The last successful results remain visible below.' : 'Your local finance records have not been changed.'}</p><Button onClick={() => void load()}>Try again</Button></div> : null}
      {payload ? (
        <>
          <section className="kpi-grid" aria-label="Financial overview">
            <Kpi label="Net worth" value={formatMinor(payload.netWorth, payload.currency, 'en-US')} icon={<Landmark />} tone="primary" />
            <Kpi label="Income" value={formatMinor(payload.income, payload.currency, 'en-US')} icon={<ArrowUpRight />} tone="income" />
            <Kpi label="Expenses" value={formatMinor(payload.expenses, payload.currency, 'en-US')} icon={<ArrowDownRight />} tone="expense" />
            <Kpi label="Net flow" value={formatMinor(payload.netCashFlow, payload.currency, 'en-US')} icon={<WalletCards />} tone="secondary" />
            <Kpi label="Savings rate" value={payload.savingsRatePercent === null ? '—' : `${payload.savingsRatePercent.toFixed(0)}%`} icon={<PiggyBank />} tone="savings" />
          </section>
          <div className="dashboard-chart-grid">
            <Card className="dashboard-panel dashboard-panel--wide"><PanelHeading title="Cash flow" subtitle="Completed ledger movement by day" /><Suspense fallback={<p className="chart-empty" role="status">Loading cash flow chart</p>}><CashFlowChart rows={payload.cashFlow} currency={payload.currency} /></Suspense></Card>
            <Card className="dashboard-panel"><PanelHeading title="Spending mix" subtitle="Completed expenses by category" /><Suspense fallback={<p className="chart-empty" role="status">Loading spending chart</p>}><CategoryBreakdownChart rows={payload.categoryBreakdown} currency={payload.currency} range={payload.range} /></Suspense><div className="drilldown-links">{payload.categoryBreakdown.map((row) => <Link key={row.categoryId} to={transactionLink({ currency: payload.currency, type: 'expense', categoryId: row.categoryId, fromDate, toDate })}>View {row.label} expenses</Link>)}</div></Card>
          </div>
          <div className="dashboard-detail-grid">
            <Card className="dashboard-panel"><PanelHeading title="Budget health" subtitle="Active plans in this range" />{payload.budgetUsage.length ? <ul className="dashboard-list">{payload.budgetUsage.map((row) => <li key={row.budgetId}><div><strong>{row.categoryLabel}</strong><span>{row.status.replace('-', ' ')} · {row.percentUsed.toFixed(0)}%</span></div><Link to={transactionLink({ currency: payload.currency, type: 'expense', categoryId: row.categoryId, fromDate, toDate })}>Review</Link></li>)}</ul> : <EmptyState title="No active budgets" description="Create a budget to compare plans with ledger spending." />}</Card>
            <Card className="dashboard-panel"><PanelHeading title="Accounts" subtitle="Current balances, including archived accounts" /><ul className="dashboard-list">{payload.accountBalances.map((row) => <li key={row.accountId}><div><strong>{row.name}</strong><span>{row.status} · {row.type}</span></div><Link to={transactionLink({ currency: payload.currency, accountId: row.accountId, fromDate, toDate })}>{formatMinor(row.balance, payload.currency, 'en-US')}</Link></li>)}</ul></Card>
            <Card className="dashboard-panel"><PanelHeading title="Recent activity" subtitle="Latest standard ledger records" />{payload.recentTransactions.length ? <ul className="dashboard-list">{payload.recentTransactions.map((item) => <RecentRow key={item.id} transaction={item} currency={payload.currency} fromDate={fromDate} toDate={toDate} />)}</ul> : <EmptyState icon={<Sparkles aria-hidden="true" />} title="No recent transactions" description="Completed ledger activity in this range will appear here." />}</Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

function validateCustomRange(start: string, end: string): string {
  if (!start || !end) return 'Choose both From and To dates.'
  const startTime = Date.parse(`${start}T00:00:00.000Z`)
  const endTime = Date.parse(`${end}T00:00:00.000Z`)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return 'Choose valid From and To dates.'
  if (startTime > endTime) return 'The From date must be before or the same as the To date.'
  if (endTime - startTime >= 366 * 86_400_000) return 'Custom ranges can include up to 366 days.'
  return ''
}

function Kpi({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: string }) {
  return <Card className={`kpi-card kpi-card--${tone}`}><span className="kpi-card__icon">{icon}</span><span>{label}</span><strong>{value}</strong></Card>
}
function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>
}
function RecentRow({ transaction, currency, fromDate, toDate }: { transaction: Transaction; currency: DashboardPayload['currency']; fromDate: string; toDate: string }) {
  const params = transaction.type === 'transfer' ? { currency, accountId: transaction.sourceAccountId, fromDate, toDate } : { currency, type: transaction.type, accountId: transaction.type === 'income' ? transaction.destinationAccountId : transaction.sourceAccountId, categoryId: transaction.categoryId, fromDate, toDate }
  return <li><div><strong>{transaction.description || transaction.type[0].toUpperCase() + transaction.type.slice(1)}</strong><span>{transaction.effectiveAt.slice(0, 10)}</span></div><Link to={transactionLink(params)}>{formatMinor(transaction.amount, currency, 'en-US')}</Link></li>
}
