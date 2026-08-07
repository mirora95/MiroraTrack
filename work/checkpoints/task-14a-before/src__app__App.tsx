import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppShell } from './AppShell'
import {
  RuntimeProvider,
  type AppRuntime,
} from './runtime'
import {
  createProductionRuntime,
  type RuntimeBootResult,
} from './productionRuntime'
import type { InitializationState } from '../application/initializationService'
import { Button } from '../components/Button'
import { LogoMark } from '../components/LogoMark'
import { AccountsPage } from '../features/accounts/AccountsPage'
import { OnboardingPage } from '../features/onboarding/OnboardingPage'
import { TransactionsPage } from '../features/transactions/TransactionsPage'
import { ActivityPage } from '../features/activity/ActivityPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { BudgetsPage } from '../features/budgets/BudgetsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import type { RestoreCounts } from '../application/ports'
import { scheduleAfterFirstRender } from './startup'

export function AppRouter({ runtime }: { runtime: AppRuntime }) {
  useEffect(() => {
    const automaticBackups = runtime.automaticBackups
    if (!automaticBackups) return
    let started = false
    const cancel = scheduleAfterFirstRender(() => {
      started = true
      automaticBackups.start()
    })
    return () => {
      cancel()
      if (started) automaticBackups.stop()
    }
  }, [runtime])

  return (
    <HashRouter>
      <RuntimeProvider runtime={runtime}>
        <InitializationGate runtime={runtime} />
      </RuntimeProvider>
    </HashRouter>
  )
}

function InitializationGate({ runtime }: { runtime: AppRuntime }) {
  const location = useLocation()
  const [state, setState] = useState<InitializationState | 'loading' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [restoreResult, setRestoreResult] = useState<RestoreCounts>()

  useEffect(() => {
    let active = true
    setState('loading')
    void runtime.initialization.getState().then(
      (next) => { if (active) setState(next) },
      () => { if (active) setState('failed') },
    )
    return () => { active = false }
  }, [attempt, runtime])

  if (state === 'loading') return <StartupLoading />
  if (state === 'failed') {
    return (
      <RecoveryPage
        reason="MiroraTrack could not read the local workspace."
        action={<Button onClick={() => setAttempt((value) => value + 1)}>Try again</Button>}
      />
    )
  }
  if (state.status === 'recovery-required') {
    return <RecoveryPage reason="The local records are incomplete or incompatible. MiroraTrack stopped before making changes." />
  }
  if (state.status === 'uninitialized' && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />
  }
  if (state.status === 'ready' && location.pathname === '/onboarding') {
    return <Navigate to="/" replace />
  }
  if (restoreResult) {
    return <RestoreCompletePage counts={restoreResult} />
  }

  return (
    <Routes>
      <Route
        path="/onboarding"
        element={
          <OnboardingPage
            service={runtime.initialization}
            onInitialized={() => setState({ status: 'ready' })}
          />
        }
      />
      <Route element={<AppShell />}>
        <Route
          path="/accounts"
          element={<AccountsPage service={runtime.accounts} />}
        />
        <Route index element={<DashboardPage service={runtime.dashboard} />} />
        <Route path="/budgets" element={<BudgetsPage service={runtime.budgets} />} />
        <Route path="/transactions" element={<TransactionsPage service={runtime.transactions} accounts={runtime.accounts} />} />
        <Route path="/activity" element={<ActivityPage service={runtime.activity} />} />
        <Route
          path="/settings"
          element={
            <SettingsPage
              settings={runtime.settings}
              dataManagement={runtime.dataManagement}
              {...(runtime.automaticBackups === undefined
                ? {}
                : { automaticBackups: runtime.automaticBackups })}
              onRestoreComplete={setRestoreResult}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

function RestoreCompletePage({ counts }: { counts: RestoreCounts }) {
  return (
    <main className="recovery-page restore-complete">
      <div className="recovery-page__panel" role="status" aria-live="polite">
        <LogoMark className="recovery-page__icon" label="MiroraTrack" />
        <p className="recovery-page__brand">MiroraTrack</p>
        <p className="eyebrow">Restore complete</p>
        <h1>Your local workspace was restored</h1>
        <p>
          Restored {counts.accounts} accounts, {counts.transactions} transactions,
          {' '}and {counts.budgets} budgets.
        </p>
        <p>Restart MiroraTrack before viewing or changing finance records.</p>
        <Button onClick={() => window.location.reload()}>Restart MiroraTrack</Button>
      </div>
    </main>
  )
}

function StartupLoading() {
  return (
    <main className="startup-state" role="status" aria-label="Preparing your private workspace">
      <LogoMark className="startup-state__mark" label="MiroraTrack" />
      <h1>MiroraTrack</h1>
      <p>Preparing your private workspace</p>
    </main>
  )
}

function RecoveryPage({ reason, action }: { reason: string; action?: ReactNode }) {
  return (
    <main className="recovery-page">
      <div className="recovery-page__panel">
        <LogoMark className="recovery-page__icon" label="MiroraTrack" />
        <p className="recovery-page__brand">MiroraTrack</p>
        <p className="eyebrow">Read-only protection</p>
        <h1>Your data needs attention</h1>
        <p>{reason}</p>
        <p>No finance data was deleted or overwritten.</p>
        {action}
      </div>
    </main>
  )
}

function App() {
  const [boot, setBoot] = useState<RuntimeBootResult | 'loading' | 'failed'>('loading')
  const load = useCallback(() => {
    setBoot('loading')
    void createProductionRuntime().then(setBoot, () => setBoot('failed'))
  }, [])

  useEffect(load, [load])

  if (boot === 'loading') return <StartupLoading />
  if (boot === 'failed') {
    return <RecoveryPage reason="MiroraTrack could not open its local database." action={<Button onClick={load}>Try again</Button>} />
  }
  if (boot.status === 'recovery-required') {
    return <RecoveryPage reason={`The local database requires recovery (${boot.reason}).`} />
  }
  return <AppRouter runtime={boot.runtime} />
}

export default App
