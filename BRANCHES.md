# Commit changes

Source: https://github.com/miraflowwer/spaceapps-2026-crewsignal

Pinned source commit: 46227a7f2d61c19e0d4f4e9ffbe68a878cac1a77. Original history and attribution are preserved. The original repository is unchanged.

| Branch | Contents |
| --- | --- |
| main | Complete source, all apps, shared core, verification scripts and evidence |
| 01-shared-core | shared/ plus license, credits and contribution guidance |
| 02-website | website/ and shared/ plus license, credits and contribution guidance |
| 03-desktop | desktop/ and shared/ plus license, credits and contribution guidance |
| 04-mobile | mobile/ and shared/ plus license, credits and contribution guidance |

Numbered branches are separate module snapshots, not sequential implementation stages. Each starts from main and keeps its selected module plus shared core and legal/contribution files. Each app includes synced shared assets and contracts; canonical shared/ is included for updates.

## Work on a branch

After publishing:

```powershell
git clone --branch 02-website --single-branch https://github.com/silentshiro-g1thub/Commit-changes.git
cd Commit-changes
# Make edits, then stage the specific files you changed.
git add website/src
git commit -m "feat(website): describe your change"
git push origin HEAD
```

Replace 02-website and the staged path for another module. Commit or stash edits before switching branches. These branches intentionally remove other apps: do not merge an entire split branch into main. To apply edits back to the complete project, copy or restore only the selected module paths, then review the diff.

## Download into a different new repository

Each ZIP contains a source snapshot with lockfiles and bundled assets, excluding .git, installed dependencies, local data and build output. Extract one ZIP and open a terminal in the extracted project root:

```powershell
git init -b main
git add .
git commit -m "chore: import CrewSignal module"
gh repo create YOUR-NEW-REPO --private --source . --remote origin --push
```

Keep LICENSE, CREDITS.md and THIRD-PARTY-NOTICES.md. ZIPs do not contain history. Commit-changes.bundle preserves source history and every prepared branch.

## Publish the prepared repository

Run Publish.ps1 from the download package in your normal authenticated PowerShell terminal. It creates silentshiro-g1thub/Commit-changes privately and pushes main and the four numbered branches without force. It refuses a different account or a public destination. It restores the repo from Commit-changes.bundle if the prepared local checkout is unavailable. GitHub creation/upload have not been performed in this restricted workspace.

## Verification

Packaging checks compare retained source files byte-for-byte with the pinned source commit, check shared parity for each app, and verify the Git bundle. Application code and dependency versions are unchanged. Dependencies were not installed and application test suites were not rerun for this packaging task. EVIDENCE.md on main describes upstream historical tests, not a new run.
