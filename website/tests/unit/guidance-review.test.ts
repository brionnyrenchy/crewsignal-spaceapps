import { expect, it } from 'vitest';
import { buildSleepInsight, isInsightReviewCurrent, SIM_01_SLEEP_OBSERVATIONS, SIM_01_REFERENCES, SIM_01_SNAPSHOT_UTC } from '../../src/shared';
import { CrewSignalDatabase } from '../../src/storage/db';
import { createRepository } from '../../src/storage/repository';

it('browser source-only confirmation is idempotent, survives reload, and retains older revisions', async () => {
  const db = new CrewSignalDatabase(`review-${Math.random()}`);
  try {
    const repository = createRepository(db);
    await repository.ensureSeeded();
    const initial = await repository.loadSnapshot();
    const current = buildSleepInsight({ observation: SIM_01_SLEEP_OBSERVATIONS[6]!, reference: SIM_01_REFERENCES.find(r => r.metricId === 'sleep')!, createdAtUtc: SIM_01_SNAPSHOT_UTC })!;
    await repository.acknowledgeInsightAtomically(current, SIM_01_SNAPSHOT_UTC);
    const fresh = { ...current, sourceVersions: Object.fromEntries(current.sourceIds.map(id => [id, 'new source summary'])) };
    const saved = await repository.acknowledgeInsightAtomically(fresh, '2026-11-14T01:00:00Z');
    expect(await repository.acknowledgeInsightAtomically(fresh, '2026-11-14T02:00:00Z')).toEqual(saved);
    const reloaded = await createRepository(db).loadSnapshot();
    expect(reloaded.insights.some(i => isInsightReviewCurrent(i, fresh))).toBe(true);
    expect(reloaded.insights.some(i => isInsightReviewCurrent(i, current))).toBe(true);
    expect(reloaded.insights.some(i => isInsightReviewCurrent(i, { ...fresh, profileId: 'other-profile' }))).toBe(false);
    expect(reloaded.observations).toEqual(initial.observations);
  } finally { await db.delete(); }
});
