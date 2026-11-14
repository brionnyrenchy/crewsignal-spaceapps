import { AppProvider, useApp } from "./state/AppContext";
import { AppShell } from "./components/AppShell";
import { AppModals } from "./components/AppModals";
import { OverviewRoute } from "./routes/OverviewRoute";
import { CheckInRoute } from "./routes/CheckInRoute";
import { ExplorerRoute } from "./routes/ExplorerRoute";
import { TrendsRoute } from "./routes/TrendsRoute";
import { ActionsRoute } from "./routes/ActionsRoute";
import { SourcesRoute } from "./routes/SourcesRoute";
import { ReportsRoute } from "./routes/ReportsRoute";
import { SettingsRoute } from "./routes/SettingsRoute";
import { HelpRoute } from "./routes/HelpRoute";

function RouteSwitch() {
  const { route } = useApp();

  switch (route) {
    case "overview":
      return <OverviewRoute />;
    case "check_in":
      return <CheckInRoute />;
    case "explorer":
      return <ExplorerRoute />;
    case "trends":
      return <TrendsRoute />;
    case "actions":
      return <ActionsRoute />;
    case "sources":
      return <SourcesRoute />;
    case "reports":
      return <ReportsRoute />;
    case "settings":
      return <SettingsRoute />;
    case "help":
      return <HelpRoute />;
    default:
      return <OverviewRoute />;
  }
}

export function App() {
  return (
    <AppProvider>
      <AppShell>
        <RouteSwitch />
      </AppShell>
      <AppModals />
    </AppProvider>
  );
}

export default App;
