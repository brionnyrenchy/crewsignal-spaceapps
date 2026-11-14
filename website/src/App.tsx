import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from './state/AppStateContext';
import { AppShell } from './components/AppShell';
import { LandingPage } from './pages/LandingPage';
import { OverviewPage } from './pages/OverviewPage';
import { CheckInPage } from './pages/CheckInPage';
import { TrendsPage } from './pages/TrendsPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { ActionsPage } from './pages/ActionsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SourcesPage } from './pages/SourcesPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { MorePage } from './pages/MorePage';

export function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/demo" element={<AppShell />}>
            <Route index element={<OverviewPage />} />
            <Route path="check-in" element={<CheckInPage />} />
            <Route path="trends" element={<TrendsPage />} />
            <Route path="explorer" element={<ExplorerPage />} />
            <Route path="actions" element={<ActionsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="sources/:sourceId" element={<SourcesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="more" element={<MorePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AppStateProvider>
  );
}
export default App;
