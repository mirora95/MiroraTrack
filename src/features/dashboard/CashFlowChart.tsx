import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DashboardCashFlow } from '../../application/dashboardService'
import type { CurrencyCode } from '../../finance/types'
import { formatMinor } from '../../finance/money'
import { Link, useNavigate } from 'react-router-dom'
import { cashFlowDrilldownLink } from './drilldown'

export function CashFlowChart({ rows, currency }: { rows: readonly DashboardCashFlow[]; currency: CurrencyCode }) {
  const navigate = useNavigate()
  if (rows.length === 0) return <p className="chart-empty">No completed income or expenses in this range.</p>
  return (
    <>
      <div className="chart-canvas" aria-hidden="true">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={[...rows]}
            margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
            onClick={(chartState) => {
              const index = Number(chartState?.activeTooltipIndex)
              const row = Number.isInteger(index) ? rows[index] : undefined
              if (row) navigate(cashFlowDrilldownLink(row, currency))
            }}
          >
            <defs>
              <linearGradient id="income-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--status-income)" stopOpacity={0.32} /><stop offset="100%" stopColor="var(--status-income)" stopOpacity={0.02} /></linearGradient>
              <linearGradient id="expense-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--status-expense)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--status-expense)" stopOpacity={0.02} /></linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(value) => String(value).slice(5)} />
            <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={(value) => compactCurrency(Number(value), currency)} />
            <Tooltip formatter={(value, name) => [formatMinor(Number(value), currency, 'en-US'), name === 'income' ? 'Income' : 'Expenses']} labelFormatter={(label) => String(label)} contentStyle={{ borderRadius: 14, borderColor: 'var(--border-subtle)', background: 'var(--surface-raised)' }} />
            <Area type="monotone" dataKey="income" stroke="var(--status-income)" strokeWidth={2.5} fill="url(#income-fill)" activeDot={{ r: 5 }} />
            <Area type="monotone" dataKey="expenses" stroke="var(--status-expense)" strokeWidth={2.5} fill="url(#expense-fill)" activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="chart-details" aria-label="Cash flow details">
        <thead><tr><th>Date</th><th>Income</th><th>Expenses</th><th>Net flow</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.date}><td><Link to={cashFlowDrilldownLink(row, currency)}>{row.date}<span className="sr-only"> — view transactions</span></Link></td><td>{formatMinor(row.income, currency, 'en-US')}</td><td>{formatMinor(row.expenses, currency, 'en-US')}</td><td>{formatMinor(row.netCashFlow, currency, 'en-US')}</td></tr>)}</tbody>
      </table>
    </>
  )
}

function compactCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value / (currency === 'JPY' ? 1 : 100))
}
