# CrewSignal

Use [CONTRIBUTING.md](CONTRIBUTING.md) for issue records, Conventional Commits and pull request verification.

Offline-first manual crew health observation, trend comparison, controlled educational guidance, and scoped report export across three standalone applications backed by one canonical TypeScript domain core.

Built by **POP N' SEB** (Manila, Philippines) for the **2026 NASA International Space Apps Challenge** (*Health Monitoring Software*).

> **Important Scope & Safety Notice**
> - CrewSignal is an independent manual-entry prototype seeded with synthetic mission fixtures (`SIM-01`, `SIM-SCHEDULE`, `SIM-EMPTY`).
> - Comparisons against a personal reference are strictly descriptive, and all bundled actions/sources provide educational context only.
> - CrewSignal does **not** perform clinical diagnosis, prescribe interventions, connect to flight hardware/sensors, claim NASA/CDC/NIST endorsement, or claim certification under NASA-STD-3001 Volume 2.

---

## Repository Structure (`source/`)

This directory is designed to build and run cleanly from a standalone `source/` checkout with zero runtime dependency on external workspace planning or design mockup folders.

| Directory / File | Purpose | Stack / Notes |
| --- | --- | --- |
| `shared/` | Canonical domain contracts, math, timing, references, guidance, CSV/JSON interchange, tokens, bundled fonts, fixtures & vectors | Pure TypeScript (`ES2022`), `zod@4.6.7`, zero browser/Tauri/RN/Node runtime imports in `src/` |
| `website/` | Responsive public landing page (`/`) and synthetic browser demo (`/demo`) | React, Vite, TypeScript, Recharts, Dexie/IndexedDB, PWA offline cache |
| `desktop/` | Installable Windows desktop application | Tauri 2, React, Vite, TypeScript, local SQLite, NSIS installer |
| `mobile/` | Installable iOS and Android application | Expo, React Native, TypeScript, local SQLite |
| `scripts/verify-clean-source.mjs` | Verifies root release files, license, zero `../docs` / `../plan` runtime dependencies, secret/DB hygiene, and `shared/` target parity | Zero-dependency Node ESM |
| `LICENSE` | Apache License, Version 2.0 | Applies to CrewSignal source code |
| `CREDITS.md` | Spaceflight/measurement references, design credits, team attribution & AI/tool-assistance disclosure | Includes checked `2026-11-13` citations |
| `THIRD-PARTY-NOTICES.md` | Font OFL-1.1 licenses (full text) and per-package dependency notices | Inspected from `shared`, `website`, `desktop` (`npm` + `Cargo`), and `mobile` lockfiles |
| `EVIDENCE.md` | Cross-platform verification report, binary hashes, `V01–V11`, `S01–S14`, `G01–G12`, and host limits | Verified on `main` branch |

---

## Quick Start (Clean `source/` Checkout)

### Prerequisites

- **Shared core & Website:** Node.js `>= 22` and npm (verified on Node `v24.18.0` / npm `11.16.0`).
- **Windows Desktop (`desktop/`):** Rust MSVC toolchain (verified `rustc 1.96.0` / `cargo 1.96.0`), Visual Studio 2022 Build Tools MSVC (`14.44.35207`), Windows SDK (`10.0.26100.0`), and Microsoft Edge WebView2 Runtime (host `157.0.4341.46`; offline WebView2 installer option documented in `desktop/README.md`).
- **Mobile (`mobile/`):** Node.js (`v24.18.0` / `npm 11.16.0` verified for Jest + `node:sqlite` + `expo export`), JDK (`26.0.1`), plus Android SDK (`ANDROID_HOME`, `adb` / `gradle`) for Android `.apk` builds or macOS Xcode / EAS CLI for signed iOS builds (see `mobile/README.md`).

### 1. Canonical Shared Core (`shared/`)

```bash
cd shared
npm ci
npm run typecheck
npm test
```

Verified outputs in `shared/`:
- `npm run typecheck` runs `tsc --noEmit -p tsconfig.json` (pure `ES2022`, `"types": []`) and `tsc --noEmit -p tsconfig.tests.json`.
- `npm test` runs Vitest (`4` test files, `28` unit and Cross-Platform Acceptance Vector tests).
- Syncing shared contracts, tokens, fixtures, and fonts into targets:
  ```bash
  node shared/scripts/sync-to-targets.mjs --write <website|desktop|mobile|all>
  node shared/scripts/sync-to-targets.mjs --check <website|desktop|mobile|all>
  ```

### 2. Website (`website/`)

```bash
cd website
npm ci
npm run typecheck
npm test          # Vitest + fake-indexeddb unit & transaction suite
npm run build     # tsc --noEmit && vite build (dist/sw.js + manifest.webmanifest)
npm run test:e2e  # Playwright Chromium + axe-core WCAG 2.2 AA + offline PWA suite
npm run preview
```

- Routes: `/` (public landing page) and `/demo` (synthetic browser demo backed by Dexie/IndexedDB; rejects `personal`-mode backup and draft-recovery bundles).

### 3. Windows Desktop (`desktop/`)

```powershell
cd desktop
npm ci
npm run typecheck
npm test
cd src-tauri && cargo test && cd ..
npm run build
npm run test:e2e
npx tauri build
```

