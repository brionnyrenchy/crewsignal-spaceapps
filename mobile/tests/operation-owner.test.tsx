import React from 'react';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  CrewSignalProvider,
  useCrewSignal,
  type CrewSignalContextValue,
} from '../src/state/CrewSignalContext';
import { backupIdentityOf, draftSignatureOf } from '../src/state/backupIdentity';
import type { NativeFileActionResult, PlatformIoAdapter } from '../src/platform/files';
import { NodeSqliteDriver } from '../src/storage/nodeDriver';
import { CrewSignalSqliteStore } from '../src/storage/sqliteStore';
import { EXAMPLE_BACKUP_BUNDLE, SIM_01_OPTIONAL_BP_DRAFT } from '../src/shared/src';

/**
 * These tests drive the provider's actions directly, the way a screen would,
 * with no screen mounted. That is the point: the operation owner must not depend
 * on a screen staying alive, and some conflicting presses (a second Replace, a
 * safety backup, a demo reset) cannot be reached through the UI while an
 * operation runs because the buttons are disabled. Holding SQLite reads and
 * file writes open in the test makes each ordering deterministic.
 */

interface SavedFile {
  filename: string;
  content: string;
  chooseDestination?: boolean;
  avoidOverwrite?: boolean;
}

function createIo() {
  const saved: SavedFile[] = [];
  const io: PlatformIoAdapter = {
    saveTextFile: async (p): Promise<NativeFileActionResult> => {
      saved.push({
        filename: p.filename,
        content: p.content,
        chooseDestination: p.chooseDestination,
        avoidOverwrite: p.avoidOverwrite,
      });
      return { outcome: 'saved', label: 'File saved', detail: `Saved ${p.filename}.`, savedAs: p.filename };
    },
    shareTextFile: async () => ({ outcome: 'shared', label: 'Shared', detail: 'Shared.' }),
    pickTextFile: async () => ({ outcome: 'cancelled', label: 'Cancelled', detail: 'None.' }),
    printReportHtml: async () => ({ outcome: 'printed', label: 'Printed', detail: 'Printed.' }),
    openExternalUrl: async () => ({ ok: true, message: 'Opened.' }),
    copyToClipboard: async () => true,
  };
  return { io, saved };
}

const isConfirmed = (call: unknown[]) =>
  (call[0] as { confirmedReplace?: boolean } | undefined)?.confirmedReplace === true;

