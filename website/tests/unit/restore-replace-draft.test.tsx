/**
 * PR #1 review at 215c55b, parity for "reconcile draft retention after profile
 * replacement": replacing the active profile deletes its saved drafts in the
 * same IndexedDB transaction. Settings must say so before the replace (not only
 * for memory-only drafts), the check-in afterwards shows what storage holds, and
 * a failed restore leaves the draft where it was.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from '../../src/state/AppStateContext';
import { CheckInPage } from '../../src/pages/CheckInPage';
import { SettingsPage } from '../../src/pages/SettingsPage';
import { DEFAULT_FAULT_SIMULATION, repository } from '../../src/storage/repository';
import {
  SIM_01_INSIGHTS,
  SIM_01_OBSERVATIONS,
  SIM_01_PREFERENCES,
  SIM_01_PROFILE,
  SIM_01_REFERENCES,
  buildBackupBundle,
} from '../../src/shared';

function Nav() {
  return (
    <nav>
      <Link to="/demo/check-in">Go check-in</Link>
      <Link to="/demo/settings">Go settings</Link>
    </nav>
  );
}

function renderDemo() {
  return render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/demo/check-in']}>
        <Nav />
        <Routes>
          <Route path="/demo/check-in" element={<CheckInPage />} />
          <Route path="/demo/settings" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  );
}

function backupFile(): File {
  const bundle = buildBackupBundle({
    confirmedIncludeAllProfileData: true,
    exportedAtUtc: '2026-11-13T08:00:00Z',
    profile: SIM_01_PROFILE,
    preferences: SIM_01_PREFERENCES,
    observations: SIM_01_OBSERVATIONS.slice(0, 3),
    checkInEvents: [],
    references: SIM_01_REFERENCES,
    insights: SIM_01_INSIGHTS,
  });
  return new File([JSON.stringify(bundle)], 'sim01-backup.json', { type: 'application/json' });
}

async function savedBpDraft() {
  fireEvent.change(await screen.findByLabelText('Systolic (mmHg)'), { target: { value: '129' } });
  fireEvent.change(screen.getByLabelText('Diastolic (mmHg)'), { target: { value: '83' } });
  fireEvent.change(screen.getByLabelText('Observed mission day'), { target: { value: '42' } });
  fireEvent.change(screen.getByLabelText('Observed time (UTC HH:MM)'), { target: { value: '07:20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
  await screen.findByRole('button', { name: 'Add to log' });
  await waitFor(async () => {
    const snap = await repository.loadSnapshot();
    expect(snap.drafts.filter((d) => d.profileId === SIM_01_PROFILE.profileId)).toHaveLength(1);
  });
}

async function stageReplace() {
  fireEvent.click(screen.getByRole('link', { name: 'Go settings' }));
  const input = (await screen.findByText('Inspect backup file to restore'))
    .closest('label')!
    .querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [backupFile()] } });
  await screen.findByRole('button', { name: 'Confirm restore' });
  expect(screen.queryByTestId('restore-replace-draft')).toBeNull();
  fireEvent.click(screen.getByRole('radio', { name: /Replace active profile/i }));
}

async function storedDrafts() {
  const snap = await repository.loadSnapshot();
  return snap.drafts.filter((d) => d.profileId === SIM_01_PROFILE.profileId);
}

beforeEach(async () => {
  // Seed before rendering so the first-run seed can't clear the test's draft.
  await repository.resetDemoAtomically();
});
afterEach(() => {
  vi.restoreAllMocks();
  repository.setFaultSimulation({ ...DEFAULT_FAULT_SIMULATION });
  cleanup();
});

describe('Website parity: replacing the active profile with an open saved draft', () => {
  it('warns before the replace and shows storage afterwards', async () => {
    renderDemo();
    await savedBpDraft();
    await stageReplace();

    const notice = screen.getByTestId('restore-replace-draft');
    expect(notice).toHaveTextContent(/removes its open drafts/);
    expect(notice).toHaveTextContent(/Blood pressure/);
    expect(notice).toHaveTextContent(/saved in this browser will be deleted/);
    expect(screen.getByRole('button', { name: 'Download recovery JSON' })).toBeInTheDocument();
    expect(screen.getByText(/including its open drafts/)).toBeInTheDocument();

    // Cancel: back to a separate restore, the draft is untouched.
    fireEvent.click(screen.getByRole('radio', { name: /separate synthetic profile/i }));
    expect(screen.queryByTestId('restore-replace-draft')).toBeNull();
    expect(await storedDrafts()).toHaveLength(1);

    fireEvent.click(screen.getByRole('radio', { name: /Replace active profile/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirm replacing active synthetic profile/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    await screen.findByText(/^Restored into /);
    expect(await storedDrafts()).toHaveLength(0);

    fireEvent.click(screen.getByRole('link', { name: 'Go check-in' }));
    expect(await screen.findByLabelText('Systolic (mmHg)')).toHaveValue('');
  }, 20000);

  it('a failed restore leaves the saved draft in place', async () => {
    renderDemo();
    await savedBpDraft();
    await stageReplace();
    fireEvent.click(screen.getByRole('checkbox', { name: /Confirm replacing active synthetic profile/i }));
    vi.spyOn(repository, 'restoreBackupAtomically').mockRejectedValue(
      new Error('Transaction aborted. No changes made.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    await screen.findByText('Transaction aborted. No changes made.');
    expect(screen.getByTestId('restore-replace-draft')).toBeInTheDocument();
    expect(await storedDrafts()).toHaveLength(1);

    fireEvent.click(screen.getByRole('link', { name: 'Go check-in' }));
    expect(await screen.findByText(/129\/83/)).toBeInTheDocument();
  }, 20000);
});
