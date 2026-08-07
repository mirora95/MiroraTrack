import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from 'lucide-react'
import type { HTMLAttributes, ReactNode } from 'react'

type StatusTone = 'success' | 'error' | 'warning' | 'neutral'

const statusIcons: Record<StatusTone, LucideIcon> = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  neutral: Info,
}

interface StatusStateProps extends HTMLAttributes<HTMLDivElement> {
  tone?: StatusTone
  children: ReactNode
}

export function StatusState({
  tone = 'neutral',
  className = '',
  children,
  ...props
}: StatusStateProps) {
  const Icon = statusIcons[tone]
  return (
    <div
      className={`status-state status-state--${tone} ${className}`.trim()}
      role="status"
      aria-label={typeof children === 'string' ? children : undefined}
      {...props}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}
