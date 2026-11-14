import React from 'react';
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppStateProvider, useAppState } from '../../src/state/AppStateContext';
import { CheckInPage } from '../../src/pages/CheckInPage';
import { DEFAULT_FAULT_SIMULATION, repository } from '../../src/storage/repository';

function OverviewStub() {
  const { profileObservations, workingDrafts } = useAppState();
  return (
    <div>
      <p data-testid="count">{profileObservations.length}</p>
      <p data-testid="working">{Object.keys(workingDrafts).length}</p>
      <Link to="/demo/check-in">Start check-in</Link>
    </div>
  );
}

function renderDemo() {
  return render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/demo']}>
        <Routes>
          <Route path="/demo" element={<OverviewStub />} />
          <Route path="/demo/check-in" element={<CheckInPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  );
}

async function fillBloodPressure(sys: string, dia: string, time: string) {
  fireEvent.change(await screen.findByLabelText('Systolic (mmHg)'), { target: { value: sys } });
  fireEvent.change(screen.getByLabelText('Diastolic (mmHg)'), { target: { value: dia } });
  fireEvent.change(screen.getByLabelText('Observed mission day'), { target: { value: '42' } });
  fireEvent.change(screen.getByLabelText('Observed time (UTC HH:MM)'), { target: { value: time } });
  fireEvent.click(screen.getByRole('button', { name: 'Next: Review' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Add to log' }));
}

afterEach(() => {
  repository.setFaultSimulation({ ...DEFAULT_FAULT_SIMULATION });
  cleanup();
});

describe('Check-in save confirmation (PR #1 re-review P1)', () => {
  it('Check stored log clears the confirmed draft; the next check-in starts blank and adds one entry', async () => {
    renderDemo();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('11'));

    // One ordinary entry first so the count matches the review repro (13 -> 14).
    fireEvent.click(screen.getByRole('link', { name: 'Start check-in' }));
    await fillBloodPressure('119', '77', '07:17');
    await screen.findByRole('heading', { name: 'Added to your log' });
    fireEvent.click(screen.getAllByRole('link', { name: 'Back to overview' })[0]!);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('12'));

    // Lost acknowledgement + failed verification read: the outcome is unconfirmed.
    repository.setFaultSimulation({ failCommitAckAfterWrite: true, failPostCommitRead: true });
    fireEvent.click(screen.getByRole('link', { name: 'Start check-in' }));
    await fillBloodPressure('128', '82', '07:18');
    await screen.findByRole('heading', { name: 'Addition unconfirmed' });

    // Still recoverable: a failed check keeps the unconfirmed receipt and its action.
    fireEvent.click(screen.getByRole('button', { name: 'Check stored log' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Addition unconfirmed' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Check stored log' })).toBeEnabled();

    // Log reads work again: the explicit check confirms the saved entry.
    repository.setFaultSimulation({ ...DEFAULT_FAULT_SIMULATION });
    fireEvent.click(screen.getByRole('button', { name: 'Check stored log' }));
    await screen.findByText('Already in your log');

    // Overview: 13 entries and no draft left in the working set.
    fireEvent.click(screen.getAllByRole('link', { name: 'Back to overview' })[0]!);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('13'));
    expect(screen.getByTestId('working')).toHaveTextContent('0');

    // A new check-in starts blank and adds exactly one new observation.
    fireEvent.click(screen.getByRole('link', { name: 'Start check-in' }));
    expect(await screen.findByLabelText('Systolic (mmHg)')).toHaveValue('');
    await fillBloodPressure('132', '84', '07:19');
    await screen.findByRole('heading', { name: 'Added to your log' });
    expect(screen.queryByText('Already in your log')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('link', { name: 'Back to overview' })[0]!);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('14'));

    const snapshot = await repository.loadSnapshot();
    const bp = snapshot.observations
      .filter((o) => o.metricId === 'blood_pressure' && o.sourceDraftId)
      .map((o) => o.sourceDraftId);
    expect(new Set(bp).size).toBe(bp.length);
  });
});
