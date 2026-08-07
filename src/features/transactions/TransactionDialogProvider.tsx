import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  AccountsApplication,
  TransactionsApplication,
} from '../../app/runtime'
import type { Transaction } from '../../finance/types'
import { Dialog } from '../../components/Dialog'
import { TransactionForm } from './TransactionForm'

interface TransactionDialogContextValue {
  openCreate(): void
  openEdit(transaction: Transaction): void
  revision: number
}

const TransactionDialogContext =
  createContext<TransactionDialogContextValue | null>(null)

export function TransactionDialogProvider({
  transactions,
  accounts,
  children,
}: {
  transactions: TransactionsApplication
  accounts: AccountsApplication
  children: ReactNode
}) {
  const [target, setTarget] = useState<Transaction | 'create' | null>(null)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const triggerRef = useRef<HTMLElement | null>(null)

  const close = useCallback(() => {
    if (!busy) setTarget(null)
  }, [busy])
  const openCreate = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null
    setTarget('create')
  }, [])
  const openEdit = useCallback((transaction: Transaction) => {
    triggerRef.current = document.activeElement as HTMLElement | null
    setTarget(transaction)
  }, [])
  const context = useMemo(
    () => ({ openCreate, openEdit, revision }),
    [openCreate, openEdit, revision],
  )

  return (
    <TransactionDialogContext.Provider value={context}>
      {children}
      <Dialog
        open={target !== null}
        title={target === 'create' ? 'Add transaction' : 'Edit transaction'}
        description="Saved directly to your private local ledger."
        dismissible={!busy}
        onClose={close}
      >
        {target ? (
          <TransactionForm
            transaction={target === 'create' ? undefined : target}
            accounts={accounts}
            service={transactions}
            onBusyChange={setBusy}
            onConflict={() => setRevision((value) => value + 1)}
            onCancel={close}
            onSaved={() => {
              setTarget(null)
              setRevision((value) => value + 1)
              window.requestAnimationFrame(() => triggerRef.current?.focus())
            }}
          />
        ) : null}
      </Dialog>
    </TransactionDialogContext.Provider>
  )
}

export function useTransactionDialog(): TransactionDialogContextValue {
  const value = useContext(TransactionDialogContext)
  if (!value) throw new Error('Transaction dialog is unavailable')
  return value
}
