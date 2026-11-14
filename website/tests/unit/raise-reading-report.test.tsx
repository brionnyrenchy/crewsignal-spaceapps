import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { OverviewPage } from '../../src/pages/OverviewPage';
import { ReportsPage } from '../../src/pages/ReportsPage';
import { AppStateProvider } from '../../src/state/AppStateContext';
import { repository } from '../../src/storage/repository';

afterEach(cleanup);

it('opens a private report draft with the readings shown in the Overview prompt', async () => {
  await repository.resetDemoAtomically();
  render(
    <AppStateProvider>
      <MemoryRouter initialEntries={['/demo']}>
        <Routes>
          <Route path="/demo" element={<OverviewPage />} />
          <Route path="/demo/reports" element={<ReportsPage />} />
        </Routes>
      </MemoryRouter>
    </AppStateProvider>,
  );

  const prompt = await screen.findByRole('region', { name: 'Consider raising this' });
  expect(within(prompt).getAllByText(/Reference version 1/)).toHaveLength(4);
  expect(within(prompt).getByText(/No mission contact route is configured/)).toBeInTheDocument();
  fireEvent.click(within(prompt).getByRole('link', { name: 'Open report draft' }));

  expect(await screen.findByRole('heading', { name: /Report preview \(4 observations across 2 types\)/ })).toBeInTheDocument();
  expect(screen.getByText(/Mood: Excluded · Notes: Excluded/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: 'Start a general report' }));
  expect(await screen.findByRole('heading', { name: /Report preview \(10 observations across 4 types\)/ })).toBeInTheDocument();
});