describe('Provider-owned backup and restore operation guard', () => {
  const cleanups: Array<() => Promise<void>> = [];

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    while (cleanups.length > 0) {
      const fn = cleanups.pop();
      if (fn) await fn();
    }
  });

  async function mount(io: PlatformIoAdapter) {
    const driver = new NodeSqliteDriver(':memory:');
    const store = new CrewSignalSqliteStore(driver);
    cleanups.push(() => driver.close());
    const ctx: { current: CrewSignalContextValue | null } = { current: null };
    function Probe() {
      ctx.current = useCrewSignal();
      return null;
    }
    await render(
      <CrewSignalProvider store={store} io={io} clockOverrideUtc="2026-11-13T07:18:00Z">
        <Probe />
      </CrewSignalProvider>,
    );
    await waitFor(() => expect(ctx.current?.isLoading).toBe(false));
    const api = () => ctx.current as CrewSignalContextValue;
    return { store, api };
  }

  /** A personal profile with a logged reading (121/79 and a note) and one open draft. */
  async function seedTarget(
    store: CrewSignalSqliteStore,
    api: () => CrewSignalContextValue,
    label: string,
  ) {
    let profileId = '';
    await act(async () => {
      const profile = await api().createPersonalProfile({
        label,
        missionEpochUtc: '2026-11-01T00:00:00Z',
      });
      profileId = profile.profileId;
    });
    const base = { ...SIM_01_OPTIONAL_BP_DRAFT, profileId, mode: 'personal' as const };
    const logged = await store.commitDraftObservation({
      draft: { ...base, draftId: `logged-${profileId}`, note: 'target logged note' },
      committedAtUtc: '2026-11-13T07:20:00Z',
    });
    expect(logged.outcome).toBe('insert');
    const draft = { ...base, draftId: `open-${profileId}`, observedAtUtc: '2026-11-13T08:00:00Z' };
    await store.saveDraft(draft);
    await act(async () => {
      await api().reload();
    });
    return { profileId, draft };
  }

  /** Starts an action inside act() without waiting for it, so it can be held open. */
  async function begin<T>(start: () => Promise<T>): Promise<{ settled: Promise<T> }> {
    let settled!: Promise<T>;
    await act(async () => {
      settled = start();
    });
    return { settled };
  }

  /** Runs a provider action inside act() so the rendered context reflects its outcome. */
  async function inAct<T>(fn: () => Promise<T>): Promise<T> {
    let out!: T;
    await act(async () => {
      out = await fn();
    });
    return out;
  }

  const records = (store: CrewSignalSqliteStore, id: string) =>
    store.loadProfileSnapshot(id, { lockReferences: false });

  /** Two personal profiles: Alpha (inactive, the target) and Bravo (active). */
  async function twoProfiles(io: PlatformIoAdapter) {
    const { store, api } = await mount(io);
    const alpha = await seedTarget(store, api, 'Commander Alpha');
    const bravo = await seedTarget(store, api, 'Commander Bravo');
    const identity = backupIdentityOf(EXAMPLE_BACKUP_BUNDLE);
    const signatureOf = async (id: string) =>
      draftSignatureOf(await api().loadDraftsForProfile(id, { strict: true }));
    const replace = async (targetId: string, signature?: string) => {
      const draftSignature = signature ?? (await signatureOf(targetId));
      return inAct(() =>
        api().restoreBackup({
          rawBackup: EXAMPLE_BACKUP_BUNDLE,
          destination: 'replace_existing',
          targetExistingProfileId: targetId,
          confirmedReplace: true,
          expected: { backupIdentity: identity, draftSignature },
        }),
      );
    };
    return { store, api, alpha, bravo, identity, signatureOf, replace };
  }

  test('same tick, every direction: one operation runs, the rest are refused at once, and nothing is queued', async () => {
    const { io, saved } = createIo();
    const { store, api, alpha, bravo, identity } = await twoProfiles(io);
    const before = await records(store, alpha.profileId);
    const bravoBefore = await records(store, bravo.profileId);

    const realRead = store.readProfileBackupData.bind(store);
    let releaseRead: () => void = () => {};
    jest.spyOn(store, 'readProfileBackupData').mockImplementationOnce(
      (id) =>
        new Promise((resolve, reject) => {
          releaseRead = () => void realRead(id).then(resolve, reject);
        }),
    );
    const restoreSpy = jest.spyOn(store, 'restoreBackupBundle');
    const resetSpy = jest.spyOn(store, 'resetDemoProfile');
    const deleteSpy = jest.spyOn(store, 'deletePersonalProfile');

    // One tick: the safety backup, then Replace, Demo reset, Personal deletion
    // and a backup of another profile, with no render in between.
    let results: Array<Promise<unknown>> = [];
    await act(async () => {
      const a = api();
      results = [
        a.saveSafetyBackup({ profileId: alpha.profileId, backupIdentity: identity, consent: true }),
        a.restoreBackup({
          rawBackup: EXAMPLE_BACKUP_BUNDLE,
          destination: 'replace_existing',
          targetExistingProfileId: alpha.profileId,
          confirmedReplace: true,
          expected: { backupIdentity: identity, draftSignature: 'dr-1-placeholder' },
        }),
        a.resetDemoScenario(),
        a.deletePersonalProfile(alpha.profileId),
        a.saveSafetyBackup({ profileId: bravo.profileId, backupIdentity: identity, consent: true }),
      ];
    });
    const [first, ...rest] = results;
    const refused = await Promise.all(rest);
    expect(refused[0]).toMatchObject({ ok: false, busy: true });
    expect(refused[1]).toMatchObject({ ok: false, busy: true });
    expect(refused[2]).toMatchObject({ ok: false, busy: true });
    expect(refused[3]).toMatchObject({ status: 'busy', operationId: 0, savedAs: null });
    expect(api().activeOperation).toMatchObject({ kind: 'safety_backup', profileId: alpha.profileId });
    expect(restoreSpy.mock.calls.filter(isConfirmed)).toHaveLength(0);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(await records(store, alpha.profileId)).toEqual(before);

    await act(async () => releaseRead());
    const outcome = (await first) as { status: string; operationId: number; profileId: string };
    expect(outcome).toMatchObject({ status: 'saved', profileId: alpha.profileId });
    expect(api().activeOperation).toBeNull();
    expect(api().lastSavedSafetyBackup).toMatchObject({
      operationId: outcome.operationId,
      profileId: alpha.profileId,
      backupIdentity: identity,
    });

    // The refused actions were dropped, not queued behind the one that ran.
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    expect(saved).toHaveLength(1);
    const file = JSON.parse(saved[0]!.content);
    expect(file.profile.profileId).toBe(alpha.profileId);
    expect(file.preferences.activeProfileId).toBe(alpha.profileId);
    expect(file.observations.map((o: { observationId: string }) => o.observationId)).toEqual(
      before.observations.map((o) => o.observationId),
    );
    expect(saved[0]!.content).toContain('target logged note');
    expect(saved[0]!.chooseDestination).toBe(true);
    expect(saved[0]!.avoidOverwrite).toBe(true);
    expect(restoreSpy.mock.calls.filter(isConfirmed)).toHaveLength(0);
    expect(resetSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(await records(store, alpha.profileId)).toEqual(before);
    expect(await records(store, bravo.profileId)).toEqual(bravoBefore);
  });

  test('reverse order: a replace held in flight refuses a second Replace, a safety backup, a reset and a deletion, with no screen mounted', async () => {
    const { io, saved } = createIo();
    const { store, api, alpha, bravo, identity, signatureOf, replace } = await twoProfiles(io);
    const bravoBefore = await records(store, bravo.profileId);
    const signature = await signatureOf(alpha.profileId);

    const realRestore = store.restoreBackupBundle.bind(store);
    let releaseRestore: () => void = () => {};
    const restoreSpy = jest.spyOn(store, 'restoreBackupBundle').mockImplementation((p) =>
      p.confirmedReplace === true
        ? new Promise((resolve, reject) => {
            releaseRestore = () => void realRestore(p).then(resolve, reject);
          })
        : realRestore(p),
    );
    const readSpy = jest.spyOn(store, 'readProfileBackupData');
    const resetSpy = jest.spyOn(store, 'resetDemoProfile');
    const deleteSpy = jest.spyOn(store, 'deletePersonalProfile');

    const running = await begin(() => replace(alpha.profileId, signature));
    await waitFor(() => expect(restoreSpy.mock.calls.filter(isConfirmed)).toHaveLength(1));
    expect(api().activeOperation).toMatchObject({ kind: 'replace', profileId: alpha.profileId });

    // The operation is held by the provider, so these refusals do not depend on a screen.
    expect(await replace(alpha.profileId, signature)).toMatchObject({ ok: false, busy: true });
    expect(
      await inAct(() =>
        api().restoreBackup({
        rawBackup: EXAMPLE_BACKUP_BUNDLE,
        destination: 'replace_existing',
        targetExistingProfileId: alpha.profileId,
        }),
      ),
    ).toMatchObject({ ok: false, busy: true });
    expect(
      await inAct(() =>
        api().saveSafetyBackup({ profileId: alpha.profileId, backupIdentity: identity, consent: true }),
      ),
    ).toMatchObject({ status: 'busy', savedAs: null });
    expect(await inAct(() => api().resetDemoScenario())).toMatchObject({ ok: false, busy: true });
    expect(await inAct(() => api().deletePersonalProfile(alpha.profileId))).toMatchObject({ ok: false, busy: true });
    expect(restoreSpy.mock.calls.filter(isConfirmed)).toHaveLength(1);
    expect(readSpy).not.toHaveBeenCalled();
    expect(resetSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(await records(store, bravo.profileId)).toEqual(bravoBefore);

    let done!: Awaited<typeof running.settled>;
    await act(async () => {
      releaseRestore();
      done = await running.settled;
    });
    expect(done).toMatchObject({ ok: true, ranOperation: true, restoredProfileId: alpha.profileId });
    expect(api().activeOperation).toBeNull();
    expect(api().restoreOutcome).toMatchObject({ ok: true, kind: 'restored' });
    expect(restoreSpy.mock.calls.filter(isConfirmed)).toHaveLength(1);
    // Alpha now holds the backup's records; its superseded draft is gone; Bravo is untouched.
    expect((await records(store, alpha.profileId)).observations).toHaveLength(
      EXAMPLE_BACKUP_BUNDLE.observations.length,
    );
    expect((await store.loadProfileDrafts(alpha.profileId)).length).toBe(0);
    expect((await store.loadProfileDrafts(bravo.profileId)).length).toBe(1);
    expect(await records(store, bravo.profileId)).toEqual(bravoBefore);

    // The lock is released: the next operation is accepted and sees the replaced records.
    const next = await inAct(() =>
      api().saveSafetyBackup({ profileId: alpha.profileId, backupIdentity: identity, consent: true }),
    );
    expect(next.status).toBe('saved');
    expect(JSON.parse(saved[0]!.content).observations).toHaveLength(
      EXAMPLE_BACKUP_BUNDLE.observations.length,
    );
  });

  test('a stale or missing target at confirmation writes nothing and asks for a fresh preview', async () => {
    const { io, saved } = createIo();
    const { store, api, alpha, bravo, identity, signatureOf, replace } = await twoProfiles(io);
    const before = await records(store, alpha.profileId);
    const bravoBefore = await records(store, bravo.profileId);
    const restoreSpy = jest.spyOn(store, 'restoreBackupBundle');

    // No preview at all.
    const noPreview = await inAct(() =>
      api().restoreBackup({
      rawBackup: EXAMPLE_BACKUP_BUNDLE,
      destination: 'replace_existing',
      targetExistingProfileId: alpha.profileId,
      confirmedReplace: true,
      }),
    );
    expect(noPreview).toMatchObject({ ok: false, stale: true });
    expect(api().restoreOutcome?.kind).toBe('stale');

    // A different backup file than the one previewed.
    const previewed = await signatureOf(alpha.profileId);
    const other = await inAct(() =>
      api().restoreBackup({
      rawBackup: { ...EXAMPLE_BACKUP_BUNDLE, exportedAtUtc: '2026-11-14T00:00:00Z' },
      destination: 'replace_existing',
      targetExistingProfileId: alpha.profileId,
      confirmedReplace: true,
      expected: { backupIdentity: identity, draftSignature: previewed },
      }),
    );
    expect(other).toMatchObject({ ok: false, stale: true });

    // The target's drafts change between the preview and the confirmation.
    await store.saveDraft({ ...alpha.draft, draftId: 'late-draft', observedAtUtc: '2026-11-13T09:00:00Z' });
    const stale = await replace(alpha.profileId, previewed);
    expect(stale).toMatchObject({ ok: false, stale: true, ranOperation: true });
    expect(api().restoreOutcome).toMatchObject({ ok: false, kind: 'stale' });
    expect(restoreSpy.mock.calls.filter(isConfirmed)).toHaveLength(0);
    expect((await records(store, alpha.profileId)).observations).toEqual(before.observations);
    expect((await store.loadProfileDrafts(alpha.profileId)).map((d) => d.draftId).sort()).toEqual(
      [alpha.draft.draftId, 'late-draft'].sort(),
    );
    expect(api().activeOperation).toBeNull();

    // A target the snapshot does not know is refused, never replaced by the backup's own profile ID.
    const unknown = await inAct(() =>
      api().restoreBackup({
      rawBackup: EXAMPLE_BACKUP_BUNDLE,
      destination: 'replace_existing',
      targetExistingProfileId: 'no-such-profile',
      confirmedReplace: true,
      expected: { backupIdentity: identity, draftSignature: previewed },
      }),
    );
    expect(unknown).toMatchObject({ ok: false, targetMissing: true });
    expect(api().restoreOutcome?.kind).toBe('target_missing');

    // A target that vanishes between the preview and the write.
    const gone = await seedTarget(store, api, 'Commander Gone');
    await store.discardDraft(gone.profileId, gone.draft.draftId);
    const goneSignature = await signatureOf(gone.profileId);
    await store.deletePersonalProfile(gone.profileId);
    const idsBefore = (await store.loadAppSnapshot()).profiles.map((p) => p.profileId).sort();
    const vanished = await replace(gone.profileId, goneSignature);
    expect(vanished).toMatchObject({ ok: false, targetMissing: true, ranOperation: true });
    expect(api().restoreOutcome?.kind).toBe('target_missing');
    // Nothing was created under the missing target's ID or the source bundle's profile ID.
    const idsAfter = (await store.loadAppSnapshot()).profiles.map((p) => p.profileId).sort();
    expect(idsAfter).toEqual(idsBefore);
    expect(idsAfter).not.toContain(gone.profileId);

    expect(saved).toHaveLength(0);
    expect((await records(store, alpha.profileId)).observations).toEqual(before.observations);
    expect(await records(store, bravo.profileId)).toEqual(bravoBefore);

    // After a fresh preview of the changed drafts, the replace goes through for Alpha only.
    await act(async () => {
      await api().reload();
    });
    const fresh = await replace(alpha.profileId);
    expect(fresh).toMatchObject({ ok: true, restoredProfileId: alpha.profileId });
    expect((await store.loadProfileDrafts(alpha.profileId)).length).toBe(0);
    expect(await records(store, bravo.profileId)).toEqual(bravoBefore);
  });

  test('a rolled-back restore keeps the original drafts, and a post-commit refresh failure is reported separately', async () => {
    const { io } = createIo();
    const { store, api, alpha, bravo, replace } = await twoProfiles(io);
    const before = await records(store, alpha.profileId);
    const bravoBefore = await records(store, bravo.profileId);

    // The write fails and rolls back.
    const realRestore = store.restoreBackupBundle.bind(store);
    const failing = jest
      .spyOn(store, 'restoreBackupBundle')
      .mockImplementation((p) => realRestore({ ...p, simulateWriteFailure: true }));
    const rolledBack = await replace(alpha.profileId);
    expect(rolledBack).toMatchObject({ ok: false, ranOperation: true });
    expect(api().restoreOutcome?.kind).toBe('rolled_back');
    expect(api().restoreOutcome?.message).toMatch(/Nothing was changed/);
    expect(await records(store, alpha.profileId)).toEqual(before);
    expect((await store.loadProfileDrafts(alpha.profileId)).length).toBe(1);
    failing.mockRestore();

    // The write commits, then reloading the screen fails: committed, not rolled back.
    jest.spyOn(store, 'loadAppSnapshot').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const committed = await replace(alpha.profileId);
    expect(committed).toMatchObject({ ok: true, refreshFailed: true, ranOperation: true });
    expect(api().restoreOutcome).toMatchObject({ ok: true, kind: 'refresh_failed' });
    expect(api().restoreOutcome?.message).toMatch(/committed and was not rolled back/);
    expect((await records(store, alpha.profileId)).observations).toHaveLength(
      EXAMPLE_BACKUP_BUNDLE.observations.length,
    );
    expect((await store.loadProfileDrafts(alpha.profileId)).length).toBe(0);
    expect(await records(store, bravo.profileId)).toEqual(bravoBefore);
    expect(api().activeOperation).toBeNull();
  });

  test('every safety-backup outcome is reported as it happened, releases the lock, and only a written file counts', async () => {
    const { io, saved } = createIo();
    const { store, api, alpha, identity } = await twoProfiles(io);
    const before = await records(store, alpha.profileId);
    const save = jest.spyOn(io, 'saveTextFile');
    const run = (consent = true) =>
      inAct(() =>
        api().saveSafetyBackup({ profileId: alpha.profileId, backupIdentity: identity, consent }),
      );

    // No consent: nothing starts.
    const declined = await run(false);
    expect(declined).toMatchObject({ status: 'no_consent', operationId: 0 });
    expect(save).not.toHaveBeenCalled();
    expect(api().activeOperation).toBeNull();

    const cases: Array<[NativeFileActionResult | Error, string]> = [
      [{ outcome: 'cancelled', label: 'Cancelled', detail: 'Folder selection was cancelled before saving.' }, 'cancelled'],
      [{ outcome: 'access_refused', label: 'File access refused', detail: 'Permission to write was denied.' }, 'refused'],
      [{ outcome: 'write_failed', label: 'Write failed', detail: 'Disk full.' }, 'failed'],
      [new Error('EIO'), 'failed'],
    ];
    for (const [result, status] of cases) {
      if (result instanceof Error) save.mockRejectedValueOnce(result);
      else save.mockResolvedValueOnce(result);
      const out = await run();
      expect(out.status).toBe(status);
      expect(out.message).toMatch(/^Safety backup not saved for Commander Alpha\./);
      expect(api().lastSavedSafetyBackup).toBeNull();
      expect(api().safetyBackupOutcome).toMatchObject({ status, profileId: alpha.profileId });
      expect(api().activeOperation).toBeNull();
    }
    expect(saved).toHaveLength(0);

    // The data cannot be read: reported as a read failure, nothing is written.
    jest.spyOn(store, 'readProfileBackupData').mockRejectedValueOnce(new Error('SQLITE_IOERR'));
    const unread = await run();
    expect(unread.status).toBe('read_failed');
    expect(api().lastSavedSafetyBackup).toBeNull();
    expect(saved).toHaveLength(0);

    // A target that no longer exists cannot be backed up.
    const missing = await inAct(() =>
      api().saveSafetyBackup({
      profileId: 'no-such-profile',
      backupIdentity: identity,
      consent: true,
    }),
    );
    expect(missing.status).toBe('read_failed');
    expect(saved).toHaveLength(0);

    // A written file is the only thing that counts, tied to this operation and profile.
    const ok = await run();
    expect(ok).toMatchObject({
      status: 'saved',
      profileId: alpha.profileId,
      savedAs: `crewsignal-backup-${alpha.profileId}.json`,
    });
    expect(api().lastSavedSafetyBackup).toMatchObject({
      operationId: ok.operationId,
      profileId: alpha.profileId,
    });
    expect(saved[0]!.content).toContain('target logged note');
    expect(await records(store, alpha.profileId)).toEqual(before);
  });
});
