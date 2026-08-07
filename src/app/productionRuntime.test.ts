import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openMiroraTrackDatabase } from '../database/db'
import { createProductionRuntime } from './productionRuntime'
import { prepareDatabaseForStartup } from './startup'

vi.mock('../database/db', () => ({
  openMiroraTrackDatabase: vi.fn(),
}))
vi.mock('./startup', async (importOriginal) => {
  const original = await importOriginal<typeof import('./startup')>()
  return {
    ...original,
    prepareDatabaseForStartup: vi.fn().mockResolvedValue({ status: 'ready' }),
  }
})

describe('production runtime boot cache', () => {
  beforeEach(() => {
    vi.mocked(openMiroraTrackDatabase).mockReset()
    vi.mocked(prepareDatabaseForStartup).mockReset()
      .mockResolvedValue({ status: 'ready' })
  })

  it('shares an in-flight boot but retries after a transient rejection', async () => {
    let rejectFirst!: (reason: Error) => void
    const first = new Promise<never>((_, reject) => { rejectFirst = reject })
    const database = {} as never
    vi.mocked(openMiroraTrackDatabase)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ status: 'ready', db: database })

    const attempt = createProductionRuntime()
    expect(createProductionRuntime()).toBe(attempt)
    const rejected = expect(attempt).rejects.toThrow('transient IndexedDB failure')
    rejectFirst(new Error('transient IndexedDB failure'))
    await rejected

    const recovered = await createProductionRuntime()
    expect(recovered.status).toBe('ready')
    if (recovered.status === 'ready') {
      expect(recovered.runtime.transactions).toEqual(expect.objectContaining({
        list: expect.any(Function),
        create: expect.any(Function),
        edit: expect.any(Function),
        delete: expect.any(Function),
        exportFiltered: expect.any(Function),
      }))
      expect(recovered.runtime.activity.list).toEqual(expect.any(Function))
      expect(recovered.runtime.budgets).toEqual(expect.objectContaining({
        list: expect.any(Function),
        availableCurrencies: expect.any(Function),
        create: expect.any(Function),
        update: expect.any(Function),
        archive: expect.any(Function),
        reactivate: expect.any(Function),
        delete: expect.any(Function),
      }))
      expect(recovered.runtime.dashboard.load).toEqual(expect.any(Function))
      expect(recovered.runtime.settings).toEqual(expect.objectContaining({
        get: expect.any(Function),
        update: expect.any(Function),
      }))
      expect(recovered.runtime.dataManagement).toEqual(expect.objectContaining({
        getBackupStatus: expect.any(Function),
        chooseBackupFolder: expect.any(Function),
        resetBackupFolder: expect.any(Function),
        exportJson: expect.any(Function),
        exportCsv: expect.any(Function),
        selectImport: expect.any(Function),
        restore: expect.any(Function),
        invalidateRestoreCandidate: expect.any(Function),
        retryAutomaticBackup: expect.any(Function),
      }))
      expect(recovered.runtime.automaticBackups).toEqual(expect.objectContaining({
        start: expect.any(Function),
        stop: expect.any(Function),
        retryNow: expect.any(Function),
        status: expect.any(Function),
        subscribe: expect.any(Function),
      }))
    }
    await expect(createProductionRuntime()).resolves.toBe(recovered)
    expect(openMiroraTrackDatabase).toHaveBeenCalledTimes(2)
    expect(prepareDatabaseForStartup).toHaveBeenCalledTimes(1)
  })
})
