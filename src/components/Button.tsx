import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  icon?: ReactNode
  loading?: boolean
  loadingLabel?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    icon,
    loading = false,
    loadingLabel = 'Working',
    className = '',
    children,
    type = 'button',
    disabled,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`button button--${variant} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <span className="button__spinner" aria-hidden="true" /> : null}
      {!loading && icon ? <span className="button__icon">{icon}</span> : null}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  )
})
