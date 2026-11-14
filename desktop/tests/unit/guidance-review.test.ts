import { describe, expect, it } from 'vitest';
import { buildSleepInsight, guidanceReviewIdentity, SIM_01_SLEEP_OBSERVATIONS, SIM_01_REFERENCES, SIM_01_SNAPSHOT_UTC } from '../../src/shared/src';
import { currentActionReview, desktopBridge, type ActionReviewRecord } from '../../src/bridge/desktopBridge';
describe('Windows acknowledgement bridge', () => {
  it('rejects an incomplete legacy source tuple and records a source-only revision idempotently', async () => {
    const current = buildSleepInsight({ observation: SIM_01_SLEEP_OBSERVATIONS[6]!, reference: SIM_01_REFERENCES.find(r=>r.metricId==='sleep')!, createdAtUtc: SIM_01_SNAPSHOT_UTC })!;
    const legacy: ActionReviewRecord = { reviewId: 'legacy-review', actionId:'action-review-sleep-routine', observationId:current.observationId, referenceVersion:current.referenceVersion, ruleVersion:current.ruleVersion, sourceVersion:'Version 1', reviewedAtUtc:SIM_01_SNAPSHOT_UTC, reviewed:true };
    expect(currentActionReview([legacy], current)).toBeUndefined();
    const full: ActionReviewRecord = { ...legacy, ...current, reviewId:guidanceReviewIdentity(current)!, reviewed:true, reviewedAtUtc:SIM_01_SNAPSHOT_UTC };
    await desktopBridge.ensureDemoSeed();
    const saved = await desktopBridge.recordActionReview(current.profileId, full);
    const repeated = await desktopBridge.recordActionReview(current.profileId, { ...full, reviewedAtUtc:'2026-11-14T02:00:00Z' });
    expect(repeated).toEqual(saved);
    const fresh = { ...current, sourceVersions:Object.fromEntries(current.sourceIds.map(id=>[id,'new summary'])) };
    expect(currentActionReview([full], fresh)).toBeUndefined();
    expect(currentActionReview([{ ...full, profileId:'other-profile' }], current)).toBeUndefined();
  });
});
