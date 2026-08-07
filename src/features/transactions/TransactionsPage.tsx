import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Plus, ReceiptText, RotateCcw, Search, Trash2 } from 'lucide-react'
import type {
  AccountsApplication,
  TransactionsApplication,
} from '../../app/runtime'
import type {
  TransactionFilters,
  TransactionListItem,
  TransactionPage,
  TransactionSort,
} from '../../application/transactionService'
import { ValidationError } from '../../application/validation'
import { formatMinor } from '../../finance/money'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { Dialog } from '../../components/Dialog'
import { EmptyState } from '../../components/EmptyState'
import { StatusState } from '../../components/StatusState'
import { TransactionTable } from './TransactionTable'
import { useTransactionDialog } from './TransactionDialogProvider'
import { useSearchParams } from 'react-router-dom'
import { isSupportedCurrency } from '../../finance/money'
import { categoryLabel } from '../../application/transactionCategories'

const initialFilters: TransactionFilters = { page: 1, pageSize: 25, sort: 'newest' }

export function TransactionsPage({
  service,
  accounts,
}: {
  service: TransactionsApplication
  accounts: AccountsApplication
}) {
  const { openCreate, openEdit, revision } = useTransactionDialog()
  const [searchParams, setSearchParams] = useSearchParams()
  const searchText = searchParams.toString()
  const filters = useMemo(
    () => filtersFromSearch(new URLSearchParams(searchText)),
    [searchText],
  )
  const [page, setPage] = useState<TransactionPage | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [accountOptions, setAccountOptions] = useState<readonly { id: string; name: string }[]>([])
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TransactionListItem | null>(null)
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(new Set())
  const [deleteFailure, setDeleteFailure] = useState('')
  const [exporting, setExporting] = useState(false)
  const requestRef = useRef(0)
  const deletePendingRef = useRef(false)

  const load = useCallback(async () => {
    const request = ++requestRef.current
    setState((current) => current === 'ready' ? current : 'loading')
    try {
      const result = await service.list(filters)
      if (request === requestRef.current) {
        setPage(result)
        setState('ready')
      }
    } catch {
      if (request === requestRef.current) setState('error')
    }
  }, [filters, service])

  useEffect(() => { void load() }, [load, revision])
  useEffect(() => {
    let active = true
    void accounts.list().then((items) => {
      if (active) setAccountOptions(items.map(({ account }) => ({ id: account.id, name: account.name })))
    }, () => undefined)
    return () => { active = false }
  }, [accounts])

  const patchFilters = (patch: Partial<TransactionFilters>) => {
    const next = { ...filters, ...patch, page: patch.page ?? 1 }
    setSearchParams(filtersToSearch(next), { replace: true })
  }
  const setOptionalFilter = (
    key: 'search' | 'type' | 'status' | 'accountId' | 'categoryId' | 'currency' | 'fromDate' | 'toDate',
    value: string,
  ) => {
    const next = { ...filters, page: 1 } as Record<string, unknown>
    if (value) next[key] = value
    else delete next[key]
    setSearchParams(filtersToSearch(next as unknown as TransactionFilters), { replace: true })
  }
  const clearFilters = () => setSearchParams({}, { replace: true })
  const filtered = hasFilters(filters)

  const confirmDelete = async () => {
    if (!deleteTarget || deletePendingRef.current) return
    const id = deleteTarget.transaction.id
    deletePendingRef.current = true
    setDeleting(new Set([id]))
    setDeleteFailure('')
    try {
      await service.delete(id)
      setDeleteTarget(null)
      setMessage({ tone: 'success', text: 'Transaction deleted.' })
      await load()
    } catch (error) {
      setDeleteFailure(error instanceof ValidationError && error.code === 'CONCURRENT_MODIFICATION'
        ? 'This transaction changed elsewhere. Close this message and review the latest version.'
        : 'MiroraTrack could not delete this transaction.')
    } finally {
      deletePendingRef.current = false
      setDeleting(new Set())
    }
  }

  const exportFiltered = async () => {
    if (exporting) return
    setExporting(true)
    setMessage(null)
    try {
      const result = await service.exportFiltered(filters)
      if (result === null) {
        setMessage({ tone: 'success', text: 'Export cancelled. No file was written.' })
      } else if (result.success) {
        setMessage({ tone: 'success', text: 'Filtered transactions exported.' })
      } else {
        setMessage({ tone: 'error', text: 'MiroraTrack could not export the filtered transactions.' })
      }
    } catch {
      setMessage({ tone: 'error', text: 'MiroraTrack could not export the filtered transactions.' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="transactions-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Money in motion</p>
          <h1 id="page-title">Transactions</h1>
          <p className="page-hero__description">Search and manage the authoritative ledger stored on this computer.</p>
        </div>
        <Button icon={<Plus size={18} aria-hidden="true" />} onClick={openCreate}>Add transaction</Button>
      </section>
      {message ? <StatusState tone={message.tone} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</StatusState> : null}

      <Card className="transaction-filters">
        <label className="filter-search">
          <span className="sr-only">Search transactions</span>
          <Search size={18} aria-hidden="true" />
          <input
            value={filters.search ?? ''}
            placeholder="Search notes, categories, accounts"
            onChange={(event) => setOptionalFilter('search', event.target.value)}
          />
        </label>
        <select aria-label="Transaction type" value={filters.type ?? ''} onChange={(event) => setOptionalFilter('type', event.target.value)}>
          <option value="">All types</option><option value="income">Income</option><option value="expense">Expense</option><option value="transfer">Transfer</option>
        </select>
        <select aria-label="Transaction status" value={filters.status ?? ''} onChange={(event) => setOptionalFilter('status', event.target.value)}>
          <option value="">All statuses</option><option value="completed">Completed</option><option value="planned">Planned</option><option value="cancelled">Cancelled</option>
        </select>
        <select aria-label="Account" value={filters.accountId ?? ''} onChange={(event) => setOptionalFilter('accountId', event.target.value)}>
          <option value="">All accounts</option>{accountOptions.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
        <select aria-label="Category" value={filters.categoryId ?? ''} onChange={(event) => setOptionalFilter('categoryId', event.target.value)}>
          <option value="">All categories</option>
          {filters.categoryId && !page?.facets.categories.some(({ value }) => value === filters.categoryId) ? <option value={filters.categoryId}>{categoryLabel(filters.categoryId)}</option> : null}
          {page?.facets.categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
        </select>
        <select aria-label="Currency" value={filters.currency ?? ''} onChange={(event) => setOptionalFilter('currency', event.target.value)}>
          <option value="">All currencies</option>
          {filters.currency && !page?.facets.currencies.some(({ value }) => value === filters.currency) ? <option value={filters.currency}>{filters.currency}</option> : null}
          {page?.facets.currencies.map((currency) => <option key={currency.value} value={currency.value}>{currency.value}</option>)}
        </select>
        <input aria-label="From date" type="date" value={filters.fromDate ?? ''} onChange={(event) => setOptionalFilter('fromDate', event.target.value)} />
        <input aria-label="To date" type="date" value={filters.toDate ?? ''} onChange={(event) => setOptionalFilter('toDate', event.target.value)} />
        <select aria-label="Sort transactions" value={filters.sort ?? 'newest'} onChange={(event) => patchFilters({ sort: event.target.value as TransactionSort })}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount-high">Amount high</option><option value="amount-low">Amount low</option>
        </select>
        <div className="filter-actions">
          <Button variant="ghost" icon={<RotateCcw size={16} aria-hidden="true" />} disabled={!filtered} onClick={clearFilters}>Clear</Button>
          <Button variant="secondary" icon={<Download size={16} aria-hidden="true" />} loading={exporting} loadingLabel="Exporting" onClick={() => void exportFiltered()}>Export CSV</Button>
        </div>
      </Card>

      {page?.summaries.length ? (
        <div className="currency-summaries" aria-label="Filtered totals">
          {page.summaries.map((summary) => (
            <Card key={summary.currency} className="currency-summary">
              <span>{summary.currency}</span>
              <small>Income</small><strong className="income">{formatMinor(summary.income, summary.currency, 'en-US')}</strong>
              <small>Expenses</small><strong className="expense">{formatMinor(summary.expenses, summary.currency, 'en-US')}</strong>
              <small>Net</small><strong>{formatMinor(summary.net, summary.currency, 'en-US')}</strong>
            </Card>
          ))}
        </div>
      ) : null}

      {state === 'loading' ? <div className="workspace-state" role="status"><span className="workspace-state__spinner" /><p>Loading transactions</p></div> : null}
      {state === 'error' ? (
        <div className="workspace-state" role="alert">
          <h2>Transactions could not be refreshed</h2>
          <p>{page ? 'The last successful results remain visible below.' : 'Your local data has not been changed.'}</p>
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      ) : null}
      {page && page.total === 0 ? (
        <Card className="transactions-empty">
          <EmptyState icon={<ReceiptText aria-hidden="true" />} title={filtered ? 'No matching transactions' : 'Your ledger is ready'} description={filtered ? 'Try clearing or changing your filters.' : 'Add income, an expense, or a transfer to begin.'} action={filtered ? <Button onClick={clearFilters}>Clear filters</Button> : <Button onClick={openCreate}>Add first transaction</Button>} />
        </Card>
      ) : null}
      {page && page.total > 0 ? (
        <>
          <TransactionTable items={page.items} onEdit={(item) => openEdit(item.transaction)} onDelete={setDeleteTarget} deleting={deleting} />
          <nav className="pagination" aria-label="Transaction pages">
            <Button variant="ghost" disabled={filters.page <= 1} onClick={() => patchFilters({ page: filters.page - 1 })}>Previous</Button>
            <span>Page {page.page} of {Math.max(1, page.pageCount)}</span>
            <select aria-label="Rows per page" value={filters.pageSize} onChange={(event) => patchFilters({ pageSize: Number(event.target.value) as 25 | 50 | 100 })}><option>25</option><option>50</option><option>100</option></select>
            <Button variant="ghost" disabled={filters.page >= page.pageCount} onClick={() => patchFilters({ page: filters.page + 1 })}>Next</Button>
          </nav>
        </>
      ) : null}

      <Dialog open={deleteTarget !== null} title="Delete transaction?" description="This removes the ledger record and recalculates derived balances." dismissible={deleting.size === 0} onClose={() => { if (!deletePendingRef.current) setDeleteTarget(null) }}>
        <div className="confirmation">
          <p>This action cannot be undone. A safe audit entry will record the deletion.</p>
          {deleteFailure ? <p className="form-error form-error--banner" role="alert">{deleteFailure}</p> : null}
          <div className="form-actions form-actions--end">
            <Button variant="ghost" disabled={deleting.size > 0} onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" icon={<Trash2 size={16} aria-hidden="true" />} loading={deleting.size > 0} loadingLabel="Deleting" onClick={() => void confirmDelete()}>Delete transaction</Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}

function hasFilters(filters: TransactionFilters): boolean {
  return Boolean(filters.search || filters.type || filters.status || filters.accountId || filters.categoryId || filters.currency || filters.fromDate || filters.toDate || filters.sort !== 'newest')
}

function filtersFromSearch(params: URLSearchParams): TransactionFilters {
  const next: Record<string, unknown> = { ...initialFilters }
  const type = params.get('type')
  const status = params.get('status')
  const currency = params.get('currency')
  const accountId = params.get('accountId')
  const categoryId = params.get('categoryId')
  const fromDate = params.get('fromDate')
  const toDate = params.get('toDate')
  const search = params.get('search')
  const sort = params.get('sort')
  const page = Number(params.get('page'))
  const pageSize = Number(params.get('pageSize'))
  if (search && search.length <= 240) next.search = search
  if (type === 'income' || type === 'expense' || type === 'transfer') next.type = type
  if (status === 'completed' || status === 'planned' || status === 'cancelled') next.status = status
  if (currency && isSupportedCurrency(currency)) next.currency = currency
  if (accountId && safeFilterId(accountId)) next.accountId = accountId
  if (categoryId && safeFilterId(categoryId)) next.categoryId = categoryId
  if (fromDate && validDate(fromDate)) next.fromDate = fromDate
  if (toDate && validDate(toDate)) next.toDate = toDate
  if (sort === 'oldest' || sort === 'amount-high' || sort === 'amount-low') next.sort = sort
  if (Number.isSafeInteger(page) && page > 1) next.page = page
  if (pageSize === 50 || pageSize === 100) next.pageSize = pageSize
  if (typeof next.fromDate === 'string' && typeof next.toDate === 'string' && next.fromDate > next.toDate) {
    delete next.fromDate
    delete next.toDate
  }
  return next as unknown as TransactionFilters
}

function filtersToSearch(filters: TransactionFilters): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of ['search', 'type', 'status', 'accountId', 'categoryId', 'currency', 'fromDate', 'toDate'] as const) {
    const value = filters[key]
    if (value) result[key] = value
  }
  if (filters.sort && filters.sort !== 'newest') result.sort = filters.sort
  if (filters.page > 1) result.page = String(filters.page)
  if (filters.pageSize !== 25) result.pageSize = String(filters.pageSize)
  return result
}

function safeFilterId(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
  } catch {
    return false
  }
}
