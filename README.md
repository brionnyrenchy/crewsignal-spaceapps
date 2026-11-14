# Commit changes - Website and browser demo

Branch: `02-website`. Separately editable module snapshot from CrewSignal source commit `46227a7f2d61c19e0d4f4e9ffbe68a878cac1a77`.

Includes `website/` and `shared/`, license, credits, dependency notices and contribution guidance. Other apps and whole-project verification scripts are omitted. Shared core is a TypeScript library, not a standalone application.

## Install and develop

Use Node.js 22 or newer and npm.

```powershell
cd website
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

See [website/README.md](website/README.md) for app details. From the repository root, check/update shared files with:

```powershell
node shared/scripts/sync-to-targets.mjs --check website
node shared/scripts/sync-to-targets.mjs --write website
```

## Commit changes

From the project root, stage the files you edited, then:

```powershell
git commit -m "feat(website): describe your change"
git push origin HEAD
```

For a fresh repository from a ZIP, follow [BRANCHES.md](BRANCHES.md). It also explains how to transfer edits back to the complete project.

[UPSTREAM-README.md](UPSTREAM-README.md) is original project context; it describes all apps and may link to files omitted here. Its verification claims refer to historical upstream runs.

Application source and assets are unchanged. Dependencies and application tests were not rerun during splitting. Keep [LICENSE](LICENSE), [CREDITS.md](CREDITS.md), and [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) when redistributing.
