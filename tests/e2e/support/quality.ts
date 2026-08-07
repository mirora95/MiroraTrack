import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'

type RuntimeErrors = {
  readonly console: string[]
  readonly page: string[]
}

const errorsByPage = new WeakMap<Page, RuntimeErrors>()

export function collectRuntimeErrors(page: Page): void {
  const errors: RuntimeErrors = { console: [], page: [] }
  errorsByPage.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error' && !isDocumentedHarmlessConsoleError(message.text())) {
      errors.console.push(message.text())
    }
  })
  page.on('pageerror', (error) => errors.page.push(error.message))
}

export function expectNoRuntimeErrors(page: Page, testInfo: TestInfo): void {
  const errors = errorsByPage.get(page)
  expect(errors, 'runtime error collector must be installed for every E2E test').toBeDefined()
  expect(errors?.page, `${testInfo.title}: uncaught page errors`).toEqual([])
  expect(errors?.console, `${testInfo.title}: console errors`).toEqual([])
}

export async function expectNoRequiredAccessibilityViolations(
  page: Page,
  context: string,
): Promise<void> {
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => {
      const iterations = animation.effect?.getTiming().iterations
      return iterations !== Infinity && animation.playState === 'running'
    })
    await Promise.allSettled(animations.map((animation) => animation.finished))
  })
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const required = result.violations.filter(({ impact }) =>
    impact === 'moderate' || impact === 'serious' || impact === 'critical')
  expect(required, `${context}: WCAG A/AA violations with moderate-or-higher impact`).toEqual([])
}

function isDocumentedHarmlessConsoleError(_message: string): boolean {
  // Intentionally empty. Add only exact, reviewed browser messages here and
  // document why they are harmless. Application errors must never be ignored.
  return false
}
