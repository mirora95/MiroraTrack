import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { DashboardCategoryBreakdown } from '../../application/dashboardService'
import type { CurrencyCode } from '../../finance/types'
import type { DateRange } from '../../finance/ledger'
import { formatMinor } from '../../finance/money'
import { Link, useNavigate } from 'react-router-dom'
import { categoryDrilldownLink } from './drilldown'

const colors = ['#2563EB', '#0F766E', '#F59E0B', '#7C3AED', '#DC2626', '#0891B2', '#475569']

export function CategoryBreakdownChart({ rows, currency, range }: { rows: readonly DashboardCategoryBreakdown[]; currency: CurrencyCode; range: DateRange }) {
  const navigate = useNavigate()
  if (rows.length === 0) return <p className="chart-empty">No completed expenses in this range.</p>
  return (
    <>
      <div className="category-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height={230}>
          <PieChart>
            <Pie
              data={[...rows]}
              dataKey="amount"
              nameKey="label"
              innerRadius={58}
              outerRadius={92}
              paddingAngle={3}
              onClick={(_entry, index) => {
                const row = rows[index]
                if (row) navigate(categoryDrilldownLink(row, currency, range))
              }}
            >
              {rows.map((row, index) => <Cell key={row.categoryId} fill={colors[index % colors.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => formatMinor(Number(value), currency, 'en-US')} contentStyle={{ borderRadius: 14, borderColor: 'var(--border-subtle)', background: 'var(--surface-raised)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <table className="chart-details" aria-label="Spending category details">
        <thead><tr><th>Category</th><th>Spent</th><th>Share</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.categoryId}><td><Link to={categoryDrilldownLink(row, currency, range)}>{row.label}<span className="sr-only"> — view expense transactions</span></Link></td><td>{formatMinor(row.amount, currency, 'en-US')}</td><td>{row.percentOfExpenses.toFixed(0)}%</td></tr>)}</tbody>
      </table>
    </>
  )
}
