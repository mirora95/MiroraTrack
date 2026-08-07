import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App.tsx'
import { ErrorBoundary } from './app/ErrorBoundary.tsx'
import {
  restoreWindowPreferences,
  TauriWindowStatePort,
} from './platform/windowPort.ts'
import { readPreferences } from './stores/preferences.ts'

void restoreWindowPreferences(
  new TauriWindowStatePort(),
  readPreferences().window,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
