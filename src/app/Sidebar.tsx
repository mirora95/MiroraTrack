import {
  Activity,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Sparkles,
  WalletCards,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { Button } from '../components/Button'
import { LogoMark } from '../components/LogoMark'
import { usePreferences } from '../stores/preferences'

const primaryItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/accounts', label: 'Accounts', icon: WalletCards },
  { to: '/budgets', label: 'Budgets', icon: ChartNoAxesCombined },
  { to: '/activity', label: 'Activity', icon: Activity },
] as const

export function Sidebar() {
  const collapsed = usePreferences((state) => state.sidebarCollapsed)
  const toggleSidebar = usePreferences((state) => state.toggleSidebar)

  return (
    <aside className="sidebar">
      <NavLink to="/" className="sidebar__brand" aria-label="MiroraTrack home">
        <LogoMark
          className="sidebar__mark"
          decorative={collapsed}
          label="MiroraTrack"
        />
        <span className="sidebar__brand-text">MiroraTrack</span>
      </NavLink>

      <div className="sidebar__insight" aria-label="Private and local">
        <Sparkles size={17} aria-hidden="true" />
        <span>
          <strong>Private by design</strong>
          Your data stays with you
        </span>
      </div>

      <nav className="sidebar__nav" aria-label="Primary navigation">
        {primaryItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
            }
            title={collapsed ? label : undefined}
          >
            <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="sidebar__divider" />
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `sidebar__link${isActive ? ' sidebar__link--active' : ''}`
          }
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings size={20} strokeWidth={1.8} aria-hidden="true" />
          <span>Settings</span>
        </NavLink>
      </nav>

      <Button
        variant="ghost"
        className="sidebar__collapse"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        onClick={toggleSidebar}
        icon={
          collapsed ? (
            <ChevronRight size={18} aria-hidden="true" />
          ) : (
            <ChevronLeft size={18} aria-hidden="true" />
          )
        }
      >
        <span>{collapsed ? 'Expand' : 'Collapse'}</span>
      </Button>
    </aside>
  )
}
