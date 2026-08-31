/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const packageJson = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8'),
) as {
  version: string
  description?: string
  repository?: string
  scripts: Record<string, string>
  dependencies: Record<string, string>
}
const packageLock = JSON.parse(
  readFileSync(resolve('package-lock.json'), 'utf8'),
) as { version: string; packages: { '': { version: string } } }
const tauriConfig = JSON.parse(
  readFileSync(resolve('src-tauri/tauri.conf.json'), 'utf8'),
) as {
  version: string
  identifier: string
  app: { security: { csp: string } }
  bundle: {
    targets: string[]
    category: string
    shortDescription: string
    longDescription: string
    windows: {
      allowDowngrades: boolean
      webviewInstallMode: { type: string }
      nsis: {
        installMode: string
        installerIcon: string
        uninstallerIcon: string
      }
    }
  }
}
const cargoToml = readFileSync(resolve('src-tauri/Cargo.toml'), 'utf8')

describe('desktop packaging configuration', () => {
  it('keeps the product identity and release version synchronized', () => {
    expect(packageJson.version).toBe('0.3.1')
    expect(packageLock.version).toBe('0.3.1')
    expect(packageLock.packages[''].version).toBe('0.3.1')
    expect(tauriConfig.version).toBe('0.3.1')
    expect(cargoToml).toMatch(/^\s*version\s*=\s*"0\.3\.1"\s*$/m)
    expect(tauriConfig.identifier).toBe('com.miroratrack.desktop')
    expect(tauriConfig.bundle.category).toBe('Finance')
    expect(packageJson.description).toMatch(/local-first personal finance/i)
    expect(packageJson.repository).toBe('https://github.com/mirora95/MiroraTrack.git')
  })

  it('builds a current-user NSIS installer with offline WebView2 and approved icons', () => {
    expect(tauriConfig.bundle.targets).toEqual(['nsis'])
    expect(tauriConfig.bundle.windows.allowDowngrades).toBe(false)
    expect(tauriConfig.bundle.windows.webviewInstallMode.type).toBe('offlineInstaller')
    expect(tauriConfig.bundle.windows.nsis).toMatchObject({
      installMode: 'currentUser',
      installerIcon: 'icons/icon.ico',
      uninstallerIcon: 'icons/icon.ico',
    })
  })

  it('uses a restrictive production CSP without wildcard sources', () => {
    const csp = tauriConfig.app.security.csp
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain('connect-src ipc: http://ipc.localhost')
    expect(csp).toContain("img-src 'self' data: blob:")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("font-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).not.toContain('*')
  })

  it('provides explicit locked desktop checks and architecture build scripts', () => {
    expect(packageJson.scripts).toMatchObject({
      'desktop:check': 'cargo check --locked --manifest-path src-tauri/Cargo.toml',
      'desktop:test': 'cargo test --locked --manifest-path src-tauri/Cargo.toml',
      'desktop:build:x64': 'tauri build --target x86_64-pc-windows-msvc --bundles nsis --ci',
      'desktop:build:arm64': 'tauri build --target aarch64-pc-windows-msvc --bundles nsis --ci',
    })
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-fs')
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-os')
    expect(packageJson.dependencies).not.toHaveProperty('@tauri-apps/plugin-dialog')
  })
})
