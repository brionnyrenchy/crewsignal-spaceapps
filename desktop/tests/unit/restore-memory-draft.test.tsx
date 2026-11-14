/**
 * PR #1 follow-up P1 (af389d0): when local storage cannot keep a Personal draft
 * (ER-04, memory only), restoring a backup through Reports switches profiles.
 * That draft is the only copy, so it must stay recoverable with its own profile:
 * Reports warns before the restore and offers the recovery export, the restored
 * profile starts blank, and switching back to Personal resumes the draft.
 * Covers both failure shapes of the native save: `retained: false` and a thrown
 * error. Drives the real App against the browser backend and mocked file picker.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SIM_01_PREFERENCES, buildBackupBundle } from "../../src/shared/src";
import {
  browserMockBackend,
  buildDemoSeedInput,
  desktopBridge,
  profileRecordToConfig,
} from "../../src/bridge/desktopBridge";
import { backupHistoryFrom } from "../../src/state/backupRestore";
import { App } from "../../src/App";

const HOOKS_OFF = {
  simulateDraftRetentionFailure: false,
  simulateCommitRollback: false,
  simulateLostAck: false,
  simulateLookupUnavailable: false,
  simulateLogReadFailure: false,
  simulateFileOutcome: null,
} as const;

async function demoBackupJson(): Promise<string> {
  const snap = await desktopBridge.ensureDemoSeed(buildDemoSeedInput(false));
  const rec = snap.profiles.find((p) => p.id === snap.activeProfileId)!;
  const bundle = buildBackupBundle({
    confirmedIncludeAllProfileData: true,
    exportedAtUtc: "2026-11-13T08:00:00Z",
    profile: profileRecordToConfig(rec, snap.profileData.schedules),
    preferences: SIM_01_PREFERENCES,
    observations: snap.profileData.observations,
    checkInEvents: snap.profileData.checkinEvents,
    references: snap.profileData.references,
    insights: [],
    history: backupHistoryFrom(snap.profileData),
  });
  return JSON.stringify(bundle);
}

function nav(name: RegExp) {
  fireEvent.click(screen.getAllByRole("button", { name })[0]!);
}

type StoredBundle = { observations: unknown[]; drafts: Array<{ profileId: string }> };
function bundles(): Map<string, StoredBundle> {
  return (browserMockBackend as unknown as { bundles: Map<string, StoredBundle> }).bundles;
}
function stored(profileId: string): StoredBundle {
  return bundles().get(profileId) ?? { observations: [], drafts: [] };
}
/** The Settings profiles-table row whose cell shows `text` (the topbar may repeat it). */
async function profileRow(text: string | RegExp): Promise<HTMLTableRowElement> {
  let row: HTMLTableRowElement | undefined;
  await waitFor(() => {
    row = screen
      .getAllByText(text)
      .map((el) => el.closest("tr"))
      .find((tr): tr is HTMLTableRowElement => tr !== null);
    expect(row).toBeDefined();
  });
  return row!;
}
/** The visible toast only. The sr-only live region repeats the same text, so a
 * page-wide text query can match twice. */
async function expectToast(text: RegExp) {
  await waitFor(
    () => {
      const toast = document.querySelector(".toast-banner");
      expect(toast).not.toBeNull();
      expect(toast!.textContent).toMatch(text);
    },
    { timeout: 4000 },
  );
}
function activeProfileId(): string {
  return (browserMockBackend as unknown as { activeProfileId: string }).activeProfileId;
}

/** Personal profile with a 129/83 BP draft at Review. Returns the Personal ID. */
async function personalDraftAtReview(alias: string): Promise<string> {
  nav(/Settings/i);
  fireEvent.change(await screen.findByLabelText(/New personal profile alias/i), {
    target: { value: alias },
  });
  fireEvent.click(screen.getByRole("button", { name: /Create blank Personal profile/i }));
  await screen.findByText(/Personal profile created/i);
  const personalId = activeProfileId();
  expect(personalId).toMatch(/^personal-\d+$/);
  nav(/Check-in/i);
  fireEvent.click(await screen.findByRole("button", { name: "Blood pressure" }));
  fireEvent.change(await screen.findByLabelText(/Systolic/i), { target: { value: "129" } });
  fireEvent.change(screen.getByLabelText(/Diastolic/i), { target: { value: "83" } });
  fireEvent.click(screen.getByRole("button", { name: /Next: Review/i }));
  await screen.findByRole("heading", { name: /Review before adding to your log/i });
  expect(screen.getByText("129/83 mmHg")).toBeInTheDocument();
  return personalId;
}

