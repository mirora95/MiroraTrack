import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'

const JSON_KEY = 'miroratrack.e2e.exported-json'
const CSV_KEY = 'miroratrack.e2e.exported-csv'
const FOLDER_MODE_KEY = 'miroratrack.e2e.folder-mode'
const ALTERNATIVE_FOLDER = 'D:\\MiroraTrack\\Backups'

export function installNativeMocks(): void {
  mockWindows('main')
  mockIPC((command, args) => {
    switch (command) {
      case 'create_backup':
        return nativeFile('MiroraTrack-auto.json', configuredDirectory(args))
      case 'choose_backup_directory':
        if (localStorage.getItem(FOLDER_MODE_KEY) === 'deny') {
          localStorage.removeItem(FOLDER_MODE_KEY)
          throw { code: 'PERMISSION_DENIED', message: 'Folder permission was denied' }
        }
        return ALTERNATIVE_FOLDER
      case 'export_json': {
        const payload = String(args?.payload ?? '')
        localStorage.setItem(JSON_KEY, payload)
        return nativeFile('MiroraTrack-backup.json')
      }
      case 'export_csv':
        localStorage.setItem(CSV_KEY, String(args?.csv ?? ''))
        return nativeFile('MiroraTrack-transactions.csv')
      case 'import_json': {
        const content = localStorage.getItem(JSON_KEY)
        return content === null ? null : { content }
      }
      default:
        // Official window mocks route their native window commands here. The
        // browser harness deliberately provides no finance or database mock.
        if (command.startsWith('plugin:window|')) return undefined
        throw new Error(`Unexpected native IPC command: ${command}`)
    }
  })
}

function nativeFile(name: string, directory = 'C:\\Users\\BrowserHarness\\Documents\\MiroraTrack\\Backups') {
  return { path: `${directory}\\${name}`, directory }
}

function configuredDirectory(args: Record<string, unknown> | undefined): string {
  const directory = args?.directory
  return typeof directory === 'string' && directory.length > 0
    ? directory
    : 'C:\\Users\\BrowserHarness\\Documents\\MiroraTrack\\Backups'
}
