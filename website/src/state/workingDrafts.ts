import type { CheckInDraft } from '../shared';

/**
 * Creates the ID for a genuinely new check-in draft. Every new draft gets its own
 * ID so the shared idempotence rule (a repeated draft ID is the same write) only
 * applies to retries and recovery of that draft, never to the next check-in.
 */
export function newDraftId(profileId: string, metricId: string): string {
  const cryptoRef = (globalThis as { crypto?: Crypto }).crypto;
  const unique =
    cryptoRef && typeof cryptoRef.randomUUID === 'function'
      ? cryptoRef.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `draft-${profileId}-${metricId}-${unique}`;
}

/** True when the user has typed or chosen a value that would be lost with the draft. */
export function draftHasUserInput(draft: CheckInDraft): boolean {
  const f = draft.rawFields;
  const typed = [f.primary, f.secondary, f.hours, f.minutes].some(
    (v) => typeof v === 'string' && v.trim() !== '',
  );
  return typed || f.moodScore !== null || draft.note.trim() !== '';
}

/** A working draft only exists in this tab's memory and holds user input. */
export function isUnretainedDraft(draft: CheckInDraft): boolean {
  return (
    draft.retentionStatus !== 'retained' &&
    draft.commitStatus !== 'committed' &&
    draftHasUserInput(draft)
  );
}

export function workingDraftKey(profileId: string, metricId: string): string {
  return `${profileId}|${metricId}`;
}
