import { installNativeMocks } from './nativeMocks'

installNativeMocks()

// The production entry is loaded only after Tauri's official JavaScript mocks
// are installed. No query switches or test globals leak into the application.
await import('../../../src/main.tsx')
