import { useEffect, useState, type FormEvent } from 'react'
import type { BudgetDraft } from '../../application/budgetService'
import type { Budget } from '../../finance/types'
import {
  MAX_CUSTOM_CATEGORY_LENGTH,
  categoryOptions,
  customCategoryId,
} from '../../application/transactionCategories'
import { amountToDecimalString } from '../../export/csv'
import { Button } from '../../components/Button'

const NEW_CATEGORY = '__new__'

export function BudgetForm({
  budget,
  month,
  currency,
  currencies,
  knownCategoryIds = [],
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  budget?: Budget
  month: string
  currency: string
  currencies: readonly string[]
  knownCategoryIds?: readonly string[]
  pending: boolean
  error: string
  onSubmit: (draft: BudgetDraft) => void
  onCancel: () => void
}) {
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? '')
  const [newCategory, setNewCategory] = useState('')
  const [amount, setAmount] = useState(
    budget ? amountToDecimalString(budget.amount, budget.currency) : '',
  )
  const [selectedMonth, setSelectedMonth] = useState(budget?.month ?? month)
  const [selectedCurrency, setSelectedCurrency] = useState(budget?.currency ?? currency)
  const [validation, setValidation] = useState('')

  useEffect(() => {
    setCategoryId(budget?.categoryId ?? '')
    setNewCategory('')
    setAmount(budget ? amountToDecimalString(budget.amount, budget.currency) : '')
    setSelectedMonth(budget?.month ?? month)
    setSelectedCurrency(budget?.currency ?? currency)
  }, [budget, currency, month])

  const options = categoryOptions('expense', [
    ...knownCategoryIds,
    ...(budget ? [budget.categoryId] : []),
  ])
  const creating = categoryId === NEW_CATEGORY
  const createdId = creating ? customCategoryId(newCategory, 'expense') : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const resolved = creating ? createdId : categoryId
    if (creating && !resolved) {
      setValidation(`Name the new category using up to ${MAX_CUSTOM_CATEGORY_LENGTH} characters, without a colon.`)
      return
    }
    if (creating && options.some((item) => item.id === resolved)) {
      setValidation('That category already exists. Choose it from the list instead.')
      return
    }
    if (!resolved || !/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(selectedMonth) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount) || Number(amount) <= 0) {
      setValidation('Choose a category, month, and a positive amount.')
      return
    }
    setValidation('')
    onSubmit({ categoryId: resolved, amount, month: selectedMonth, currency: selectedCurrency })
  }

  return (
    <form className="budget-form" onSubmit={submit}>
      <div className="form-grid">
        <div className="field field--wide">
          <label htmlFor="budget-category">Category</label>
          <select id="budget-category" value={categoryId} disabled={pending} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Choose an expense category</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
            <option value={NEW_CATEGORY}>Create a new category</option>
          </select>
        </div>
        {creating ? (
          <div className="field field--wide">
            <label htmlFor="budget-new-category">New category name</label>
            <input
              id="budget-new-category"
              value={newCategory}
              disabled={pending}
              maxLength={MAX_CUSTOM_CATEGORY_LENGTH}
              autoFocus
              onChange={(event) => setNewCategory(event.target.value)}
              placeholder="Pet care"
            />
            <p className="field__hint">File transactions under this same name so the budget can measure them.</p>
          </div>
        ) : null}
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
