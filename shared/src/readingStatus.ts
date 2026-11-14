import type { Observation } from './contracts';
import type { ObservationComparisonResult } from './references';
import type { ScheduleFreshnessResult } from './timing';

export const READING_STATUSES = {
  near: { label: 'Near reference', icon: '=', description: 'Matches the personal reference at the comparison precision.' },
  differs: { label: 'Differs from reference', icon: '≠', description: 'The comparison shows a difference from the personal reference.' },
  no_reference: { label: 'No reference', icon: '?', description: 'A comparable personal reference is unavailable. Mood uses a self-report scale.' },
  stale: { label: 'Stale', icon: '◷', description: 'The optional check-in interval has elapsed since this reading.' },
  not_logged: { label: 'Not logged', icon: '—', description: 'There is no saved reading for this indicator.' },
} as const;

export type ReadingStatus = keyof typeof READING_STATUSES;
export const READING_STATUS_ORDER = Object.keys(READING_STATUSES) as ReadingStatus[];

export function getReadingStatus(
  observation: Observation | null | undefined,
  comparison: ObservationComparisonResult | null,
  schedule: ScheduleFreshnessResult,
): ReadingStatus {
  if (!observation) return 'not_logged';
  if (observation.metricId === 'mood') return 'no_reference';
  if (schedule.status === 'past_interval') return 'stale';
  if (!comparison?.comparisonAvailable || comparison.deltaNumeric === null) return 'no_reference';
  return comparison.deltaNumeric === 0 && (comparison.diastolicDeltaNumeric ?? 0) === 0 ? 'near' : 'differs';
}
