import { useEffect, useState, type FormEvent } from 'react'
import type { BudgetDraft } from '../../application/budgetService'
import type { Budget } from '../../finance/types'
import { TRANSACTION_CATEGORIES } from '../../application/transactionCategories'
import { Button } from '../../components/Button'

export function BudgetForm({
  budget,
  month,
  currency,
  currencies,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  budget?: Budget
  month: string
  currency: string
  currencies: readonly string[]
  pending: boolean
  error: string
  onSubmit: (draft: BudgetDraft) => void
  onCancel: () => void
}) {
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? '')
  const [amount, setAmount] = useState(
    budget ? String(budget.amount / (budget.currency === 'JPY' ? 1 : 100)) : '',
  )
  const [selectedMonth, setSelectedMonth] = useState(budget?.month ?? month)
  const [selectedCurrency, setSelectedCurrency] = useState(budget?.currency ?? currency)
  const [validation, setValidation] = useState('')

  useEffect(() => {
    setCategoryId(budget?.categoryId ?? '')
    setAmount(budget ? String(budget.amount / (budget.currency === 'JPY' ? 1 : 100)) : '')
    setSelectedMonth(budget?.month ?? month)
    setSelectedCurrency(budget?.currency ?? currency)
  }, [budget, currency, month])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!categoryId || !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(selectedMonth) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      setValidation('Choose a category, month, and a positive amount.')
      return
    }
    setValidation('')
    onSubmit({ categoryId, amount, month: selectedMonth, currency: selectedCurrency })
  }

  return (
    <form className="budget-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field field--wide">
          <label htmlFor="budget-category">Category</label>
          <select id="budget-category" value={categoryId} disabled={pending} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Choose an expense category</option>
            {TRANSACTION_CATEGORIES.filter(({ type }) => type === 'expense').map((category) => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="budget-month">Month</label>
          <input id="budget-month" type="month" value={selectedMonth} disabled={pending} onChange={(event) => setSelectedMonth(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="budget-currency">Currency</label>
          <select id="budget-currency" value={selectedCurrency} disabled={pending} onChange={(event) => setSelectedCurrency(event.target.value)}>
            {currencies.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div className="field field--wide">
          <label htmlFor="budget-amount">Amount</label>
          <input id="budget-amount" inputMode="decimal" value={amount} disabled={pending} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
          <p className="field__hint">Enter the amount in major currency units.</p>
        </div>
      </div>
      {validation ? <p className="form-error form-error--banner" role="alert">{validation}</p> : null}
      {error ? <p className="form-error form-error--banner" role="alert">{error}</p> : null}
      <div className="form-actions form-actions--end">
        <Button variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={pending} loadingLabel="Saving budget">Save budget</Button>
      </div>
    </form>
  )
}