- See [`desktop/README.md`](./desktop/README.md) for the offline Microsoft Edge WebView2 installer option and Windows AppData SQLite details (`crewsignal.db`, WAL + `BEGIN IMMEDIATE` transactions).
- Built binary `desktop/src-tauri/target/release/crewsignal-desktop.exe` (`13,736,960` bytes, `NotSigned`).
- Per-user NSIS installer `desktop/src-tauri/target/release/bundle/nsis/CrewSignal_0.1.0_x64-setup.exe` (`4,729,901` bytes, `NotSigned`). See [EVIDENCE.md §6.10](./EVIDENCE.md#610-pr-1-backup-and-restore-lifecycle-one-app-level-operation-owner-review-of-a66df87) for the tested revision and full SHA-256 hashes.

### 4. Mobile — iOS & Android (`mobile/`)

```bash
cd mobile
npm ci
npm run typecheck
npm test          # Jest + node:sqlite transaction, vector, & RNTL UI suites (5 suites, 45 passed)
npm run export    # npx expo export --platform ios --platform android --output-dir dist
```

- See [`mobile/README.md`](./mobile/README.md) and [`mobile/eas.json`](./mobile/eas.json) for Expo SDK `58.0.25`, React Native `0.88.1`, `expo-sqlite@58.0.17`, and native prebuild / EAS `.apk` / iOS build instructions (`ANDROID_HOME`, EAS CLI, and macOS Xcode are not present on this Windows build host, so native `.apk`/`.ipa` compilation and physical VoiceOver/TalkBack runs remain pending a native SDK/macOS build host).

### 5. Clean-Source Hygiene & Parity Check

From `source/`:

```bash
# Strict release gate (requires website, desktop, and mobile src/shared to match shared/ SHA-256 checksums)
node ./scripts/verify-clean-source.mjs

# Pre-sync root + shared check while target apps are still being assembled
node ./scripts/verify-clean-source.mjs --allow-pending-targets
```

---

## Privacy & Synthetic-Demo Boundaries

- **Local-only v1 persistence:** CrewSignal operates without telemetry, cloud accounts, or external API calls during normal use. All profiles, observations, drafts, workflow events, references, and review acknowledgements live locally on-device (`IndexedDB` on web; `SQLite` on desktop and mobile).
- **Synthetic Public Website Demo:** `website/` (`/demo`) runs strictly in synthetic demo mode (`SIM-01`, `SIM-SCHEDULE`, `SIM-EMPTY`), clearly labels imported files and inputs as synthetic examples, and rejects `personal`-mode backups or recovery files.
- **Native Personal Mode:** Desktop and mobile native apps support a `personal` profile starting blank on local system time with isolated profile scoping (`profileId`).
- **Conservative Scoped Reporting:** `crewsignal-report` v1 exports **exclude `mood` and `note` fields by default** across both rows and report metadata (`mood` and `note` inclusion requires explicit opt-in), and preview, print, and exported JSON share identical filtered output.
- **Separate Backup & Draft Recovery:** Full profile backup (`crewsignal-backup` v1) and single-draft recovery (`crewsignal-draft-recovery` v1) use distinct schema kinds and confirmation paths; backup restore defaults to creating a separate profile unless replacement is explicitly confirmed.
- **Bundled Offline Assets:** `Inter` (v4.1), `Geist Mono` (v1.9.2), Help cards, and concise cached summaries of all eight referenced NASA/CDC/NIST sources (`checkedDate: 2026-11-13`) are packaged locally inside `shared/` and synced to each target.

---

## Release & Verification Ledger

See [`EVIDENCE.md`](./EVIDENCE.md) for the complete verification report, acceptance vector matrix (`V01–V11`), scenario results (`S01–S14`), completion gates (`G01–G12`), and host-environment boundaries.

| Deliverable | Folder | Status | Verified Commands / Evidence | Branch |
| --- | --- | --- | --- | --- |
| Shared Core | `shared/` | Verified (`@verifier` `#32`) | `npm run typecheck` (exit `0`), `npm test` (`4` files, `28` tests passed), `37/37` target parity | `main` |
| Website & Browser Demo | `website/` | Verified (`@verifier` `#32`) | Clean-checkout `npm run build` (`21` precache entries, `3143.84 KiB`), `npm test` (`8` passed), `npx playwright test` (`6` passed), live Playwright/axe/SW/viewport audit (`0` violations) | `main` |
| Windows Desktop | `desktop/` | Verified (`@verifier` `#29`, `#32`) | Clean-checkout `cargo test` (`11` passed), `npm run typecheck`, `npm test` (`7` passed), `npm run test:e2e` (`4` passed), live Playwright/axe/forced-colors audit (`0` violations), rebuilt `CrewSignal_0.1.0_x64-setup.exe` (`NotSigned`) | `main` |
| Android & iOS Mobile | `mobile/` | JS/Hermes verified (`@verifier` `#26`, `#32`); native SDKs absent on host | Isolated clean-checkout `npm run typecheck`, bare `npm test` (`3` suites / `18` passed, `38.037 s`), `npx expo export` (iOS `929` / Android `937` modules `.hbc`); `.apk`/`.ipa` & device screen-reader checks require native SDK / macOS Xcode host | `main` |