async function openBackupInReports(backup: string) {
  nav(/^Reports$/i);
  fireEvent.click(await screen.findByRole("tab", { name: /Backup & Restore/i }));
  window.__CREWSIGNAL_MOCK_FILES__ = { openContent: backup, openFileName: "sim01-backup.json" };
  fireEvent.click(screen.getByRole("button", { name: /Choose Backup or Draft Recovery JSON/i }));
  await screen.findByText(/Valid Demo backup/i);
}

/** Restored profile starts blank and holds no copy of the Personal draft. */
async function expectRestoredProfileBlank(personalId: string): Promise<string> {
  const restoredId = activeProfileId();
  expect(restoredId).not.toBe(personalId);
  nav(/Check-in/i);
  await screen.findByRole("heading", { name: /Heart rate/i });
  expect(screen.queryByText("129/83 mmHg")).toBeNull();
  for (const d of stored(restoredId).drafts) {
    expect(d.profileId).toBe(restoredId);
    expect(JSON.stringify(d)).not.toContain("129");
  }
  expect(stored(restoredId).observations).toHaveLength(11);
  return restoredId;
}

/** Back on Personal, the draft resumes at Review and commits to Personal only. */
async function expectPersonalResumesAndCommits(alias: string, personalId: string, restoredId: string) {
  nav(/Settings/i);
  const row = await profileRow(alias);
  fireEvent.click(row.querySelector("button")!);
  await waitFor(() => expect(activeProfileId()).toBe(personalId));
  nav(/Check-in/i);
  expect(await screen.findByText("129/83 mmHg")).toBeInTheDocument();

  browserMockBackend.setHooks({ ...HOOKS_OFF });
  fireEvent.click(screen.getByRole("button", { name: /Add to log/i }));
  await screen.findByRole("heading", { name: /Added to your log/i });
  expect(stored(personalId).observations).toHaveLength(1);
  expect(stored(personalId).drafts).toHaveLength(0);
  expect(stored(restoredId).observations).toHaveLength(11);
}

