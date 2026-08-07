import { test, expect } from '@playwright/test'
import { blockExternalNetwork, initializeWorkspace } from './support/flows'
import {
  collectRuntimeErrors,
  expectNoRequiredAccessibilityViolations,
  expectNoRuntimeErrors,
} from './support/quality'

test.beforeEach(async ({ page }) => {
  collectRuntimeErrors(page)
  await blockExternalNetwork(page)
})
test.afterEach(async ({ page }, testInfo) => expectNoRuntimeErrors(page, testInfo))

test('passes WCAG A/AA moderate-or-higher gates through onboarding and every ready route', async ({ page }) => {
  await page.goto('')
  await expectNoRequiredAccessibilityViolations(page, 'onboarding currency')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectNoRequiredAccessibilityViolations(page, 'onboarding goals')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectNoRequiredAccessibilityViolations(page, 'onboarding account')
  await page.getByLabel('Account name').fill('Everyday')
  await page.getByLabel('Opening balance').fill('1000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectNoRequiredAccessibilityViolations(page, 'onboarding summary')
  await page.getByRole('button', { name: 'Create my workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  for (const route of ['Dashboard', 'Accounts', 'Transactions', 'Budgets', 'Activity', 'Settings']) {
    await page.getByRole('link', { name: route, exact: true }).click()
    await expect(page.getByRole('heading', { name: route })).toBeVisible()
    await expectNoRequiredAccessibilityViolations(page, `${route} route`)
  }
})

test('passes accessibility gates in transaction, budget, restore, and export states', async ({ page }) => {
  await initializeWorkspace(page)

  await page.getByRole('button', { name: 'Quick add transaction' }).click()
  const transaction = page.getByRole('dialog', { name: 'Add transaction' })
  await expectNoRequiredAccessibilityViolations(page, 'transaction dialog')
  await page.keyboard.press('Escape')
  await expect(transaction).toBeHidden()

  await page.getByRole('link', { name: 'Budgets' }).click()
  await page.getByRole('button', { name: 'Create budget' }).first().click()
  const budget = page.getByRole('dialog', { name: 'Create budget' })
  await expectNoRequiredAccessibilityViolations(page, 'budget dialog')
  await page.keyboard.press('Escape')
  await expect(budget).toBeHidden()

  await page.getByRole('link', { name: 'Settings' }).click()
  await expectNoRequiredAccessibilityViolations(page, 'settings')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  await expect(page.getByRole('status')).toContainText('JSON backup exported')
  await expectNoRequiredAccessibilityViolations(page, 'JSON export status')
  await page.getByRole('button', { name: 'Export all CSV' }).click()
  await expect(page.getByRole('status')).toContainText('CSV exported')
  await expectNoRequiredAccessibilityViolations(page, 'CSV export status')
  await page.getByRole('button', { name: 'Restore from JSON' }).click()
  const restore = page.getByRole('dialog', { name: 'Restore a local backup' })
  await expectNoRequiredAccessibilityViolations(page, 'restore picker dialog')
  await restore.getByRole('button', { name: 'Choose JSON backup' }).click()
  await expect(restore.getByText('Validated backup')).toBeVisible()
  await expectNoRequiredAccessibilityViolations(page, 'restore confirmation dialog')
})

test('supports keyboard dialogs, reduced motion, forced colors, and external-network-free reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
  await initializeWorkspace(page)
  await page.getByRole('button', { name: 'Quick add transaction' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Add transaction' })
  await expect(dialog).toBeVisible()
  for (let index = 0; index < 12; index += 1) await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
})
