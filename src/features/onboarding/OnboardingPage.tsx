import { cloneElement, useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/Button'
import { LogoMark } from '../../components/LogoMark'
import { currencyFractionDigits, parseMajor, parseSignedMajor, SUPPORTED_CURRENCY_CODES } from '../../finance/money'
import type { AccountColor, AccountIcon, AccountType } from '../../finance/types'
import type { InitializationApplication } from '../../app/runtime'
import { en } from '../../i18n/en'

interface OnboardingValues {
  baseCurrency: string
  locale: string
  dateFormat: string
  name: string
  type: AccountType
  currency: string
  icon: AccountIcon
  color: AccountColor
  openingBalance: string
  creditLimit: string
}

const accountSchema = z.object({
  name: z.string().trim().min(1, 'Enter an account name.').max(60),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Choose a currency.'),
})

// Sourced from the finance engine so every currency picker in the application
// offers exactly the set the engine can parse, format, and validate.
const currencies = SUPPORTED_CURRENCY_CODES
const types: readonly AccountType[] = ['checking', 'savings', 'cash', 'credit', 'investment', 'other']
const icons: readonly AccountIcon[] = ['landmark', 'piggy-bank', 'wallet', 'credit-card', 'chart-line', 'banknote']
const colors: readonly AccountColor[] = ['blue', 'teal', 'gold', 'purple', 'green', 'slate']

export function OnboardingPage({
  service,
  onInitialized,
}: {
  service: InitializationApplication
  onInitialized: () => void
}) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const {
    register,
    getValues,
    setError,
    formState: { errors },
    watch,
  } = useForm<OnboardingValues>({
    defaultValues: {
      baseCurrency: 'USD',
      locale: 'en-US',
      dateFormat: 'MM/dd/yyyy',
      name: '',
      type: 'checking',
      currency: 'USD',
      icon: 'landmark',
      color: 'blue',
      openingBalance: '0',
      creditLimit: '',
    },
  })
  const accountType = watch('type')

  const advance = () => {
    if (step === 2) {
      const result = accountSchema.safeParse(getValues())
      if (!result.success) {
        for (const issue of result.error.issues) {
          setError(issue.path[0] as 'name' | 'currency', { message: issue.message })
        }
        return
      }
    }
    setStep((current) => Math.min(3, current + 1))
  }

  const finish = async () => {
    if (submitting) return
    setFailure('')
    const values = getValues()
    let openingBalance
    let creditLimit
    try {
      const fractionDigits = currencyFractionDigits(values.currency)
      try {
        openingBalance = parseSignedMajor(values.openingBalance || '0', fractionDigits)
      } catch {
        setError('openingBalance', { message: 'Enter a valid opening balance.' })
        setStep(2)
        return
      }
      if (values.type === 'credit' && values.creditLimit.trim()) {
        try {
          creditLimit = parseMajor(values.creditLimit, fractionDigits)
        } catch {
          setError('creditLimit', { message: 'Enter a valid credit limit.' })
          setStep(2)
          return
        }
      }
      setSubmitting(true)
      await service.initialize({
        baseCurrency: values.baseCurrency,
        locale: values.locale,
        dateFormat: values.dateFormat,
        account: {
          name: values.name,
          type: values.type,
          currency: values.currency,
          icon: values.icon,
          color: values.color,
          openingBalance,
          ...(creditLimit === undefined ? {} : { creditLimit }),
        },
      })
      onInitialized()
      navigate('/', { replace: true })
    } catch {
      setFailure('MiroraTrack could not create your workspace. Your entries are still here—please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const headings = [
    'Choose your home currency',
    'Set your date format',
    'Add your first account',
    'Ready when you are',
  ]

  return (
    <main className="onboarding" aria-labelledby="onboarding-title">
      <section className="onboarding__brand" aria-label="MiroraTrack">
        <LogoMark className="onboarding__logo" label="MiroraTrack" />
        <span>MiroraTrack</span>
        <p>Your private financial home, built entirely on this device.</p>
        <div className="onboarding__privacy">
          <LockKeyhole aria-hidden="true" size={18} />
          {en.onboarding.privacy}
        </div>
      </section>
      <section className="onboarding__panel">
        <div
          className="onboarding__progress"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={4}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of 4`}
        >
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={index <= step ? 'is-active' : ''}
              aria-hidden="true"
            />
          ))}
        </div>
        <p className="eyebrow">Step {step + 1} of 4</p>
        <h1 id="onboarding-title">{headings[step]}</h1>

        {step === 0 ? (
          <div className="form-stack">
            <p className="form-intro">This is your reporting currency. Each account can still use its own currency.</p>
            <Field label="Base currency" error={errors.baseCurrency?.message}>
              <select {...register('baseCurrency')} id="baseCurrency">
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </Field>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="form-stack">
            <p className="form-intro">Choose how dates appear throughout your private ledger.</p>
            <Field label="Date format" error={errors.dateFormat?.message}>
              <select {...register('dateFormat')} id="dateFormat">
                <option value="MM/dd/yyyy">MM/DD/YYYY</option>
                <option value="dd/MM/yyyy">DD/MM/YYYY</option>
                <option value="yyyy-MM-dd">YYYY-MM-DD</option>
              </select>
            </Field>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="form-grid">
            <Field label="Account name" error={errors.name?.message} wide>
              <input id="name" autoFocus {...register('name')} />
            </Field>
            <Field label="Account type">
              <select id="type" {...register('type')}>
                {types.map((type) => <option key={type} value={type}>{title(type)}</option>)}
              </select>
            </Field>
            <Field label="Account currency" error={errors.currency?.message}>
              <select id="currency" {...register('currency')}>
                {currencies.map((currency) => <option key={currency}>{currency}</option>)}
              </select>
            </Field>
            <Field label="Account icon">
              <select id="icon" {...register('icon')}>
                {icons.map((icon) => <option key={icon} value={icon}>{title(icon)}</option>)}
              </select>
            </Field>
            <Field label="Account color">
              <select id="color" {...register('color')}>
                {colors.map((color) => <option key={color} value={color}>{title(color)}</option>)}
              </select>
            </Field>
            <Field label="Opening balance" hint="Use a minus sign for money owed." error={errors.openingBalance?.message}>
              <input id="openingBalance" inputMode="decimal" {...register('openingBalance')} />
            </Field>
            {accountType === 'credit' ? (
              <Field label="Credit limit" error={errors.creditLimit?.message}>
                <input id="creditLimit" inputMode="decimal" {...register('creditLimit')} />
              </Field>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="onboarding__review">
            <div className="onboarding__check"><Check aria-hidden="true" /></div>
            <h2>{getValues('name')}</h2>
            <p>{title(getValues('type'))} · {getValues('currency')} · Base {getValues('baseCurrency')}</p>
            <div className="privacy-note">
              <LockKeyhole aria-hidden="true" size={18} />
              We never add demo data. Your workspace starts clean and private.
            </div>
          </div>
        ) : null}

        {failure ? <p className="form-error form-error--banner" role="alert">{failure}</p> : null}
        <div className="form-actions">
          {step > 0 ? (
            <Button variant="ghost" icon={<ArrowLeft aria-hidden="true" size={18} />} onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : <span />}
          {step < 3 ? (
            <Button icon={<ArrowRight aria-hidden="true" size={18} />} onClick={advance}>
              Continue
            </Button>
          ) : (
            <Button loading={submitting} loadingLabel="Setting up MiroraTrack" onClick={finish}>
              {en.onboarding.submit}
            </Button>
          )}
        </div>
      </section>
    </main>
  )
}

function Field({
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