describe("PR #1 follow-up P1: restore keeps a memory-only draft with its own profile", () => {
  beforeEach(() => {
    browserMockBackend.setHooks({ ...HOOKS_OFF });
    browserMockBackend.setStorageUnavailable(false);
    browserMockBackend.resetDemo(buildDemoSeedInput(false));
    window.__CREWSIGNAL_MOCK_FILES__ = undefined;
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    browserMockBackend.setHooks({ ...HOOKS_OFF });
    window.__CREWSIGNAL_MOCK_FILES__ = undefined;
  });

  it("retained: false — Reports warns and offers export, cancel keeps it, restore parks it, Personal resumes it", async () => {
    const backup = await demoBackupJson();
    render(<App />);
    await screen.findByText(/11 observations across 5 of 6 types/i);

    // Storage can't keep drafts from here on (Settings › Simulate draft retention failure).
    nav(/Settings/i);
    fireEvent.change(await screen.findByLabelText(/New personal profile alias/i), {
      target: { value: "Commander Vega" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create blank Personal profile/i }));
    await screen.findByText(/Personal profile created/i);
    const personalId = activeProfileId();
    browserMockBackend.setHooks({ ...HOOKS_OFF, simulateDraftRetentionFailure: true });
    nav(/Check-in/i);
    fireEvent.click(await screen.findByRole("button", { name: "Blood pressure" }));
    fireEvent.change(await screen.findByLabelText(/Systolic/i), { target: { value: "129" } });
    fireEvent.change(screen.getByLabelText(/Diastolic/i), { target: { value: "83" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/i }));
    await screen.findByRole("heading", { name: /Review before adding to your log/i });
    expect(screen.getAllByText(/couldn't retain this draft/i).length).toBeGreaterThan(0);
    expect(stored(personalId).drafts).toHaveLength(0);

    // Cancelling the Open picker changes nothing.
    nav(/^Reports$/i);
    fireEvent.click(await screen.findByRole("tab", { name: /Backup & Restore/i }));
    window.__CREWSIGNAL_MOCK_FILES__ = {
      openOutcome: { status: "cancelled", path: null, fileName: null, content: null, message: null },
    };
    fireEvent.click(screen.getByRole("button", { name: /Choose Backup or Draft Recovery JSON/i }));
    await waitFor(() => expect(screen.queryByText(/Valid Demo backup/i)).toBeNull());
    expect(activeProfileId()).toBe(personalId);

    // A valid backup: Reports says the draft is only on this screen before restoring.
    window.__CREWSIGNAL_MOCK_FILES__ = { openContent: backup, openFileName: "sim01-backup.json" };
    fireEvent.click(screen.getByRole("button", { name: /Choose Backup or Draft Recovery JSON/i }));
    await screen.findByText(/Valid Demo backup/i);
    const notice = screen.getByTestId("restore-unretained-draft");
    expect(notice).toHaveTextContent(/Commander Vega draft is only on this screen/i);

    // The notice's export writes a draft recovery file for the Personal draft.
    const saveSpy = vi.spyOn(browserMockBackend, "saveExportFile");
    fireEvent.click(screen.getByRole("button", { name: /^Export draft recovery$/i }));
    await expectToast(/File saved/i);
    const recovery = JSON.parse(saveSpy.mock.calls[0]![1]);
    expect(recovery.kind).toBe("crewsignal-draft-recovery");
    expect(JSON.stringify(recovery)).toContain("129");

    // Restore: the toast says the draft is kept with Personal.
    fireEvent.click(screen.getByRole("button", { name: /Restore profile atomically/i }));
    await expectToast(/Restored into separate profile/i);
    await expectToast(/Commander Vega draft is kept in memory with that profile/i);
    expect(stored(personalId).drafts).toHaveLength(0);

    const restoredId = await expectRestoredProfileBlank(personalId);
    await expectPersonalResumesAndCommits("Commander Vega", personalId, restoredId);
  }, 20000);

  it("thrown save error — the draft is parked in memory and resumes on Personal", async () => {
    const backup = await demoBackupJson();
    render(<App />);
    await screen.findByText(/11 observations across 5 of 6 types/i);
    const personalId = await personalDraftAtReview("Commander Lyra");

    // Storage now loses the stored copy and the save before the switch throws.
    stored(personalId).drafts.length = 0;
    const realSave = browserMockBackend.saveDraft.bind(browserMockBackend);
    vi.spyOn(browserMockBackend, "saveDraft").mockImplementation((profileId, draft) => {
      if (profileId === personalId) throw { code: "DB_WRITE_FAILED", message: "disk I/O error" };
      return realSave(profileId, draft);
    });

    await openBackupInReports(backup);
    fireEvent.click(screen.getByRole("button", { name: /Restore profile atomically/i }));
    await expectToast(/Restored into separate profile/i);
    expect(stored(personalId).drafts).toHaveLength(0);

    const restoredId = await expectRestoredProfileBlank(personalId);
    vi.restoreAllMocks();
    await expectPersonalResumesAndCommits("Commander Lyra", personalId, restoredId);
  }, 20000);

  it("a Settings profile switch also keeps the memory-only draft, and the close guard counts it", async () => {
    render(<App />);
    await screen.findByText(/11 observations across 5 of 6 types/i);
    const personalId = await personalDraftAtReview("Commander Orion");
    stored(personalId).drafts.length = 0;
    browserMockBackend.setHooks({ ...HOOKS_OFF, simulateDraftRetentionFailure: true });
    const guardSpy = vi.spyOn(desktopBridge, "setDraftGuardState");

    nav(/Settings/i);
    const demoRow = await profileRow(/Demo · Synthetic/);
    fireEvent.click(demoRow.querySelector("button")!);
    await waitFor(() => expect(activeProfileId()).not.toBe(personalId));
    await waitFor(() =>
      expect(guardSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ hasUnretainedDraft: true, hasUnfinishedDraft: true }),
      ),
    );
    expect(stored(personalId).drafts).toHaveLength(0);

    const row = await profileRow("Commander Orion");
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() => expect(activeProfileId()).toBe(personalId));
    nav(/Check-in/i);
    expect(await screen.findByText("129/83 mmHg")).toBeInTheDocument();
  }, 20000);
});
