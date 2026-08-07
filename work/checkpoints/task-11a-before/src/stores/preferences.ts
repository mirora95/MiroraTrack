import { useEffect } from 'react'
import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'
type ResolvedTheme = Exclude<ThemePreference, 'system'>

interface PreferencesState {
  theme: ThemePreference
  sidebarCollapsed: boolean
  setTheme: (theme: ThemePreference) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
}

interface PersistedPreferences {
  theme: ThemePreference
  sidebarCollapsed: boolean
}

export const PREFERENCES_STORAGE_KEY = 'miroratrack.preferences.v1'
const themeValues: ThemePreference[] = ['light', 'dark', 'system']

function safeReadPreferences(): PersistedPreferences {
  try {
    const value = window.localStorage.getItem(PREFERENCES_STORAGE_KEY)
    if (!value) return { theme: 'system', sidebarCollapsed: false }
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid preferences')
    const candidate = parsed as Partial<PersistedPreferences>
    return {
      theme: themeValues.includes(candidate.theme as ThemePreference)
        ? (candidate.theme as ThemePreference)
        : 'system',
      sidebarCollapsed:
        typeof candidate.sidebarCollapsed === 'boolean'
          ? candidate.sidebarCollapsed
          : false,
    }
  } catch {
    return { theme: 'system', sidebarCollapsed: false }
  }
}

function safeWritePreferences(preferences: PersistedPreferences): void {
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Preferences remain usable in memory when storage is unavailable.
  }
}

function resolvedTheme(theme: ThemePreference): ResolvedTheme {
  if (theme !== 'system') return theme
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(theme: ThemePreference): void {
  const resolved = resolvedTheme(theme)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

const initialPreferences = safeReadPreferences()

export const usePreferences = create<PreferencesState>((set, get) => ({
  ...initialPreferences,
  setTheme: (theme) => {
    set({ theme })
    applyTheme(theme)
    safeWritePreferences({
      theme,
      sidebarCollapsed: get().sidebarCollapsed,
    })
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed })
    safeWritePreferences({ theme: get().theme, sidebarCollapsed })
  },
  toggleSidebar: () => {
    const sidebarCollapsed = !get().sidebarCollapsed
    set({ sidebarCollapsed })
    safeWritePreferences({ theme: get().theme, sidebarCollapsed })
  },
}))

export function hydratePreferences(): void {
  const preferences = safeReadPreferences()
  usePreferences.setState(preferences)
  applyTheme(preferences.theme)
}

applyTheme(initialPreferences.theme)

export function useThemePreference(): void {
  const theme = usePreferences((state) => state.theme)

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return

    try {
      const media = window.matchMedia?.('(prefers-color-scheme: dark)')
      const update = () => applyTheme('system')
      media?.addEventListener?.('change', update)
      return () => media?.removeEventListener?.('change', update)
    } catch {
      return
    }
  }, [theme])
}
