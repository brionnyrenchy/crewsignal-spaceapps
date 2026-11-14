import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { NodeSqliteDriver } from '../src/storage/nodeDriver';
import { CrewSignalSqliteStore } from '../src/storage/sqliteStore';
import { buildSleepInsight, isInsightReviewCurrent, SIM_01_SLEEP_OBSERVATIONS, SIM_01_REFERENCES, SIM_01_SNAPSHOT_UTC, buildBackupBundle } from '../src/shared/src';
describe('Android acknowledgement SQLite revisions', () => {
  test('source-only bump, duplicate taps, reload and profile restore retain independent reviews without observation writes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crewsignal-guidance-'));
    const filename = path.join(directory, 'restart.db');
    let driver = new NodeSqliteDriver(filename); const store = new CrewSignalSqliteStore(driver);
    try {
      await store.initialize();
      const before = await store.loadAppSnapshot();
      const current = buildSleepInsight({ observation: SIM_01_SLEEP_OBSERVATIONS[6]!, reference: SIM_01_REFERENCES.find(r=>r.metricId==='sleep')!, createdAtUtc: SIM_01_SNAPSHOT_UTC })!;
      const old = await store.markInsightReviewed({ insight: current, reviewedAtUtc: SIM_01_SNAPSHOT_UTC });
      const fresh = { ...current, sourceVersions: Object.fromEntries(current.sourceIds.map(id=>[id, 'updated summary'])) };
      expect(isInsightReviewCurrent(old, fresh)).toBe(false);
      const [first, repeated] = await Promise.all([
        store.markInsightReviewed({ insight: fresh, reviewedAtUtc: '2026-11-14T01:00:00Z' }),
        store.markInsightReviewed({ insight: fresh, reviewedAtUtc: '2026-11-14T02:00:00Z' }),
      ]);
      expect(repeated).toEqual(first);
      await driver.close();
      driver = new NodeSqliteDriver(filename);
      const reopenedStore = new CrewSignalSqliteStore(driver);
      const reloaded = await reopenedStore.loadAppSnapshot();
      expect(reloaded.active.insights.some(i=>isInsightReviewCurrent(i, fresh))).toBe(true);
      expect(reloaded.active.insights.some(i=>isInsightReviewCurrent(i, current))).toBe(true);
      expect(reloaded.active.observations).toEqual(before.active.observations);
      const b = buildBackupBundle({ confirmedIncludeAllProfileData:true, preferences:reloaded.preferences, profile: reloaded.active.profile, observations: reloaded.active.observations, checkInEvents: reloaded.active.checkInEvents, references: reloaded.active.references, insights: reloaded.active.insights, exportedAtUtc: SIM_01_SNAPSHOT_UTC });
      const result = await reopenedStore.restoreBackupBundle({ rawBackup: b, destination: 'separate_profile' });
      expect(result.ok).toBe(true);
      const restored = await reopenedStore.loadAppSnapshot();
      const restoredCurrent = { ...fresh, profileId: restored.active.profile.profileId };
      expect(restoredCurrent.profileId).not.toBe(fresh.profileId);
      expect(restored.active.insights.some(i=>isInsightReviewCurrent(i, restoredCurrent))).toBe(true);
      expect(restored.active.insights.some(i=>isInsightReviewCurrent(i, fresh))).toBe(false);
    } finally {
      await driver.close();
      if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected cleanup directory');
      fs.rmSync(directory, { recursive:true, force:true });
    }
  });
});
