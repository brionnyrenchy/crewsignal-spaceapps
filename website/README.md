# CrewSignal Website & PWA Demo (`source/website`)

Public landing page (`/`) and local-first synthetic observation web demo (`/demo`) built with React, TypeScript, Vite, Zod, Recharts, Dexie (IndexedDB), and `vite-plugin-pwa`.

## Architecture & Independence

- `source/website/` builds cleanly as a standalone package without any build- or run-time dependency on parent docs or plan files.
- Shared domain schemas, conversions, timing rules, 7-day fallback references, educational guidance registries, and CSV/JSON interchange validators reside synced inside `src/shared/` via `npm run sync:shared`.
- All fonts (`Inter Variable` and `Geist Mono`) and attributed evidence summaries (NASA HRP, NASA Standard Measures, CDC NHANES `18.02`, NIST temperature units) are bundled locally for zero-external-network operation.

## Key Commands

```bash
npm install
npm run typecheck
npm run build
npm run preview
npm test          # Vitest + fake-indexeddb unit & transaction suite
npm run test:e2e  # Playwright Chromium + axe-core + offline PWA suite
```

## Synthetic-Only Public Web Scope

- `/demo` runs synthetic profiles (`SIM-01`, `SIM-SCHEDULE`, `SIM-EMPTY`) in IndexedDB on this device.
- Personal-mode backup and draft-recovery bundles (`mode: "personal"`) are explicitly rejected in the public web demo to preserve isolation between personal logs and synthetic demonstrations.
- Not a medical device, diagnostic engine, or flight-crew clearance tool.
