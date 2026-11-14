# CrewSignal Website & PWA Demo (`source/website`)

Public landing page (`/`) and local-first synthetic observation web demo (`/demo`) built with React, TypeScript, Vite, Zod, Recharts, Dexie (IndexedDB), and `vite-plugin-pwa`.

## Architecture & Independence

- `source/website/` builds cleanly as a standalone package without any build- or run-time dependency on parent docs or plan files.
- Shared domain schemas, conversions, timing rules, 7-day fallback references, educational guidance registries, and CSV/JSON interchange validators reside synced inside `src/shared/` via `npm run sync:shared`.
- All fonts (`Inter Variable` and `Geist Mono`) and attributed evidence summaries (NASA HRP, NASA Standard Measures, CDC NHANES `18.02`, NIST temperature units) are bundled locally for zero-external-network operation.

## Key Commands

Run these commands from the `website/` directory:

```bash
npm ci
npm run typecheck
npm run build
npm run preview
npm test          # Vitest + fake-indexeddb unit & transaction suite
npm run test:e2e  # Playwright Chromium + axe-core + offline PWA suite
```

`npm run preview` runs the production build first through `prepreview`, then serves
`dist/` at `http://localhost:4173`. A build error stops preview startup. For live
development without a production build, use `npm run dev`.

From the repository root (the folder containing `website/`), `npm run preview`
delegates to the same website build and preview commands.

## Synthetic-Only Public Web Scope

- `/demo/explorer` uses the bundled `crewsignal-body.glb` through the shared asset
  module and region mapping. Drag to rotate or use the labelled rotation and
  region buttons. Model selection and the existing system tabs stay in sync.
- The renderer loads on demand, draws only when the view changes, and releases
  graphics resources when leaving Explorer or hiding the document. Reduced
  motion starts with the diagram; an explicit 3D choice remains available.
  Devices without WebGL2 and model/context failures fall back to the diagram.
  The browser renderer uses WebGL2 directly and requires no external model or
  graphics-library download.

- `/demo` runs synthetic profiles (`SIM-01`, `SIM-SCHEDULE`, `SIM-EMPTY`) in IndexedDB on this device.
- Personal-mode backup and draft-recovery bundles (`mode: "personal"`) are explicitly rejected in the public web demo to preserve isolation between personal logs and synthetic demonstrations.
- Not a medical device, diagnostic engine, or flight-crew clearance tool.
