import { Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({
  title,
  description,
  action,
  icon = <Sparkles aria-hidden="true" />,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  )
}
