import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { ArrowUpRight, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'

const pages = [
  {
    path: '/',
    title: 'Dashboard',
    eyebrow: 'Your financial command center',
    description: 'A clear view of everything you own, spend, and save.',
  },
  {
    path: '/transactions',
    title: 'Transactions',
    eyebrow: 'Money in motion',
    description: 'Track income, expenses, and transfers in one private ledger.',
  },
  {
    path: '/accounts',
    title: 'Accounts',
    eyebrow: 'Your financial foundation',
    description: 'Keep every account organized without sending data to the cloud.',
  },
  {
    path: '/budgets',
    title: 'Budgets',
    eyebrow: 'Spend with intention',
    description: 'Build flexible monthly plans that make progress feel tangible.',
  },
  {
    path: '/activity',
    title: 'Activity',
    eyebrow: 'A transparent record',
    description: 'Review important changes made across your private workspace.',
  },
  {
    path: '/settings',
    title: 'Settings',
    eyebrow: 'Make MiroraTrack yours',
    description: 'Choose how your local desktop experience looks and behaves.',
  },
] as const

function RoutePlaceholder({
  title,
  eyebrow,
  description,
}: (typeof pages)[number]) {
  return (
    <div className="placeholder-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1 id="page-title">{title}</h1>
          <p className="page-hero__description">{description}</p>
        </div>
        <div className="page-hero__trust">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Offline and private by design</span>
        </div>
      </section>

      <div className="placeholder-grid" aria-label={`${title} preview`}>
        <Card className="placeholder-card placeholder-card--featured">
          <span className="placeholder-card__icon">
            <Sparkles size={20} aria-hidden="true" />
          </span>
          <p className="eyebrow">Coming next</p>
          <h2>Your private financial workspace is taking shape.</h2>
          <p>
            The complete {title.toLowerCase()} workflow will arrive in the next
            focused build step, ready for your local data.
          </p>
          <Button variant="secondary" icon={<ArrowUpRight size={18} aria-hidden="true" />}>
            Explore the workspace
          </Button>
        </Card>
        <Card className="placeholder-card placeholder-card--empty">
          <EmptyState
            title={`No ${title.toLowerCase()} yet`}
            description="Your information will appear here once you add it. Nothing leaves this computer."
            action={<Button variant="ghost">Learn how it works</Button>}
          />
        </Card>
      </div>
    </div>
  )
}

function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          {pages.map((page) => (
            <Route
              key={page.path}
              index={page.path === '/'}
              path={page.path === '/' ? undefined : page.path}
              element={<RoutePlaceholder {...page} />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

export default App
