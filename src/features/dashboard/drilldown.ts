import type {
  DashboardCashFlow,
  DashboardCategoryBreakdown,
} from '../../application/dashboardService'
import type { DateRange } from '../../finance/ledger'
import type { CurrencyCode } from '../../finance/types'

export function transactionLink(filters: {
  currency: string
  type?: string
  accountId?: string
  categoryId?: string
  fromDate: string
  toDate: string
}): string {
  const params = new URLSearchParams()
  params.set('currency', filters.currency)
  if (filters.type) params.set('type', filters.type)
  if (filters.accountId) params.set('accountId', filters.accountId)
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  params.set('fromDate', filters.fromDate)
  params.set('toDate', filters.toDate)
  return `/transactions?${params.toString()}`
}

export function cashFlowDrilldownLink(
  row: DashboardCashFlow,
  currency: CurrencyCode,
): string {
  return transactionLink({
    currency,
    fromDate: row.date,
    toDate: row.date,
  })
}

export function categoryDrilldownLink(
  row: DashboardCategoryBreakdown,
  currency: CurrencyCode,
  range: DateRange,
): string {
  return transactionLink({
    currency,
    type: 'expense',
    categoryId: row.categoryId,
    fromDate: range.start.slice(0, 10),
    toDate: range.end.slice(0, 10),
  })
}
