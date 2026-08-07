# Task 14B Before-Gate Manifest

Captured 2026-08-03 after the required Windows restart and before dependency installation or verification. No repository-scoped Vite/dev-preview process was running.

## Reboot and tool state

- Windows last boot: `2026-08-03 08:59:44 +05:00`
- Windows version/build: `10.0.26200` / `26200`
- Node.js: `v24.14.1`
- npm: `11.13.0`
- Tauri CLI: `2.11.4`
- Cargo: `1.97.1 (c980f4866 2026-06-30)`
- rustc: `1.97.1 (8bab26f4f6 2026-07-14)`
- rustfmt: `1.9.0-stable (8bab26f4f6 2026-07-14)`
- Clippy: `0.1.97 (8bab26f4f6 2026-07-14)`

## Protected manifest hashes

| Path | Bytes | SHA-256 |
| --- | ---: | --- |
| `package.json` | 1,744 | `863BE12B24F1A7AB086C79CAFD0E1E44921608521102818BED900BF6BE2BAFAF` |
| `package-lock.json` | 120,664 | `50C7258A8456103A5955847E29B665ADEAF449F208F7523AD418F78FEC34ABB9` |
| `src-tauri/Cargo.toml` | 789 | `AF32C75A4603114D85391F06B383C8FC7548EAD5677D2E8A8DFF367A94D91D26` |
| `src-tauri/Cargo.lock` | 111,243 | `1B121E655446320FE7FBDF3D1908B317B1BA2A3A37C1B457DDF9268FF0EE12E7` |
| `src-tauri/tauri.conf.json` | 1,661 | `C66500792D4050FDB59DFFE4225798CF9ADEE44AB94D643F7505078EEE15C58E` |

## Pending file rename queue before gate

The registry value was observed read-only and was not altered. It contains three delete pairs, all under Microsoft Edge temporary storage:

```text
[0] *1\??\C:\Program Files (x86)\Microsoft\Edge\Temp\20396_455905472\old_msedge.exe
[1] <empty destination>
[2] *1\??\C:\Program Files (x86)\Microsoft\Edge\Temp\20396_455905472
[3] <empty destination>
[4] *1\??\C:\Program Files (x86)\Microsoft\Edge\Temp
[5] <empty destination>
```

No `node_modules` backup was created. Git metadata was not accessed or changed.
