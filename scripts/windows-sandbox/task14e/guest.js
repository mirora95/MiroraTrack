'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const child = require('child_process');
const { chromium } = require('C:\\MTInput\\pw\\index.js');

const evidence = 'C:\\MTEvidence';
const appPid = Number(process.env.MT_APP_PID);
const canary = `MIRORA-SENSITIVE-${crypto.randomBytes(18).toString('hex')}`;
const report = { startedAt: new Date().toISOString(), phases: [], errors: [], pageErrors: [], consoleErrors: [], rejectedRequests: [], canarySha256: sha(canary) };

function sha(value) { return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase(); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function phase(name, details = {}) { report.phases.push({ name, at: new Date().toISOString(), ...details }); }
function atomicJson(name, value) {
  const target = path.join(evidence, name); const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8'); fs.renameSync(temp, target);
}
async function waitFor(fn, message, timeout = 30000) {
  const end = Date.now() + timeout; let last;
  while (Date.now() < end) { try { const result = await fn(); if (result) return result; } catch (error) { last = error; } await new Promise(r => setTimeout(r, 200)); }
  throw new Error(`${message}${last ? `: ${last.message}` : ''}`);
}
async function textIncludes(locator, expected, message) { const value = (await locator.innerText()).replace(/\s+/g, ''); assert(value.includes(expected.replace(/\s+/g, '')), `${message}; actual=${value}`); }
async function visible(locator, message) { await waitFor(() => locator.isVisible(), message); }

async function connect() {
  const browser = await waitFor(async () => {
    try { return await chromium.connectOverCDP('http://127.0.0.1:9222'); } catch { return null; }
  }, 'CDP endpoint did not become available', 45000);
  const context = await waitFor(() => browser.contexts()[0], 'CDP context missing');
  const page = await waitFor(() => context.pages().find(p => !p.url().startsWith('devtools:')), 'MiroraTrack renderer page missing');
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
  page.on('request', request => {
    const url = request.url();
    if (/^https?:/i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url) && !/^http:\/\/ipc\.localhost/i.test(url)) report.rejectedRequests.push(url);
  });
  await page.route(/^https?:\/\//i, route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || url.hostname === 'ipc.localhost') return route.continue();
    report.rejectedRequests.push(route.request().url()); return route.abort('blockedbyclient');
  });
  return { browser, page };
}

async function requestDialog(kind, target, trigger) {
  const id = crypto.randomUUID();
  for (const name of ['dialog-response.json', 'dialog-response.json.tmp']) { try { fs.unlinkSync(path.join(evidence, name)); } catch {} }
  atomicJson('dialog-request.json', { id, kind, target });
  await trigger();
  const response = await waitFor(() => {
    const file = path.join(evidence, 'dialog-response.json');
    if (!fs.existsSync(file)) return null;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value.id === id ? value : null;
  }, `native ${kind} dialog was not automated`, 40000);
  if (response.status !== 'completed') {
    const error = new Error(`NEEDS_USER: native ${kind} dialog automation failed: ${response.error}`);
    error.needsUser = true; throw error;
  }
  return response;
}

async function initialize(page) {
  await visible(page.getByRole('heading', { name: 'Choose your home currency' }), 'onboarding did not open');
  assert(await page.getByLabel('Base currency').inputValue() === 'USD', 'base currency is not USD');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Account name').fill('Everyday');
  await page.getByLabel('Opening balance').fill('1000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create my workspace' }).click();
  await visible(page.getByRole('heading', { name: 'Dashboard' }), 'dashboard did not open');
}

