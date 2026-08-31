import { AccountService } from '../application/accountService'
import { InitializationService } from '../application/initializationService'
import { FinanceService } from '../application/financeService'
import { TransactionService } from '../application/transactionService'
import { ActivityService } from '../application/activityService'
import { BudgetService } from '../application/budgetService'
import { DashboardService } from '../application/dashboardService'
import { SettingsService } from '../application/settingsService'
import { DataManagementService } from '../application/dataManagementService'
import { RestoreService } from '../backup/restoreService'
import { DexieAccountReadRepository } from '../database/accountReadRepository'
import { DexieAccountUnitOfWork } from '../database/accountUnitOfWork'
import { openMiroraTrackDatabase } from '../database/db'
import { DexieFinanceUnitOfWork } from '../database/unitOfWork'
import {
  DexieActivityReadRepository,
  DexieTransactionReadRepository,
} from '../database/transactionReadRepository'
import {
  AutomaticBackupService,
  TauriBackupPort,
} from '../platform/backupPort'
import { DexieBudgetReadRepository } from '../database/budgetReadRepository'
import { DexieBudgetUnitOfWork } from '../database/budgetUnitOfWork'
import { DexieDashboardReadRepository } from '../database/dashboardReadRepository'
import { DexieSettingsRepository } from '../database/settingsUnitOfWork'
import { DexieBackupRepository } from '../database/backupRepository'
import {
  AUTOMATIC_BACKUP_METADATA_ID,
  type BackupMetadata,
} from '../finance/types'
import {
  AutomaticBackupCoordinator,
  type BackupActivationSource,
} from '../backup/automaticBackup'
import { prepareDatabaseForStartup } from './startup'
import type {
  AppRuntime,
  AutomaticBackupsApplication,
} from './runtime'

export type { AutomaticBackupsApplication } from './runtime'

export type RuntimeBootResult =
  | { readonly status: 'ready'; readonly runtime: AppRuntime }
  | { readonly status: 'recovery-required'; readonly reason: string }

let productionRuntimePromise: Promise<RuntimeBootResult> | undefined

export function createProductionRuntime(): Promise<RuntimeBootResult> {
  if (!productionRuntimePromise) {
    const attempt = buildProductionRuntime()
    productionRuntimePromise = attempt
    void attempt.catch(() => {
      if (productionRuntimePromise === attempt) {
        productionRuntimePromise = undefined
      }
    })
  }
  return productionRuntimePromise
}

async function buildProductionRuntime(): Promise<RuntimeBootResult> {
  const opened = await openMiroraTrackDatabase()
  if (opened.status !== 'ready') {
    return { status: 'recovery-required', reason: opened.reason }
  }
  const prepared = await prepareDatabaseForStartup(opened.db)
  if (prepared.status !== 'ready') {
    opened.db.close()
    return { status: 'recovery-required', reason: prepared.reason }
  }
  const reads = new DexieAccountReadRepository(opened.db)
  const uow = new DexieAccountUnitOfWork(opened.db)
  const transactionReads = new DexieTransactionReadRepository(opened.db)
  const nativeBackups = new TauriBackupPort()
  const finance = new FinanceService({
    reads: {
      getAccount: (id) => opened.db.accounts.get(id),
      getTransaction: (id) => opened.db.transactions.get(id),
    },
    uow: new DexieFinanceUnitOfWork(opened.db),
  })
  const transactionQueries = new TransactionService(transactionReads, nativeBackups)
  const budgets = new BudgetService({
    reads: new DexieBudgetReadRepository(opened.db),
    uow: new DexieBudgetUnitOfWork(opened.db),
  })
  const dashboard = new DashboardService(new DexieDashboardReadRepository(opened.db))
  const settingsRepository = new DexieSettingsRepository(opened.db)
  const settings = new SettingsService({
    reads: settingsRepository,
    uow: settingsRepository,
  })
  const databaseBackups = new DexieBackupRepository(opened.db)
  const backupMetadataStore = {
    get: (id: typeof AUTOMATIC_BACKUP_METADATA_ID) =>
      opened.db.backupMetadata.get(id),
    put: async (value: BackupMetadata) => {
      await opened.db.backupMetadata.put(value)
    },
  }
  const dataManagementService = new DataManagementService({
    database: databaseBackups,
    backups: nativeBackups,
    restore: new RestoreService(databaseBackups, nativeBackups),
    transactions: transactionReads,
    settings,
  })
  const activation = browserActivationSource()
  const automaticBackups = new AutomaticBackupCoordinator({
    settings,
    metadata: backupMetadataStore,
    database: databaseBackups,
    backup: new AutomaticBackupService(nativeBackups, backupMetadataStore),
    ...(activation === undefined ? {} : { activation }),
  })
  const runtime: AppRuntime = {
    initialization: new InitializationService({ reads, uow }),
    accounts: new AccountService({ reads, uow }),
    transactions: {
      list: (filters) => transactionQueries.list(filters),
      exportFiltered: (filters) => transactionQueries.exportFiltered(filters),
      create: (command) => finance.create(command),
      edit: (id, command) => finance.edit(id, command),
      delete: (id) => finance.delete(id),
    },
    activity: new ActivityService(new DexieActivityReadRepository(opened.db)),
    budgets,
    dashboard,
    settings,
    dataManagement: {
      getBackupStatus: () =>
        opened.db.backupMetadata.get(AUTOMATIC_BACKUP_METADATA_ID),
      chooseBackupFolder: () => dataManagementService.chooseBackupFolder(),
      resetBackupFolder: () => dataManagementService.resetBackupFolder(),
      exportJson: () => dataManagementService.exportJson(),
      exportCsv: () => dataManagementService.exportCsv(),
      selectImport: () => dataManagementService.selectImport(),
      restore: (candidateId, confirmation) =>
        dataManagementService.restore(candidateId, confirmation),
      invalidateRestoreCandidate: () =>
        dataManagementService.invalidateRestoreCandidate(),
    },
  }
  return {
    status: 'ready',
    runtime: decorateRuntimeWithAutomaticBackups(runtime, automaticBackups),
  }
}

