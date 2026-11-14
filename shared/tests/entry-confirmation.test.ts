import { describe, expect, it } from 'vitest';
import {
  ENTRY_CONFIRMED_NOTE,
  SIM_01_EPOCH_UTC,
  SIM_01_PROFILE_ID,
  SIM_01_SNAPSHOT_UTC,
  buildCsvCommitPlan,
  createBlankDraft,
  generateCsvTemplate,
  parseAndReconcileCsv,
  planCommitDraft,
  validateDraftForReview,
  type CheckInDraft,
  type MetricId,
} from '../src/index';

function draft(metricId: MetricId, unit: string, raw: Partial<CheckInDraft['rawFields']>): CheckInDraft {
  const blank = createBlankDraft({
    draftId: 'draft-confirmation', profileId: SIM_01_PROFILE_ID, mode: 'demo', metricId,
    missionEpochUtc: SIM_01_EPOCH_UTC, proposedMissionDay: 42, proposedTimeHHMM: '07:18',
    nowUtc: SIM_01_SNAPSHOT_UTC, preferredUnit: unit,
  });
  return { ...blank, stage: 'review', rawFields: { ...blank.rawFields, ...raw } };
}

const unusual: Array<[MetricId, string, string, string?, RegExp?]> = [
  ['heart_rate', 'bpm', '720'],
  ['blood_pressure', 'mmHg', '80', '120', /order/],
  ['blood_pressure', 'mmHg', '400', '120'],
  ['body_temperature', 'C', '98.6', undefined, /°F/],
  ['body_temperature', 'F', '37', undefined, /°C/],
  ['body_temperature', 'C', '-10'],
  ['blood_glucose', 'mg/dL', '5.4', undefined, /mmol\/L/],
  ['blood_glucose', 'mmol/L', '97', undefined, /mg\/dL/],
];

describe('unusual entry confirmation', () => {
  it.each(unusual)('warns about %s in %s with value %s', (metric, unit, primary, secondary, warning) => {
    const review = validateDraftForReview(draft(metric, unit, { primary, secondary }));
    expect(review.validationState.valid).toBe(true);
    expect(review.warning).toMatch(warning ?? /entry-check range/);
  });

  it('warns about long sleep and keeps valid mood and typical values free of warnings', () => {
    expect(validateDraftForReview(draft('sleep', 'min', { hours: '25' })).warning).toMatch(/24 hours/);
    const typical = [
      draft('heart_rate', 'bpm', { primary: '72' }),
      draft('blood_pressure', 'mmHg', { primary: '118', secondary: '76' }),
      draft('body_temperature', 'C', { primary: '37' }),
      draft('body_temperature', 'F', { primary: '98.6' }),
      draft('blood_glucose', 'mg/dL', { primary: '97' }),
      draft('blood_glucose', 'mmol/L', { primary: '5.4' }),
      draft('sleep', 'min', { hours: '0', minutes: '0' }),
      draft('mood', 'score', { moodScore: 3 }),
    ];
    for (const entry of typical) {
      const review = validateDraftForReview(entry);
      expect(review.validationState.valid).toBe(true);
      expect(review.warning).toBeNull();
    }
  });

  it('requires explicit confirmation and preserves the entered value and recheck choice', () => {
    const params = {
      draft: { ...draft('blood_pressure', 'mmHg', { primary: '80', secondary: '120' }), quality: 'questionable' as const },
      observationId: 'obs-confirmation', existingObservations: [], committedAtUtc: SIM_01_SNAPSHOT_UTC,
    };
    expect(planCommitDraft(params).observation).toBeNull();
    const committed = planCommitDraft({ ...params, confirmedUnusualValue: true }).observation;
    expect(committed?.entered).toMatchObject({ systolic: 80, diastolic: 120, unit: 'mmHg' });
    expect(committed).toMatchObject({ quality: 'questionable', qualityNote: ENTRY_CONFIRMED_NOTE });
    expect(planCommitDraft({ ...params, existingObservations: [committed!] }).outcome).toBe('already_in_log');
  });

  it('reports the same warnings per CSV row and saves confirmed rows unchanged', () => {
    const header = generateCsvTemplate().split('\n')[0]!;
    const csvText = [header, ...unusual.map(([metric, unit, primary, secondary], index) => [
      `obs-${index}`, metric, 'instant', SIM_01_SNAPSHOT_UTC, 42, '', '', '', '', '', '',
      primary, secondary ?? '', unit, 'Not specified', 'Not specified', 'csv_import', '', '',
    ].join(','))].join('\n');
    const existingObservations = [] as const;
    const preview = parseAndReconcileCsv({
      csvText, existingObservations, profileId: SIM_01_PROFILE_ID, missionEpochUtc: SIM_01_EPOCH_UTC,
      importBatchId: 'batch-unusual', nowUtc: SIM_01_SNAPSHOT_UTC,
    });
    expect(preview.counts.valid).toBe(unusual.length);
    expect(preview.rows.map((row) => row.warning)).toEqual(unusual.map(([metric, unit, primary, secondary]) =>
      validateDraftForReview(draft(metric, unit, { primary, secondary })).warning));
    const params = { preview, existingObservations, conflictChoices: {}, possibleDuplicateChoices: {},
      acknowledgedExclusions: false, nowUtc: SIM_01_SNAPSHOT_UTC };
    expect(buildCsvCommitPlan(params).error).toMatch(/confirm unusual.*row 1/i);
    const plan = buildCsvCommitPlan({ ...params, confirmedUnusualValues: true });
    expect(plan.nextObservations?.map((observation) => observation.entered)).toEqual(preview.rows.map((row) => row.candidate?.entered));
    expect(plan.nextObservations?.every((observation) => observation.qualityNote === ENTRY_CONFIRMED_NOTE)).toBe(true);
  });
});
