import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

interface DialogProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  dismissible?: boolean
}

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
  dismissible = true,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const frame = window.requestAnimationFrame(() => {
      const body = panelRef.current?.querySelector<HTMLElement>('.dialog__body')
      const bodyTarget = body?.querySelector<HTMLElement>(focusableSelector)
      const dialogTarget =
        panelRef.current?.querySelector<HTMLElement>(focusableSelector)
      const initialTarget = bodyTarget ?? dialogTarget ?? panelRef.current
      initialTarget?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      previouslyFocused.current?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [dismissible, onClose, open])

  if (!open) return null

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
    )
    if (focusable.length === 0) {
      event.preventDefault()
      panelRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={() => { if (dismissible) onClose() }}
    >
      <div
        ref={panelRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="Close dialog"
            disabled={!dismissible}
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>
        <div className="dialog__body">{children}</div>
      </div>
    </div>
  )
}
