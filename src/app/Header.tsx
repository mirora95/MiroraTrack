import { Bell, Plus, Search } from 'lucide-react'
import { Button } from '../components/Button'
import { usePreferences, type ThemePreference } from '../stores/preferences'
import { useTransactionDialog } from '../features/transactions/TransactionDialogProvider'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const { openCreate } = useTransactionDialog()
  const theme = usePreferences((state) => state.theme)
  const setTheme = usePreferences((state) => state.setTheme)

  return (
    <header className="app-header">
      <div>
        <p className="app-header__context">Personal workspace</p>
        <p className="app-header__title">{title}</p>
      </div>
      <div className="app-header__actions">
        <label className="theme-control">
          <span>Theme</span>
          <select
            aria-label="Theme"
            value={theme}
            onChange={(event) => setTheme(event.target.value as ThemePreference)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <Button variant="ghost" className="icon-button header-icon" aria-label="Search">
          <Search size={19} aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          className="icon-button header-icon"
          aria-label="Notifications"
        >
          <Bell size={19} aria-hidden="true" />
        </Button>
        <Button
          className="quick-add-button"
          aria-label="Quick add transaction"
          icon={<Plus size={19} aria-hidden="true" />}
          onClick={openCreate}
        >
          Quick add transaction
        </Button>
      </div>
    </header>
  )
}
