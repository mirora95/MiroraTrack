import { Outlet, useLocation } from 'react-router-dom'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { usePreferences, useThemePreference } from '../stores/preferences'
import { useRuntime } from './runtime'
import { TransactionDialogProvider } from '../features/transactions/TransactionDialogProvider'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/transactions': 'Transactions',
  '/accounts': 'Accounts',
  '/budgets': 'Budgets',
  '/activity': 'Activity',
  '/settings': 'Settings',
}

export function AppShell() {
  const location = useLocation()
  const collapsed = usePreferences((state) => state.sidebarCollapsed)
  const runtime = useRuntime()
  useThemePreference()

  return (
    <TransactionDialogProvider transactions={runtime.transactions} accounts={runtime.accounts} budgets={runtime.budgets}>
    <div className={`desktop-shell${collapsed ? ' desktop-shell--collapsed' : ''}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('#main-content')?.focus(),
          )
        }}
      >
        Skip to content
      </a>
      <Sidebar />
      <div className="desktop-shell__workspace">
        <Header title={pageTitles[location.pathname] ?? 'MiroraTrack'} />
        <main
          id="main-content"
          className="page-content"
          tabIndex={-1}
          aria-labelledby="page-title"
        >
          <Outlet />
        </main>
      </div>
    </div>
    </TransactionDialogProvider>
  )
}
