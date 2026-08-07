import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import type {
  AccountsApplication,
  TransactionsApplication,
} from '../../app/runtime'
import { TRANSACTION_CATEGORIES } from '../../application/transactionCategories'
import type { TransactionDraft } from '../../application/financeService'
import { ValidationError } from '../../application/validation'
import { currencyFractionDigits } from '../../finance/money'
import type { Account, Transaction } from '../../finance/types'
import { Button } from '../../components/Button'

interface Values {
  type: Transaction['type']
  status: Transaction['status']
  amount: string
  date: string
  categoryId: string
  sourceAccountId: string
  destinationAccountId: string
  note: string
}

export function TransactionForm({
  transaction,
  accounts: accountService,
  service,
  onCancel,
  onSaved,
  onBusyChange,
  onConflict,
}: {
  transaction?: Transaction | undefined
  accounts: AccountsApplication
  service: TransactionsApplication
  onCancel(): void
  onSaved(transaction: Transaction): void
  onBusyChange?(busy: boolean): void
  onConflict?(): void
}) {
  const [accounts, setAccounts] = useState<readonly Account[]>([])
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [failure, setFailure] = useState('')
  const [conflict, setConflict] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: defaults(transaction),
  })

  useEffect(() => {
    let active = true
    void accountService.list().then(
      (items) => {
        if (active) {
          setAccounts(items.map((item) => item.account).filter((item) => item.status === 'active'))
          setLoadingAccounts(false)
        }
      },
      () => {
        if (active) {
          setFailure('MiroraTrack could not load active accounts.')
          setLoadingAccounts(false)
        }
      },
    )
    return () => { active = false }
  }, [accountService])

  const type = watch('type')
  const sourceId = watch('sourceAccountId')
  const destinationId = watch('destinationAccountId')
  const previousTypeRef = useRef(type)
  useEffect(() => {
    if (previousTypeRef.current === type) return
    previousTypeRef.current = type
    setValue('categoryId', '')
    if (type === 'expense') setValue('destinationAccountId', '')
    if (type === 'income') setValue('sourceAccountId', '')
  }, [setValue, type])
  const source = accounts.find((account) => account.id === sourceId)
  const destinations = type === 'transfer'
    ? source
      ? accounts.filter((account) =>
          account.id !== source.id && account.currency === source.currency)
      : []
    : accounts
  useEffect(() => {
    if (
      type === 'transfer' &&
      destinationId &&
      !destinations.some((account) => account.id === destinationId)
    ) {
      setValue('destinationAccountId', '')
    }
  }, [destinationId, destinations, setValue, type])
  const categories = TRANSACTION_CATEGORIES.filter((item) => item.type === type)
  const legacyCategory = transaction &&
    transaction.type !== 'transfer' &&
    transaction.categoryId &&
    !categories.some((item) => item.id === transaction.categoryId)
      ? transaction.categoryId
      : undefined

  const submit = handleSubmit(async (values) => {
    if (pendingRef.current) return
    setFailure('')
    setConflict(false)
    const draft = toDraft(values)
    if (!draft) {
      if (!values.amount.trim()) setError('amount', { message: 'Enter an amount.' })
      if (!values.date) setError('date', { message: 'Choose a date.' })
      if (type === 'income' && !values.destinationAccountId) {
        setError('destinationAccountId', { message: 'Choose an account.' })
      }
      if (type !== 'income' && !values.sourceAccountId) {
        setError('sourceAccountId', { message: 'Choose an account.' })
      }
      if (type === 'transfer' && !values.destinationAccountId) {
        setError('destinationAccountId', { message: 'Choose a destination account.' })
      }
      if (type !== 'transfer' && !values.categoryId) {
        setError('categoryId', { message: 'Choose a category.' })
      }
      return
    }
    pendingRef.current = true
    setPending(true)
    onBusyChange?.(true)
    try {
      const saved = transaction
        ? await service.edit(transaction.id, draft)
        : await service.create(draft)
      onSaved(saved)
    } catch (error) {
      if (error instanceof ValidationError) {
        if (error.code === 'CONCURRENT_MODIFICATION') {
          setConflict(true)
          onConflict?.()
          setFailure('This transaction changed elsewhere. The ledger list was refreshed behind this dialog; your values remain here for review.')
        } else if (error.field in values) {
          setError(error.field as keyof Values, { message: validationMessage(error) })
        } else {
          setFailure(validationMessage(error))
        }
      } else {
        setFailure('MiroraTrack could not save this transaction. Your values are still here.')
      }
    } finally {
      pendingRef.current = false
      setPending(false)
      onBusyChange?.(false)
    }
  })

  const amountAccount = type === 'income'
    ? accounts.find((account) => account.id === watch('destinationAccountId'))
    : source
  const fractionHint = amountAccount
    ? `${amountAccount.currency} supports ${currencyFractionDigits(amountAccount.currency)} decimal places.`
    : 'Currency is taken from the selected account.'

  return (
    <form className="transaction-form" onSubmit={submit} noValidate>
      <fieldset disabled={pending} className="transaction-fields">
      <div className="transaction-type-tabs" role="radiogroup" aria-label="Transaction type">
        {(['expense', 'income', 'transfer'] as const).map((value) => (
          <label key={value} className={type === value ? 'is-selected' : ''}>
            <input type="radio" value={value} {...register('type')} />
            {title(value)}
          </label>
        ))}
      </div>
      <div className="form-grid">
        <FormField label="Amount" error={errors.amount?.message} hint={fractionHint}>
          <input id="transaction-amount" inputMode="decimal" autoFocus {...register('amount')} />
        </FormField>
        <FormField label="Date" error={errors.date?.message}>
          <input id="transaction-date" type="date" {...register('date')} />
        </FormField>
        {type !== 'income' ? (
          <FormField label={type === 'transfer' ? 'From account' : 'Account'} error={errors.sourceAccountId?.message}>
            <select id="transaction-source" disabled={loadingAccounts} {...register('sourceAccountId')}>
              <option value="">Choose account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
            </select>
          </FormField>
        ) : null}
        {type !== 'expense' ? (
          <FormField label={type === 'transfer' ? 'To account' : 'Account'} error={errors.destinationAccountId?.message}>
            <select id="transaction-destination" disabled={loadingAccounts} {...register('destinationAccountId')}>
              <option value="">Choose account</option>
              {destinations.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>)}
            </select>
          </FormField>
        ) : null}
        {type !== 'transfer' ? (
          <FormField label="Category" error={errors.categoryId?.message}>
            <select id="transaction-category" {...register('categoryId')}>
              <option value="">Choose category</option>
              {legacyCategory ? <option value={legacyCategory}>Other (legacy)</option> : null}
              {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </FormField>
        ) : null}
        <FormField label="Status">
          <select id="transaction-status" {...register('status')}>
            <option value="completed">Completed</option>
            <option value="planned">Planned</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </FormField>
        <FormField label="Note" error={errors.note?.message} wide>
          <textarea id="transaction-note" rows={3} maxLength={240} {...register('note')} />
        </FormField>
      </div>
      </fieldset>
      {failure ? <p className="form-error form-error--banner" role="alert">{failure}</p> : null}
      {conflict ? <p className="field__hint">Your unsaved values were retained for comparison.</p> : null}
      <div className="form-actions form-actions--end">
        <Button variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={pending} loadingLabel="Saving transaction">
          {transaction ? 'Save changes' : 'Add transaction'}
        </Button>
      </div>
    </form>
  )
}

