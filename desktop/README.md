# CrewSignal — Windows Desktop App (`source/desktop/`)

CrewSignal is an offline-first spaceflight & extreme-environment physiological self-monitoring desktop application built with **Tauri 2**, **React 19**, **TypeScript**, **Vite**, and **Rust `rusqlite` SQLite** (`bundled`).

> **Scope & Safety Notice:** CrewSignal is an independent manual-entry observation and personal-reference prototype. It does not diagnose disease, assess fitness for duty, prescribe treatments, or imply NASA, CDC, or NIST endorsement.

---

## Verified Build & Toolchain Environment

- **Target platform:** Windows 11 x64 (`x86_64-pc-windows-msvc`)
- **Rust / Cargo:** `rustc 1.96.0` / `cargo 1.96.0`
- **MSVC & Windows SDK:** Visual Studio 2022 Build Tools MSVC `14.44.35207`, Windows SDK `10.0.26100.0`
- **Node.js / npm:** `node v24.18.0` / `npm 11.16.0`
- **Core packages:** `tauri 2.12.5`, `@tauri-apps/cli 2.12.4`, `rusqlite 0.32.1` (`bundled`), `tauri-plugin-dialog 2.8.4`, `tauri-plugin-opener 2.7.3`, `react 19.3.1`, `zod 4.6.7`, `vite 8.3.8`, `vitest 5.1.0`, `@playwright/test 1.65.0`
- **Bundled offline fonts:** `Inter` (`v4.1`, OFL-1.1) and `Geist Mono` (`v1.9.2`, OFL-1.1) in `src/shared/assets/fonts/` (zero external network font requests)

---

## Microsoft Edge WebView2 Prerequisite & Offline Installer Option

- Tauri 2 on Windows uses **Microsoft Edge WebView2 Runtime** (pre-installed on Windows 11; verified `157.0.4341.46` on the build host).
- `src-tauri/tauri.conf.json` configures the **per-user NSIS Windows installer** (`installMode: "currentUser"`) with `webviewInstallMode: { "type": "downloadBootstrapper" }` so standard online Windows 10/11 installations without WebView2 can fetch the Microsoft Evergreen WebView2 bootstrapper cleanly without administrator elevation when installing per-user.
- **Offline installer option:** `downloadBootstrapper` needs network access on a computer without WebView2. For an offline-capable installer, change `bundle.windows.webviewInstallMode` in `src-tauri/tauri.conf.json` to:
  ```json
  "webviewInstallMode": {
    "type": "offlineInstaller",
    "silent": true
  }
  ```
  The pinned `@tauri-apps/cli 2.12.4` schema allows only `type` and `silent` on `offlineInstaller`; it rejects a `path` field. The Tauri CLI downloads Microsoft's standalone WebView2 runtime installer while bundling, so the build machine needs network access, and the NSIS installer grows by about 127 MB. The result still needs a test on a clean offline Windows VM without WebView2 before release (see `EVIDENCE.md`).
- To ship a specific WebView2 build instead, `fixedRuntime` is the only mode that takes a `path`, pointing to an extracted fixed-version runtime folder (about 180 MB). It is not used here.

---

## Local Architecture & Persistence Guarantees

1. **Local SQLite Database (`src-tauri/src/db.rs`):**
   - Stored in the user's Windows AppData directory (`app.path().app_data_dir()` / `crewsignal.db`).
   - Configured with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = FULL`, and `PRAGMA foreign_keys = ON`.
   - Protected by a single `Mutex<Connection>` and atomic `BEGIN IMMEDIATE ... COMMIT / ROLLBACK` transactions for:
     - Check-in observation commit + single target draft closure + `sourceDraftId` idempotence (`Already in your log`).
     - Interrupted commit acknowledgement recovery (`Addition unconfirmed` -> `Check the log` lookup).
     - Whole-observation CSV batch import reconciliation (`correctionHistory` preservation).
     - Scoped `SIM-01` demo reset and atomic Personal profile deletion.
2. **Demo vs. Personal Mode Isolation:**
   - `SIM-01` demo profile holds deterministic synthetic mission Day 42 data (`Demo · Synthetic data`).
   - Personal profiles start completely blank using your device's real clock (`Personal · Local log`) and never inherit synthetic demo numbers.
3. **Native Windows File Dialogs, External Links & Draft Guard:**
   - Export/import commands (`save_export_file`, `open_import_file`) use `tauri-plugin-dialog` + flushed/synced Rust I/O (`File::sync_all()`), returning `saved` + exact path, `cancelled`, `permission_refused`, or `error` without losing in-memory previews or drafts.
   - `open_external_url` (`tauri-plugin-opener`) permits only allowlisted HTTPS documentation hosts while cached source summaries remain accessible 100% offline.
   - `WindowEvent::CloseRequested` intercepts closing and emits `crewsignal://close-requested` when an unfinished or unretained draft is active.

---

## Standalone Development & Verification Commands

This directory (`source/desktop/`) is self-contained and bundles its synced copy of `@crewsignal/shared` contracts, tokens, fixtures, and OFL fonts inside `src/shared/` with zero runtime reads outside `source/desktop/`.

```powershell
# 1. Install frontend dependencies
npm install

# 2. Typecheck & frontend unit/integration suite
npm run typecheck
npm test

# 3. Rust SQLite transaction, idempotence, rollback, and file I/O tests
cd src-tauri
cargo test
cd ..

# 4. Production Vite build & Playwright E2E + axe-core + scaling/contrast verification
npm run build
npm run test:e2e

# 5. Build Windows x64 per-user NSIS installer
npx tauri build
```

---

## Build & Installer Record

- **Built executable (`x86_64-pc-windows-msvc`):** `src-tauri/target/release/crewsignal-desktop.exe`
  - **Size:** `13,645,312` bytes
  - **SHA-256:** `2AE51C47EE7A837E3D268C2AE2EB863D635FE20DA939B07AEFF5860D30ADCE73`
  - **Code signing status:** `NotSigned` (unsigned local development build)
  - **Runtime launch smoke check:** Launched cleanly and held window title `CrewSignal` after 3s without exit/crash.
- **Per-user NSIS Windows installer (`x64`, `installMode: "currentUser"`):** `src-tauri/target/release/bundle/nsis/CrewSignal_0.1.0_x64-setup.exe`
  - **Size:** `4,701,452` bytes (`4.48 MiB`)
  - **SHA-256:** `E2D924BF712455F095E4ABF25AA2F015302777C5D323F97D32729E4F893A2918`
  - **Code signing status:** `NotSigned` (unsigned local development build)
  - **Host WebView2 Runtime version:** `157.0.4341.46`
- **Verified checks:**
  - `cargo test`: `11 passed; 0 failed; 0 ignored`
  - `npm run typecheck`: passed (`tsc --noEmit` exited 0)
  - `npm test` (Vitest): `1 passed`, `7 passed (7)`
  - `npm run test:e2e` (Playwright + `@axe-core/playwright` WCAG 2.2 AA): `4 passed`
  - `node scripts/sync-to-targets.mjs --check desktop`: `[desktop] OK (37 files match SHA-256)`
- **Bundled third-party font notices:** `Inter-OFL-LICENSE.txt` and `GeistMono-OFL-LICENSE.txt` included in `src/shared/assets/fonts/`.
