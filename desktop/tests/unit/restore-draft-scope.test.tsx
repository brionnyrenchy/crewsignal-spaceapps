/**
 * PR #1 re-review P1: restoring a backup through Reports moves the app to the
 * restored profile. The Personal draft that was open must stay with Personal,
 * the restored profile must start without an inherited draft, and neither
 * profile may gain an observation unless its own draft is committed.
 * Drives the real App against the browser backend and the mocked file picker.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

/** Reads a stored profile without changing which profile is active. */
function stored(profileId: string) {
  const backend = browserMockBackend as unknown as {
    bundles: Map<string, { observations: unknown[]; drafts: Array<{ profileId: string; metricId: string }> }>;
  };
  return backend.bundles.get(profileId) ?? { observations: [], drafts: [] };
}

function activeProfileId(): string {
  return (browserMockBackend as unknown as { activeProfileId: string }).activeProfileId;
}

describe("PR #1 re-review P1: restore keeps drafts with their own profile", () => {
  beforeEach(() => {
    browserMockBackend.setHooks({
      simulateDraftRetentionFailure: false,
      simulateCommitRollback: false,
      simulateLostAck: false,
      simulateLookupUnavailable: false,
      simulateLogReadFailure: false,
      simulateFileOutcome: null,
    });
    browserMockBackend.setStorageUnavailable(false);
    browserMockBackend.resetDemo(buildDemoSeedInput(false));
    window.__CREWSIGNAL_MOCK_FILES__ = undefined;
  });
  afterEach(() => {
    cleanup();
    window.__CREWSIGNAL_MOCK_FILES__ = undefined;
  });

  it("Personal draft stays resumable, the restored Demo profile starts blank, and only Personal gains its entry", async () => {
    const backup = await demoBackupJson();
    render(<App />);
    await screen.findByText(/11 observations across 5 of 6 types/i);

    // 1. Personal profile with a BP draft advanced to Review.
    nav(/Settings/i);
    fireEvent.change(await screen.findByLabelText(/New personal profile alias/i), {
      target: { value: "Commander Nova" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create blank Personal profile/i }));
    await screen.findByText(/Personal profile created/i);
    nav(/Check-in/i);
    fireEvent.click(await screen.findByRole("button", { name: "Blood pressure" }));
    fireEvent.change(await screen.findByLabelText(/Systolic/i), { target: { value: "127" } });
    fireEvent.change(screen.getByLabelText(/Diastolic/i), { target: { value: "81" } });
    fireEvent.click(screen.getByRole("button", { name: /Next: Review/i }));
    await screen.findByRole("heading", { name: /Review before adding to your log/i });
    expect(screen.getByText("127/81 mmHg")).toBeInTheDocument();

    // 2. Reports -> Backup & Restore: restore a SIM-01 Demo backup as a separate profile.
    nav(/^Reports$/i);
    fireEvent.click(await screen.findByRole("tab", { name: /Backup & Restore/i }));
    window.__CREWSIGNAL_MOCK_FILES__ = { openContent: backup, openFileName: "sim01-backup.json" };
    fireEvent.click(screen.getByRole("button", { name: /Choose Backup or Draft Recovery JSON/i }));
    await screen.findByText(/Valid Demo backup/i);
    fireEvent.click(screen.getByRole("button", { name: /Restore profile atomically/i }));
    await screen.findByText(/Restored into separate profile/i);

    // 3. The restored Demo profile has no inherited draft: Check-in starts blank.
    nav(/^Overview$/i);
    await screen.findByText(/11 observations across 5 of 6 types/i);
    nav(/Check-in/i);
    await screen.findByRole("heading", { name: /Heart rate/i });
    expect((document.getElementById("field-primary") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Blood pressure" }));
    const systolic = (await screen.findByLabelText(/Systolic/i)) as HTMLInputElement;
    expect(systolic.value).toBe("");
    expect(screen.queryByText("127/81 mmHg")).toBeNull();

    // The stored Personal draft is still under Personal, not the restored profile.
    const restoredId = activeProfileId();
    expect(restoredId).not.toMatch(/^personal-\d+$/);
    // Only its own blank draft (opened just now) may be stored; never the Personal 127/81.
    for (const d of stored(restoredId).drafts as Array<{ profileId: string; metricId: string; fields?: unknown }>) {
      expect(d.profileId).toBe(restoredId);
      expect(JSON.stringify(d)).not.toContain("127");
    }
    expect(stored(restoredId).observations).toHaveLength(11);
    const snap = await desktopBridge.loadAppSnapshot();
    expect(snap.activeProfileId).toBe(restoredId);
    const personal = snap.profiles.find((p) => p.alias === "Commander Nova")!;
    const personalBundle = stored(personal.id);
    expect(personalBundle.drafts).toHaveLength(1);
    expect(personalBundle.observations).toHaveLength(0);

    // 4. Back on Personal the 127/81 draft resumes and commits to Personal only.
    nav(/Settings/i);
    const row = (await screen.findByText("Commander Nova")).closest("tr")!;
    fireEvent.click(row.querySelector("button")!);
    await waitFor(() => expect(row.querySelector("button")!.textContent).toMatch(/Active/));
    nav(/Check-in/i);
    await screen.findByText("127/81 mmHg");
    fireEvent.click(screen.getByRole("button", { name: /Add to log/i }));
    await screen.findByRole("heading", { name: /Added to your log/i });

    const personalAfter = stored(personal.id);
    expect(personalAfter.observations).toHaveLength(1);
    expect(personalAfter.drafts).toHaveLength(0);
    const restoredAfter = stored(restoredId);
    expect(restoredAfter.observations).toHaveLength(11);
  });
});