function defaults(transaction?: Transaction): Values {
  const date = transaction?.effectiveAt.slice(0, 10) ??
    localDateInputValue()
  return {
    type: transaction?.type ?? 'expense',
    status: transaction?.status ?? 'completed',
    amount: transaction ? majorText(transaction.amount, currencyFractionDigits(transaction.currency)) : '',
    date,
    categoryId: transaction && transaction.type !== 'transfer' ? transaction.categoryId : '',
    sourceAccountId: transaction && transaction.type !== 'income' ? transaction.sourceAccountId : '',
    destinationAccountId: transaction && transaction.type !== 'expense' ? transaction.destinationAccountId : '',
    note: transaction?.description ?? '',
  }
}

type LocalDateParts = Pick<Date, 'getFullYear' | 'getMonth' | 'getDate'>

export function localDateInputValue(date: LocalDateParts = new Date()): string {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = (date.getMonth() + 1).toString().padStart(2, '0')
  const day = date.getDate().toString().padStart(2, '0')
  return `${year}-${month}-${day}`
}

function majorText(amount: number, fractionDigits: number): string {
  const scale = 10n ** BigInt(fractionDigits)
  const minor = BigInt(amount)
  const whole = minor / scale
  if (fractionDigits === 0) return whole.toString()
  const fraction = (minor % scale).toString().padStart(fractionDigits, '0')
  return `${whole}.${fraction}`
}

function toDraft(values: Values): TransactionDraft | undefined {
  if (!values.amount.trim() || !values.date) return undefined
  const shared = {
    status: values.status,
    amount: values.amount,
    date: values.date,
    ...(values.note.trim() ? { note: values.note } : {}),
  }
  if (values.type === 'income') {
    if (!values.destinationAccountId || !values.categoryId) return undefined
    return { ...shared, type: 'income', destinationAccountId: values.destinationAccountId, categoryId: values.categoryId }
  }
  if (values.type === 'expense') {
    if (!values.sourceAccountId || !values.categoryId) return undefined
    return { ...shared, type: 'expense', sourceAccountId: values.sourceAccountId, categoryId: values.categoryId }
  }
  if (!values.sourceAccountId || !values.destinationAccountId) return undefined
  return { ...shared, type: 'transfer', sourceAccountId: values.sourceAccountId, destinationAccountId: values.destinationAccountId }
}

function validationMessage(error: ValidationError): string {
  const messages: Partial<Record<ValidationError['code'], string>> = {
    INVALID_AMOUNT: 'Enter a positive amount with the correct decimal places.',
    INVALID_DATE: 'Choose a valid date.',
    INVALID_CATEGORY: 'Choose a valid category for this transaction type.',
    INVALID_NOTE: 'Keep the note under 240 characters.',
    SAME_ACCOUNT: 'Choose two different accounts.',
    CURRENCY_MISMATCH: 'Transfers require accounts in the same currency.',
    ACCOUNT_ARCHIVED: 'Choose an active account.',
    ACCOUNT_NOT_FOUND: 'That account is no longer available.',
  }
  return messages[error.code] ?? 'This transaction could not be saved.'
}

function FormField({
  label,
  error,
  hint,
  wide,
  children,
}: {
  label: string
  error?: string | undefined
  hint?: string | undefined
  wide?: boolean
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>
}) {
  const id = children.props.id!
  const messageId = `${id}-message`
  return (
    <div className={`field${wide ? ' field--wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {error
        ? <p id={messageId} className="field__error" role="alert">{error}</p>
        : hint ? <p id={messageId} className="field__hint">{hint}</p> : null}
      {cloneElement(children, {
        ...(error || hint ? { 'aria-describedby': messageId } : {}),
        ...(error ? { 'aria-invalid': true } : {}),
      })}
    </div>
  )
}

function title(value: string): string {
  return value[0].toUpperCase() + value.slice(1)
}
