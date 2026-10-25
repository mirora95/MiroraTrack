import { cloneElement, useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '../../components/Button'
import { amountToDecimalString } from '../../export/csv'
import type { AccountDraft } from '../../application/accountRecords'
import type { UpdateAccountCommand } from '../../application/accountService'
import { currencyFractionDigits, parseMajor, parseSignedMajor, SUPPORTED_CURRENCY_CODES } from '../../finance/money'
import type { Account, AccountColor, AccountIcon, AccountType } from '../../finance/types'

interface Values {
  name: string
  type: AccountType
  currency: string
  icon: AccountIcon
  color: AccountColor
  openingBalance: string
  creditLimit: string
}

const schema = z.object({
  name: z.string().trim().min(1, 'Enter an account name.').max(60, 'Keep the name under 60 characters.'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency.'),
})

// Sourced from the finance engine so every currency picker in the application
// offers exactly the set the engine can parse, format, and validate.
const currencies = SUPPORTED_CURRENCY_CODES
const types: readonly AccountType[] = ['checking', 'savings', 'cash', 'credit', 'investment', 'other']
const icons: readonly AccountIcon[] = ['landmark', 'piggy-bank', 'wallet', 'credit-card', 'chart-line', 'banknote']
const colors: readonly AccountColor[] = ['blue', 'teal', 'gold', 'purple', 'green', 'slate']

export function AccountForm({
  account,
  onSave,
  onCancel,
  onBusyChange,
}: {
  account?: Account
  onSave: (command: AccountDraft | UpdateAccountCommand) => Promise<void>
  onCancel: () => void
  onBusyChange?: (busy: boolean) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState('')
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'checking',
      currency: account?.currency ?? 'USD',
      icon: account?.icon ?? 'landmark',
      color: account?.color ?? 'blue',
      openingBalance: '0',
      creditLimit: account?.creditLimit === undefined
        ? ''
        : amountToDecimalString(account.creditLimit, account.currency),
    },
  })
  const type = watch('type')

  const submit = handleSubmit(async (values) => {
    if (submitting) return
    setFailure('')
    const parsed = schema.safeParse(values)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        setError(issue.path[0] as 'name' | 'currency', { message: issue.message })
      }
      return
    }
    try {
      const fractionDigits = currencyFractionDigits(values.currency)
      let openingBalance: number | undefined
      if (!account) {
        try {
          openingBalance = parseSignedMajor(values.openingBalance || '0', fractionDigits)
        } catch {
          setError('openingBalance', { message: 'Enter a valid opening balance.' })
          return
        }
      }
      let creditLimit: number | undefined
      if (values.type === 'credit' && values.creditLimit.trim()) {
        if (values.creditLimit.trim().startsWith('-')) {
          setError('creditLimit', { message: 'Credit limit must be non-negative.' })
          return
        }
        try {
          creditLimit = parseMajor(values.creditLimit, fractionDigits)
        } catch {
          setError('creditLimit', { message: 'Enter a valid credit limit.' })
          return
        }
      }
      setSubmitting(true)
      onBusyChange?.(true)
      await onSave(account ? {
        id: account.id,
        name: values.name,
        type: values.type,
        currency: values.currency,
        icon: values.icon,
        color: values.color,
        ...(creditLimit === undefined ? {} : { creditLimit }),
      } : {
        name: values.name,
        type: values.type,
        currency: values.currency,
        icon: values.icon,
        color: values.color,
        openingBalance: openingBalance!,
        ...(creditLimit === undefined ? {} : { creditLimit }),
      })
    } catch {
      setFailure(`MiroraTrack could not ${account ? 'save changes to' : 'create'} this account. Please try again.`)
    } finally {
      setSubmitting(false)
      onBusyChange?.(false)
    }
  })

  return (
    <form className="account-form" onSubmit={submit} noValidate>
      <div className="form-grid">
        <FormField label="Account name" error={errors.name?.message} wide>
          <input id="account-name" autoFocus {...register('name')} />
        </FormField>
        <FormField label="Account type">
          <select id="account-type" {...register('type')}>
            {types.map((item) => <option key={item} value={item}>{title(item)}</option>)}
          </select>
        </FormField>
        <FormField label="Account currency" error={errors.currency?.message}>
          <select id="account-currency" {...register('currency')}>
            {currencies.map((currency) => <option key={currency}>{currency}</option>)}
          </select>
        </FormField>
        <FormField label="Account icon">
          <select id="account-icon" {...register('icon')}>
            {icons.map((icon) => <option key={icon} value={icon}>{title(icon)}</option>)}
          </select>
        </FormField>
        <FormField label="Account color">
          <select id="account-color" {...register('color')}>
            {colors.map((color) => <option key={color} value={color}>{title(color)}</option>)}
          </select>
        </FormField>
        {!account ? (
          <FormField label="Opening balance" hint="Use a minus sign for money owed." error={errors.openingBalance?.message}>
            <input id="account-opening" inputMode="decimal" {...register('openingBalance')} />
          </FormField>
        ) : null}
        {type === 'credit' ? (
          <FormField label="Credit limit" error={errors.creditLimit?.message}>
            <input id="account-credit-limit" inputMode="decimal" {...register('creditLimit')} />
          </FormField>
        ) : null}
      </div>
      {failure ? <p className="form-error form-error--banner" role="alert">{failure}</p> : null}
      <div className="form-actions form-actions--end">
        <Button variant="ghost" disabled={submitting} onClick={onCancel}>Cancel</Button>
        <Button
          type="submit"
          loading={submitting}
          loadingLabel={account ? 'Saving changes' : 'Creating account'}
        >
          {account ? 'Save changes' : 'Create account'}
        </Button>
      </div>
    </form>
  )
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
  return value.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