async function addTransaction(page, type, amount, category, notes = '') {
  await page.getByRole('button', { name: 'Quick add transaction' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add transaction' });
  await dialog.getByRole('radio', { name: new RegExp(type, 'i') }).check();
  await dialog.getByLabel('Amount').fill(amount);
  await dialog.getByLabel('Account').selectOption({ index: 1 });
  await dialog.getByLabel('Category').selectOption({ label: category });
  const notesInput = dialog.getByLabel(/note/i);
  if (notes && await notesInput.count()) await notesInput.fill(notes);
  await dialog.getByRole('button', { name: 'Add transaction' }).click();
  await waitFor(() => !dialog.isVisible(), 'transaction dialog did not close');
}

async function verifyExactState(page) {
  await page.getByRole('link', { name: 'Transactions', exact: true }).click();
  const table = page.getByRole('table');
  await textIncludes(table.getByRole('row').filter({ hasText: 'Salary' }), 'Completed+$2,500.00', 'salary row mismatch');
  await textIncludes(table.getByRole('row').filter({ hasText: 'Food' }), 'Completed−$125.50', 'food row mismatch');
  await textIncludes(table.getByRole('row').filter({ hasText: 'Transfer' }), 'Completed$100.00', 'transfer row mismatch');
  await page.getByRole('link', { name: 'Accounts' }).click();
  await textIncludes(page.locator('.account-card').filter({ hasText: 'Everyday' }), '$3,274.50', 'Everyday balance mismatch');
  await textIncludes(page.locator('.account-card').filter({ hasText: 'Savings' }), '$100.00', 'Savings balance mismatch');
  await page.getByRole('link', { name: 'Budgets' }).click();
  const totals = page.getByLabel('Budget totals');
  await textIncludes(totals, 'Planned$500.00', 'budget planned mismatch');
  await textIncludes(totals, 'Spent$125.50', 'budget spent mismatch');
  await textIncludes(totals, 'Remaining$374.50', 'budget remaining mismatch');
  const foodBudget = page.locator('.budget-card').filter({ hasText: 'Food' });
  await textIncludes(foodBudget, '25%used·$374.50left', 'budget percentage/status mismatch');
  await textIncludes(foodBudget, 'Ontrack', 'budget health mismatch');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  const overview = page.getByLabel('Financial overview');
  await textIncludes(overview.locator('.kpi-card').filter({ hasText: 'Net worth' }), '$3,374.50', 'net worth mismatch');
  await textIncludes(overview.locator('.kpi-card').filter({ hasText: 'Income' }), '$2,500.00', 'income mismatch');
  await textIncludes(overview.locator('.kpi-card').filter({ hasText: 'Expenses' }), '$125.50', 'expense mismatch');
  await textIncludes(overview.locator('.kpi-card').filter({ hasText: 'Net flow' }), '$2,374.50', 'net flow mismatch');
  const food = page.getByRole('link', { name: /Food.*view expense transactions/i });
  await visible(food, 'Food drill-down link missing'); await food.click();
  assert(await page.locator('select[aria-label="Category"]').inputValue() === 'food', 'Food drill-down category mismatch');
}

async function main() {
  let browser;
  try {
    ({ browser, page: global.page } = await connect()); const page = global.page;
    phase('cdp-connected', { url: page.url() });
    if (process.env.MT_MODE === 'persistence') {
      await page.reload();
      await verifyExactState(page);
      assert(await page.locator('html').getAttribute('data-theme') === 'dark', 'dark theme was not preserved');
      await page.getByRole('link', { name: 'Settings' }).click();
      assert(await page.getByLabel('Display currency').inputValue() === 'UZS', 'UZS display currency was not preserved');
      await page.screenshot({ path: path.join(evidence, 'persistence-reopen.png'), fullPage: true });
      child.execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command', `(Get-Process -Id ${appPid}).CloseMainWindow() | Out-Null; (Get-Process -Id ${appPid}).WaitForExit(15000)`]);
      await browser.close(); browser = null;
      phase('persistence-reopen', { exactState: true, darkTheme: true, displayCurrency: 'UZS' });
      atomicJson('persistence-result.json', { ...report, status: 'PASS', completedAt: new Date().toISOString() });
      return;
    }
    const externalResult = await page.evaluate(async () => { try { await fetch('https://example.com/', { signal: AbortSignal.timeout(5000) }); return 'resolved'; } catch { return 'rejected'; } });
    assert(externalResult === 'rejected', 'renderer external HTTPS was not rejected');
    await initialize(page);
    const defaultBackup = path.join(process.env.USERPROFILE, 'Documents', 'MiroraTrack', 'Backups');
    const firstBackup = await waitFor(() => fs.existsSync(defaultBackup) && fs.readdirSync(defaultBackup).find(n => /^MiroraTrack-Auto-.*\.json$/i.test(n)), 'default automatic backup was not created', 45000);
    const firstBackupJson = JSON.parse(fs.readFileSync(path.join(defaultBackup, firstBackup), 'utf8'));
    assert(firstBackupJson && firstBackupJson.data, 'default automatic backup is not a valid envelope');
    phase('default-backup', { directory: defaultBackup, file: firstBackup, validJson: true });

    await addTransaction(page, 'income', '2500', 'Salary', canary);
    await addTransaction(page, 'expense', '125.50', 'Food');
    await page.getByRole('link', { name: 'Accounts' }).click();
    await page.getByRole('button', { name: 'Add account' }).click();
    const account = page.getByRole('dialog', { name: 'Add an account' });
    await account.getByLabel('Account name').fill('Savings');
    await account.getByRole('button', { name: 'Create account' }).click();
    await waitFor(() => !account.isVisible(), 'account dialog did not close');
    await page.getByRole('button', { name: 'Quick add transaction' }).click();
    const transfer = page.getByRole('dialog', { name: 'Add transaction' });
    await transfer.getByRole('radio', { name: 'Transfer' }).check();
    await transfer.getByLabel('Amount').fill('100');
    await transfer.getByLabel('From account').selectOption({ label: 'Everyday · USD' });
    await transfer.getByLabel('To account').selectOption({ label: 'Savings · USD' });
    await transfer.getByRole('button', { name: 'Add transaction' }).click();
    await waitFor(() => !transfer.isVisible(), 'transfer dialog did not close');
    await page.getByRole('link', { name: 'Budgets' }).click();
    await page.getByRole('button', { name: 'Create budget' }).first().click();
    const budget = page.getByRole('dialog', { name: 'Create budget' });
    await budget.getByLabel('Category').selectOption({ label: 'Food' });
    await budget.getByLabel('Amount').fill('500');
    await budget.getByRole('button', { name: 'Save budget' }).click();
    await waitFor(() => !budget.isVisible(), 'budget dialog did not close');
    await verifyExactState(page); phase('exact-finance-state');

    child.execFileSync('icacls.exe', [defaultBackup, '/deny', `${process.env.USERNAME}:(OI)(CI)(W,D,DC)`], { stdio: 'pipe' });
    const beforeFailure = await page.getByRole('table').getByRole('row').count();
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Retry now' }).click();
    await visible(page.getByText('Automatic backup needs attention'), 'backup permission failure was not shown');
    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    assert(await page.getByRole('table').getByRole('row').count() === beforeFailure, 'backup failure changed the ledger');
    phase('permission-failure', { ledgerUnchanged: true });

    const alternative = path.join(evidence, 'AlternativeBackups'); fs.mkdirSync(alternative, { recursive: true });
    await page.getByRole('link', { name: 'Settings' }).click();
    await requestDialog('folder', alternative, () => page.getByRole('button', { name: 'Choose folder' }).click());
    await visible(page.getByText('Backup folder updated.'), 'alternative backup folder was not accepted');
    await page.getByRole('button', { name: 'Retry now' }).click();
    await visible(page.getByText('Automatic backups are healthy'), 'alternative backup retry did not recover');
    const alternativeFile = await waitFor(() => fs.readdirSync(alternative).find(n => /^MiroraTrack-Auto-.*\.json$/i.test(n)), 'alternative backup file missing');
    JSON.parse(fs.readFileSync(path.join(alternative, alternativeFile), 'utf8'));
    phase('alternative-backup', { configuredPath: alternative, validJson: true });

    const jsonExport = path.join(evidence, 'MiroraTrack-Export.json');
    await requestDialog('save', jsonExport, () => page.getByRole('button', { name: 'Export JSON' }).click());
    await visible(page.getByText('JSON backup exported.'), 'JSON export status missing');
    const exported = JSON.parse(fs.readFileSync(jsonExport, 'utf8'));
    assert(exported.data.accounts.length === 2 && exported.data.transactions.length === 3 && exported.data.budgets.length === 1, 'JSON export exact counts mismatch');
    const csvExport = path.join(evidence, 'MiroraTrack-Transactions.csv');
    await requestDialog('save', csvExport, () => page.getByRole('button', { name: 'Export all CSV' }).click());
    await visible(page.getByText('Transaction CSV exported.'), 'CSV export status missing');
    const csv = fs.readFileSync(csvExport, 'utf8');
    assert(csv.includes('Salary') && csv.includes('Food') && csv.includes('2500') && csv.includes('125.50'), 'CSV exact rows missing');
    phase('exports-validated', { jsonAccounts: 2, jsonTransactions: 3, jsonBudgets: 1 });

    await page.getByRole('link', { name: 'Transactions', exact: true }).click();
    const foodRow = page.getByRole('table').getByRole('row').filter({ hasText: 'Food' });
    await foodRow.getByRole('button', { name: 'Delete Food' }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete transaction?' });
    await deleteDialog.getByRole('button', { name: 'Delete transaction' }).click();
    await addTransaction(page, 'income', '100', 'Salary');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Restore from JSON' }).click();
    const restore = page.getByRole('dialog', { name: 'Restore a local backup' });
    await requestDialog('open', jsonExport, () => restore.getByRole('button', { name: 'Choose JSON backup' }).click());
    await visible(restore.getByText('Validated backup'), 'restore preview was not validated');
    await restore.getByLabel('Type REPLACE MY DATA to continue').fill('REPLACE MY DATA');
    await restore.getByRole('button', { name: 'Replace local data' }).click();
    await visible(page.getByRole('heading', { name: 'Your local workspace was restored' }), 'restore completion was not shown');
    const safety = fs.readdirSync(alternative).filter(n => /^MiroraTrack-Safety-.*\.json$/i.test(n));
    assert(safety.length >= 1 && !safety.some(n => n.endsWith('.tmp')), 'atomic safety backup missing');
    await page.reload(); await verifyExactState(page); phase('restore-exact', { safetyBackups: safety.length });

    await page.getByLabel('Theme').selectOption('dark');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByLabel('Display currency').selectOption('UZS');
    await page.screenshot({ path: path.join(evidence, 'debug-session.png'), fullPage: true });
    child.execFileSync('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command', `(Get-Process -Id ${appPid}).CloseMainWindow() | Out-Null; (Get-Process -Id ${appPid}).WaitForExit(15000)`]);
    await browser.close(); browser = null;
    phase('clean-close-requested');
    atomicJson('guest-js-result.json', { ...report, status: 'PASS', completedAt: new Date().toISOString() });
  } catch (error) {
    report.errors.push(error.stack || error.message);
    atomicJson('guest-js-result.json', { ...report, status: error.needsUser ? 'NEEDS_USER' : 'FAIL', completedAt: new Date().toISOString() });
    process.exitCode = error.needsUser ? 42 : 1;
  } finally { if (browser) await browser.close().catch(() => {}); }
}

main();
