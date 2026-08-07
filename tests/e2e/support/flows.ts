import { expect, type Page } from '@playwright/test'

export async function blockExternalNetwork(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:' ||
      url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      await route.continue()
      return
    }
    await route.abort('blockedbyclient')
  })
}

export async function initializeWorkspace(page: Page): Promise<void> {
  await page.goto('', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { name: 'Choose your home currency' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Account name').fill('Everyday')
  await page.getByLabel('Opening balance').fill('1000')
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByRole('button', { name: 'Create my workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

export async function addTransaction(
  page: Page,
  type: 'income' | 'expense',
  amount: string,
  category: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Quick add transaction' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add transaction' })
  await dialog.getByRole('radio', { name: new RegExp(type, 'i') }).check()
  await dialog.getByLabel('Amount').fill(amount)
  await dialog.getByLabel('Account').selectOption({ index: 1 })
  await dialog.getByLabel('Category').selectOption({ label: category })
  await dialog.getByRole('button', { name: 'Add transaction' }).click()
  await expect(dialog).toBeHidden()
}
