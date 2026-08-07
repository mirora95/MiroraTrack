import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('React feature architecture', () => {
  it('keeps IndexedDB, Dexie, Tauri, and native platform adapters outside React features', () => {
    const root = resolve('src/features')
    const files = walk(root).filter((file) => /\.(ts|tsx)$/.test(file))
    const banned = [
      /from\s+['"][^'"]*database\//,
      /from\s+['"]dexie['"]/,
      /from\s+['"]@tauri-apps\//,
      /from\s+['"][^'"]*platform\//,
      /\bindexedDB\b/,
    ]
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of banned) {
        expect(source, `${file} must use runtime interfaces`).not.toMatch(pattern)
      }
    }
  })

  it('preserves visible keyboard focus and accessible mobile table headers', () => {
    const css = readFileSync(resolve('src/styles/index.css'), 'utf8')
    expect(css).toMatch(/transaction-type-tabs\s+label:has\(input:focus-visible\)/)
    expect(css).toMatch(/filter-search:focus-within/)
    const mobile = css.slice(css.indexOf('@media (max-width: 700px)'))
    expect(mobile).not.toMatch(/transaction-table\s+thead\s*\{\s*display:\s*none/)
    expect(mobile).toMatch(/transaction-table\s+thead[\s\S]*clip:/)
  })

  it('loads feature pages through lazy route boundaries', () => {
    const source = readFileSync(resolve('src/app/App.tsx'), 'utf8')
    const featurePages = [
      'AccountsPage',
      'ActivityPage',
      'BudgetsPage',
      'DashboardPage',
      'OnboardingPage',
      'SettingsPage',
      'TransactionsPage',
    ]

    for (const page of featurePages) {
      expect(source).toMatch(new RegExp(`const ${page} = lazy\\(\\(\\) => import\\(`))
      expect(source).not.toMatch(new RegExp(`import\\s+\\{\\s*${page}\\s*\\}`))
    }
    expect(source).toMatch(/<Suspense\s+fallback=\{<RouteLoading\s*\/?>\}>/)
  })

  it('supports reduced motion and Windows forced colors', () => {
    const css = readFileSync(resolve('src/styles/index.css'), 'utf8')
    const reducedMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    const forcedColors = css.slice(css.indexOf('@media (forced-colors: active)'))

    expect(reducedMotion).toMatch(/animation:\s*none\s*!important/)
    expect(reducedMotion).toMatch(/transition:\s*none\s*!important/)
    expect(forcedColors).toMatch(/forced-color-adjust:\s*auto/)
    expect(forcedColors).toMatch(/outline-color:\s*CanvasText/)
    expect(forcedColors).toMatch(/border-color:\s*ButtonText/)
  })

  it('caps production chunks without making lazy chart dependencies initial', () => {
    const config = readFileSync(resolve('vite.config.ts'), 'utf8')

    expect(config).toMatch(/chunkSizeWarningLimit:\s*450/)
    expect(config).toMatch(/maxSize:\s*300\s*\*\s*1024/)
    expect(config).toMatch(/tags:\s*\['\$initial'\]/)
    expect(config).not.toMatch(/recharts/)
  })
})

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}
