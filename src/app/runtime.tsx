import { createContext, useContext, type ReactNode } from 'react'
import type {
  AccountListItem,
  UpdateAccountCommand,
} from '../application/accountService'
import type { AccountDraft } from '../application/accountRecords'
import type {
  InitializeCommand,
  InitializationState,
} from '../application/initializationService'
import type { Account } from '../finance/types'
import type {
  TransactionFilters,
  TransactionPage,
} from '../application/transactionService'
import type { TransactionDraft } from '../application/financeService'
import type {
  ActivityFilters,
  ActivityPage,
} from '../application/activityService'
import type { BackupResult } from '../application/ports'
import type { Transaction } from '../finance/types'
import type {
  BudgetDraft,
  BudgetListQuery,
  BudgetListResult,
} from '../application/budgetService'
import type {
  DashboardPayload,
  DashboardQuery,
} from '../application/dashboardService'
import type { Budget } from '../finance/types'
import type { BackupMetadata, Settings } from '../finance/types'
import type {
  DataFileResult,
  RestorePreview,
} from '../application/dataManagementService'
import type { RestoreCounts } from '../application/ports'
import type { SettingsUpdateOptions } from '../application/settingsService'
import type {
  AutomaticBackupOutcome,
  AutomaticBackupStatus,
} from '../backup/automaticBackup'

export interface InitializationApplication {
  getState(): Promise<InitializationState>
  initialize(command: InitializeCommand): Promise<void>
}

export interface AccountsApplication {
  list(): Promise<readonly AccountListItem[]>
  create(command: AccountDraft): Promise<Account>
  update(command: UpdateAccountCommand): Promise<Account>
  archive(id: string): Promise<void>
  reactivate(id: string): Promise<void>
}

export interface TransactionsApplication {
  list(filters: TransactionFilters): Promise<TransactionPage>
  exportFiltered(filters: TransactionFilters): Promise<BackupResult | null>
  create(command: TransactionDraft): Promise<Transaction>
  edit(id: string, command: TransactionDraft): Promise<Transaction>
  delete(id: string): Promise<void>
}

export interface ActivityApplication {
  list(filters: ActivityFilters): Promise<ActivityPage>
}

export interface BudgetsApplication {
  list(query: BudgetListQuery): Promise<BudgetListResult>
  listCategoryIds?(): Promise<readonly string[]>
  availableCurrencies(): Promise<readonly Budget['currency'][]>
  create(draft: BudgetDraft): Promise<Budget>
  update(id: string, draft: BudgetDraft): Promise<Budget>
  archive(id: string): Promise<void>
  reactivate(id: string): Promise<void>
  delete(id: string): Promise<void>
}

export interface DashboardApplication {
  load(query: DashboardQuery): Promise<DashboardPayload>
}

export interface SettingsApplication {
  get(): Promise<Settings>
  update(candidate: Settings, options?: SettingsUpdateOptions): Promise<Settings>
}

export interface DataManagementApplication {
  getBackupStatus(): Promise<BackupMetadata | undefined>
  chooseBackupFolder(): Promise<
    | { readonly status: 'cancelled' }
    | { readonly status: 'success'; readonly folderPath: string }
    | { readonly status: 'failed'; readonly errorCode: string; readonly message: string }
  >
  resetBackupFolder(): Promise<void>
  exportJson(): Promise<DataFileResult>
  exportCsv(): Promise<DataFileResult>
  selectImport(): Promise<RestorePreview | null>
  restore(candidateId: string, confirmation: string): Promise<{
    readonly reloadRequired: true
    readonly counts: RestoreCounts
  }>
  invalidateRestoreCandidate(): void
  retryAutomaticBackup?(): Promise<AutomaticBackupOutcome>
}

export interface AutomaticBackupsApplication {
  start(): void
  stop(): void
  pause(): Promise<void>
  resume(): void
  notifyStructuredDataChanged(): void
  retryNow(): Promise<AutomaticBackupOutcome>
  status(): AutomaticBackupStatus
  subscribe(listener: (status: AutomaticBackupStatus) => void): () => void
}

export interface AppRuntime {
  readonly initialization: InitializationApplication
  readonly accounts: AccountsApplication
  readonly transactions: TransactionsApplication
  readonly activity: ActivityApplication
  readonly budgets: BudgetsApplication
  readonly dashboard: DashboardApplication
  readonly settings: SettingsApplication
  readonly dataManagement: DataManagementApplication
  readonly automaticBackups?: AutomaticBackupsApplication
}

const RuntimeContext = createContext<AppRuntime | null>(null)

export function RuntimeProvider({
  runtime,
  children,
}: {
  runtime: AppRuntime
  children: ReactNode
}) {
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  )
}

export function useRuntime(): AppRuntime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('MiroraTrack runtime is unavailable')
  return runtime
}
