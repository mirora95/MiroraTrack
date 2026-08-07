import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article'
  interactive?: boolean
  labelledBy?: string
  children: ReactNode
}

export function Card({
  as: Component = 'section',
  interactive = false,
  labelledBy,
  className = '',
  ...props
}: CardProps) {
  return (
    <Component
      className={`card${interactive ? ' card--interactive' : ''} ${className}`.trim()}
      aria-labelledby={labelledBy}
      {...props}
    />
  )
}
