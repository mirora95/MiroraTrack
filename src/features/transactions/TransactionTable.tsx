import { ArrowDownLeft, ArrowRightLeft, ArrowUpRight, Pencil, Trash2 } from 'lucide-react'
import type { TransactionListItem } from '../../application/transactionService'
import { formatMinor } from '../../finance/money'
import { Button } from '../../components/Button'

export function TransactionTable({
  items,
  onEdit,
  onDelete,
  deleting,
}: {
  items: readonly TransactionListItem[]
  onEdit(item: TransactionListItem): void
  onDelete(item: TransactionListItem): void
  deleting: ReadonlySet<string>
}) {
  return (
    <div className="transaction-table-wrap">
      <table className="transaction-table">
        <caption className="sr-only">Filtered transactions</caption>
        <thead>
          <tr>
            <th scope="col">Transaction</th>
            <th scope="col">Account</th>
            <th scope="col">Date</th>
            <th scope="col">Status</th>
            <th scope="col" className="numeric">Amount</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const transaction = item.transaction
            const Icon = transaction.type === 'income'
              ? ArrowDownLeft
              : transaction.type === 'expense'
                ? ArrowUpRight
                : ArrowRightLeft
            const account = transaction.type === 'transfer'
              ? `${item.sourceAccountLabel} → ${item.destinationAccountLabel}`
              : item.sourceAccountLabel ?? item.destinationAccountLabel
            const opening = transaction.purpose === 'opening-balance'
            return (
              <tr key={transaction.id} className={`transaction-row transaction-row--${transaction.type}`}>
                <td data-label="Transaction">
                  <div className="transaction-primary">
                    <span className="transaction-primary__icon"><Icon size={17} aria-hidden="true" /></span>
                    <span>
                      <strong>{item.categoryLabel ?? 'Transfer'}</strong>
                      <small>{transaction.description || title(transaction.type)}</small>
                    </span>
                  </div>
                </td>
                <td data-label="Account">{account}</td>
                <td data-label="Date">
                  <time dateTime={transaction.effectiveAt}>
                    {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(transaction.effectiveAt))}
                  </time>
                </td>
                <td data-label="Status"><span className={`transaction-status transaction-status--${transaction.status}`}>{title(transaction.status)}</span></td>
                <td data-label="Amount" className="numeric">
                  <strong>{transaction.type === 'expense' ? '−' : transaction.type === 'income' ? '+' : ''}{formatMinor(transaction.amount, transaction.currency, 'en-US')}</strong>
                </td>
                <td className="transaction-actions">
                  {opening ? <span className="immutable-label">System record</span> : (
                    <>
                      <Button variant="ghost" className="icon-button" aria-label={`Edit ${item.categoryLabel ?? 'transfer'}`} onClick={() => onEdit(item)}>
                        <Pencil size={16} aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        className="icon-button"
                        aria-label={`Delete ${item.categoryLabel ?? 'transfer'}`}
                        loading={deleting.has(transaction.id)}
                        loadingLabel="Deleting"
                        onClick={() => onDelete(item)}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function title(value: string): string {
  return value[0].toUpperCase() + value.slice(1)
}