export function decorateRuntimeWithAutomaticBackups(
  runtime: AppRuntime,
  automaticBackups: AutomaticBackupsApplication,
): AppRuntime {
  const changed = async <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const result = await operation()
    automaticBackups.notifyStructuredDataChanged()
    return result
  }
  return {
    initialization: {
      getState: () => runtime.initialization.getState(),
      initialize: (command) => changed(() => runtime.initialization.initialize(command)),
    },
    accounts: {
      list: () => runtime.accounts.list(),
      create: (command) => changed(() => runtime.accounts.create(command)),
      update: (command) => changed(() => runtime.accounts.update(command)),
      archive: (id) => changed(() => runtime.accounts.archive(id)),
      reactivate: (id) => changed(() => runtime.accounts.reactivate(id)),
    },
    transactions: {
      list: (filters) => runtime.transactions.list(filters),
      exportFiltered: (filters) => runtime.transactions.exportFiltered(filters),
      create: (command) => changed(() => runtime.transactions.create(command)),
      edit: (id, command) =>
        changed(() => runtime.transactions.edit(id, command)),
      delete: (id) => changed(() => runtime.transactions.delete(id)),
    },
    activity: runtime.activity,
    budgets: {
      list: (query) => runtime.budgets.list(query),
      ...(runtime.budgets.listCategoryIds
        ? { listCategoryIds: () => runtime.budgets.listCategoryIds!() }
        : {}),
      availableCurrencies: () => runtime.budgets.availableCurrencies(),
      create: (draft) => changed(() => runtime.budgets.create(draft)),
      update: (id, draft) =>
        changed(() => runtime.budgets.update(id, draft)),
      archive: (id) => changed(() => runtime.budgets.archive(id)),
      reactivate: (id) => changed(() => runtime.budgets.reactivate(id)),
      delete: (id) => changed(() => runtime.budgets.delete(id)),
    },
    dashboard: runtime.dashboard,
    settings: {
      get: () => runtime.settings.get(),
      update: (candidate, options) =>
        changed(() => runtime.settings.update(candidate, options)),
    },
    dataManagement: {
      ...runtime.dataManagement,
      chooseBackupFolder: async () => {
        const result = await runtime.dataManagement.chooseBackupFolder()
        if (result.status === 'success') {
          automaticBackups.notifyStructuredDataChanged()
        }
        return result
      },
      resetBackupFolder: () =>
        changed(() => runtime.dataManagement.resetBackupFolder()),
      restore: async (candidateId, confirmation) => {
        await automaticBackups.pause()
        try {
          const result = await runtime.dataManagement.restore(
            candidateId,
            confirmation,
          )
          automaticBackups.stop()
          return result
        } catch (error) {
          automaticBackups.resume()
          throw error
        }
      },
      retryAutomaticBackup: () => automaticBackups.retryNow(),
    },
    automaticBackups,
  }
}

function browserActivationSource(): BackupActivationSource | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined
  }
  return {
    subscribe(listener) {
      const onVisible = () => {
        if (document.visibilityState === 'visible') listener()
      }
      window.addEventListener('focus', listener)
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        window.removeEventListener('focus', listener)
        document.removeEventListener('visibilitychange', onVisible)
      }
    },
  }
}
