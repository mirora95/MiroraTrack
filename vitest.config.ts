import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
    // Some suites deliberately wait up to ten seconds for Recharts to finish
    // rendering its accessible table alternatives in jsdom. Vitest's default
    // per-test limit is five seconds, so those waits could never complete and
    // the tests failed under load rather than on any real defect. The limit
    // here must stay above the longest in-test wait; it is only ever consumed
    // when something is genuinely stuck.
    testTimeout: 30_000,
  },
})
