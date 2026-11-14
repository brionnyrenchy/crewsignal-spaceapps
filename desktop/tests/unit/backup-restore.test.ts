/**
 * Review P1: Windows backup/restore keeps the source mode, round-trips platform
 * history, refuses cross-mode replacement and leaves records intact on failure.
 * Runs against the bridge module (browser backend outside Tauri); the native
 * SQLite command has matching guards covered by `cargo test`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  SIM_01_PREFERENCES,
  SIM_EMPTY_PROFILE,
  buildBackupBundle,
  validateBackupImport,
  type BackupBundle,
} from "../../src/shared/src";
import {
  buildDemoSeedInput,
  desktopBridge,
  profileConfigToRecord,
  profileRecordToConfig,
  type AppSnapshot,
} from "../../src/bridge/desktopBridge";
import {
  backupHistoryFrom,
  buildRestoreRequest,
  restoreBlockReason,
} from "../../src/state/backupRestore";

function exportBackup(snap: AppSnapshot): BackupBundle {
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
  // Through JSON, exactly as a saved file would be read back.
  const validated = validateBackupImport(JSON.parse(JSON.stringify(bundle)));
  expect(validated.valid).toBe(true);
  return validated.bundle!;
}

describe("Review P1: Windows backup restore", () => {
  beforeAll(async () => {
    const seeded = await desktopBridge.ensureDemoSeed(buildDemoSeedInput(false));
    const pid = seeded.activeProfileId;
    const sleepObs = seeded.profileData.observations.find((o) => o.metricId === "sleep")!;
    // A reviewed action and a mission-clock change, as the Actions and Settings screens write them.
    await desktopBridge.recordActionReview(pid, {
      reviewId: "rev-backup-test",
      actionId: "action-review-sleep-routine",
      observationId: sleepObs.observationId,
      referenceVersion: 1,
      ruleVersion: "Version 1",
      sourceVersion: "Version 1",
      reviewedAtUtc: "2026-11-13T07:30:00Z",
      reviewed: true,
    });
    const rec = seeded.profiles.find((p) => p.id === pid)!;
    await desktopBridge.updateProfileClock({
      profileId: pid,
      epochUtc: rec.epochUtc,
      timezone: "Asia/Manila",
      snapshotUtc: rec.snapshotUtc,
      changedAt: "2026-11-13T07:31:00Z",
    });
  });

  it("keeps Demo mode and history on a separate restore, and re-exports the same history", async () => {
    const demo = await desktopBridge.loadAppSnapshot();
    const demoProfile = demo.profiles.find((p) => p.id === demo.activeProfileId)!;
    expect(demoProfile.mode).toBe("demo");
    expect(demo.profileData.actionReviews.length).toBeGreaterThan(0);
    expect(demo.profileData.clockHistory.length).toBeGreaterThan(0);

    const bundle = exportBackup(demo);
    expect(bundle.history?.actionReviews).toHaveLength(demo.profileData.actionReviews.length);
    expect(bundle.history?.clockHistory).toHaveLength(demo.profileData.clockHistory.length);

    const activeProfile = profileRecordToConfig(demoProfile, demo.profileData.schedules);
    const { request } = buildRestoreRequest({
      bundle,
      mode: "separate_profile",
      activeProfile,
      nowIso: "2026-11-13T08:01:00Z",
      uniqueSuffix: "t1",
    });
    const res = await desktopBridge.restoreBackup(request);
    expect(res.restoredProfile.mode).toBe("demo");
    expect(res.restoredProfile.id).toBe("restored-demo-t1");

    const restored = await desktopBridge.loadAppSnapshot("restored-demo-t1");
    const restoredRec = restored.profiles.find((p) => p.id === "restored-demo-t1")!;
    expect(restoredRec.mode).toBe("demo");
    expect(restored.profileData.observations).toHaveLength(demo.profileData.observations.length);
    expect(restored.profileData.observations.every((o) => o.profileId === "restored-demo-t1")).toBe(true);
    expect(restored.profileData.actionReviews.map((r) => r.reviewId)).toEqual(
      demo.profileData.actionReviews.map((r) => r.reviewId),
    );
    expect(restored.profileData.clockHistory.every((c) => c.profileId === "restored-demo-t1")).toBe(true);
    expect(profileRecordToConfig(restoredRec, restored.profileData.schedules).schedules).toEqual(
      activeProfile.schedules,
    );

    // Export of the restored profile carries the same history.
    const again = exportBackup(restored);
    expect(again.profile.mode).toBe("demo");
    expect(again.history?.actionReviews).toEqual(bundle.history?.actionReviews);

    // A repeat import with a colliding ID is refused without touching the first copy.
    await expect(desktopBridge.restoreBackup(request)).rejects.toMatchObject({
      code: "RESTORE_PROFILE_ID_COLLISION",
    });
    const unchanged = await desktopBridge.loadAppSnapshot("restored-demo-t1");
    expect(unchanged.profileData.observations).toHaveLength(demo.profileData.observations.length);
  });

  it("refuses to replace a Personal profile with a Demo backup and leaves its records intact", async () => {
    const demo = await desktopBridge.loadAppSnapshot();
    const bundle = exportBackup(demo);

    const personalCfg = { ...SIM_EMPTY_PROFILE, profileId: "personal-restore-guard", label: "Guarded" };
    expect(personalCfg.mode).toBe("personal");
    await desktopBridge.createPersonalProfile(profileConfigToRecord(personalCfg));
    const before = await desktopBridge.loadAppSnapshot("personal-restore-guard");

    expect(
      restoreBlockReason({ bundle, mode: "replace_profile", activeProfile: personalCfg, confirmReplace: true }),
    ).toMatch(/Demo backup.*Personal profile/);

    // Even if the UI guard were bypassed, the backend refuses and writes nothing.
    const { request } = buildRestoreRequest({
      bundle,
      mode: "replace_profile",
      activeProfile: personalCfg,
      nowIso: "2026-11-13T08:02:00Z",
      uniqueSuffix: "t2",
    });
    await expect(desktopBridge.restoreBackup(request)).rejects.toMatchObject({
      code: "RESTORE_MODE_MISMATCH",
    });
    const after = await desktopBridge.loadAppSnapshot("personal-restore-guard");
    expect(after.profiles.find((p) => p.id === "personal-restore-guard")?.mode).toBe("personal");
    expect(after.profileData.observations).toEqual(before.profileData.observations);
  });
});
