import { isUnretainedDraft, workingDraftKey } from './workingDrafts';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  METRIC_ORDER,
  SIM_01_PREFERENCES,
  SIM_01_PROFILE_ID,
  computeMissionDay,
  countCoveredMetricTypes,
  evaluateMetricSchedule,
  getLatestObservationsByMetric,
  type AppPreferences,
  type AppearancePreference,
  type CheckInDraft,
  type CheckInEvent,
  type CsvConflictChoice,
  type CsvPossibleDuplicateChoice,
  type CsvReconciliationPreview,
  type EvidenceReference,
  type GlucoseUnit,
  type Insight,
  type MetricId,
  type Observation,
  type PersonalReference,
  type ProfileConfig,
  type ReferenceValue,
  type ScheduleFreshnessResult,
  type TemperatureUnit,
} from '../shared';
import {
  repository,
  type CommitDraftOutcome,
  type StorageFaultSimulation,
  type WorkspaceSnapshot,
} from '../storage/repository';
import {
  createPwaController,
  type OfflineDiagnostics,
  type PersistenceStatus,
  type PwaController,
} from '../storage/pwa';

export interface AppStateContextValue {
  loading: boolean;
  loadError: string | null;
  snapshot: WorkspaceSnapshot | null;
  preferences: AppPreferences;
  resolvedTheme: 'light' | 'dark';
  profiles: ProfileConfig[];
  activeProfile: ProfileConfig | null;
  profileObservations: Observation[];
  profileDrafts: CheckInDraft[];
  profileEvents: CheckInEvent[];
  profileReferences: PersonalReference[];
  profileInsights: Insight[];
  sources: EvidenceReference[];
  latestByMetric: Record<MetricId, Observation | null>;
  currentMissionDay: number;
  scheduleStatusByMetric: Record<MetricId, ScheduleFreshnessResult>;
  coveredMetricCount: number;
  hasUncommittedDraft: boolean;
  /** In-progress drafts held for this tab so route and metric changes never drop them. */
  workingDrafts: WorkingDraftMap;
  rememberWorkingDraft: (draft: CheckInDraft) => void;
  forgetWorkingDraft: (profileId: string, metricId: MetricId) => void;
  /** Drafts with input that exist only in this tab's memory (storage failed). */
  unretainedDrafts: CheckInDraft[];
  offlineDiagnostics: OfflineDiagnostics;
  updateModalOpen: boolean;
  setUpdateModalOpen: (open: boolean) => void;
  simulatedUpdatePending: boolean;
  setSimulatedUpdatePending: (pending: boolean) => void;
  offlineSetupIncompleteOverride: boolean;
  setOfflineSetupIncompleteOverride: (flag: boolean) => void;
  faultSimulation: StorageFaultSimulation;
  setFaultSimulation: (next: Partial<StorageFaultSimulation>) => void;
  announcement: string;
  announce: (msg: string) => void;
  reloadSnapshot: () => Promise<void>;
  setAppearance: (appearance: AppearancePreference) => Promise<void>;
  setDisplayUnits: (units: {
    blood_glucose: GlucoseUnit;
    body_temperature: TemperatureUnit;
  }) => Promise<void>;
  setHelpMode: (mode: AppPreferences['helpMode']) => Promise<void>;
  switchProfile: (profileId: string) => Promise<void>;
  saveDraft: (draft: CheckInDraft) => Promise<CheckInDraft>;
  discardDraft: (draftId: string) => Promise<void>;
  discardAllProfileDrafts: (profileId: string) => Promise<void>;
  commitDraft: (draft: CheckInDraft) => Promise<CommitDraftOutcome>;
  verifyDraftCommit: (draftId: string, profileId: string) => ReturnType<typeof repository.verifyDraftCommitStatus>;
  recordWorkflowEvent: (params: Parameters<typeof repository.recordWorkflowEventAtomically>[0]) => Promise<CheckInEvent>;
  commitCsvBatch: (params: {
    profileId: string;
    preview: CsvReconciliationPreview;
    conflictChoices: Record<string, CsvConflictChoice>;
    possibleDuplicateChoices: Record<string, CsvPossibleDuplicateChoice>;
    acknowledgedExclusions: boolean;
  }) => ReturnType<typeof repository.commitCsvBatchAtomically>;
  restoreBackup: (params: {
    rawInput: unknown;
    destination: 'separate_profile' | 'replace_existing';
    targetExistingProfileId?: string;
    confirmedReplace?: boolean;
  }) => ReturnType<typeof repository.restoreBackupAtomically>;
  importDraftRecovery: (rawInput: unknown) => ReturnType<typeof repository.importDraftRecoveryAtomically>;
  createReferenceVersion: (params: {
    metricId: Exclude<MetricId, 'mood'>;
    provenance: 'entered_preflight' | 'user_updated';
    method: string;
    context: string;
    unit: string;
    value: ReferenceValue;
  }) => Promise<PersonalReference[]>;
  acknowledgeInsight: (insight: Insight) => Promise<void>;
  updateSourceEntry: (entry: EvidenceReference) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
  resetDemo: () => Promise<void>;
  requestPersistence: () => Promise<PersistenceStatus>;
  applyPendingSwUpdate: () => Promise<boolean>;
  refreshOfflineDiagnostics: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

/** Drafts the user has edited in this tab, keyed by profile and metric. */
export type WorkingDraftMap = Record<string, CheckInDraft>;

function resolveThemeFromPreference(
  pref: AppearancePreference,
  systemIsDark: boolean,
): 'light' | 'dark' {
  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemIsDark ? 'dark' : 'light';
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [faults, setFaultsState] = useState<StorageFaultSimulation>(
    repository.getFaultSimulation(),
  );
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [simulatedUpdatePending, setSimulatedUpdatePending] = useState(false);
  const [offlineSetupIncompleteOverride, setOfflineSetupIncompleteOverride] =
    useState(false);

  const [systemIsDark, setSystemIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [offlineDiagnostics, setOfflineDiagnostics] = useState<OfflineDiagnostics>({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    readiness: 'incomplete',
    controllerActive: false,
    cacheEntryCount: 0,
    persistence: 'unknown',
    updateWaiting: false,
    detailMessage: 'Checking offline readiness on this device…',
  });

  const pwaRef = useRef<PwaController | null>(null);

  const announce = useCallback((msg: string) => {
    setAnnouncement('');
    window.requestAnimationFrame(() => {
      setAnnouncement(msg);
    });
  }, []);

  const reloadSnapshot = useCallback(async () => {
    try {
      setLoadError(null);
      const next = await repository.loadSnapshot();
      setSnapshot(next);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : 'Could not read local CrewSignal storage on this device.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadSnapshot();
  }, [reloadSnapshot]);

  useEffect(() => {
    const controller = createPwaController((diag) => {
      setOfflineDiagnostics(diag);
    });
    pwaRef.current = controller;
    return () => {
      controller.dispose();
      pwaRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setSystemIsDark(e.matches);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const preferences = snapshot?.preferences ?? SIM_01_PREFERENCES;
  const resolvedTheme = resolveThemeFromPreference(
    preferences.appearance,
    systemIsDark,
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-appearance', preferences.appearance);
    try {
      localStorage.setItem('crewsignal.appearance', preferences.appearance);
    } catch {
      // Ignore storage failures in restricted contexts
    }
  }, [resolvedTheme, preferences.appearance]);

  const setFaultSimulation = useCallback(
    (next: Partial<StorageFaultSimulation>) => {
      repository.setFaultSimulation(next);
      setFaultsState(repository.getFaultSimulation());
    },
    [],
  );

  const activeProfile = useMemo(() => {
    if (!snapshot || snapshot.profiles.length === 0) return null;
    return (
      snapshot.profiles.find(
        (p) => p.profileId === preferences.activeProfileId,
      ) ??
      snapshot.profiles.find((p) => p.profileId === SIM_01_PROFILE_ID) ??
      snapshot.profiles[0] ??
      null
    );
  }, [snapshot, preferences.activeProfileId]);

  const activePid = activeProfile?.profileId ?? SIM_01_PROFILE_ID;

  const profileObservations = useMemo(
    () =>
      (snapshot?.observations ?? []).filter((o) => o.profileId === activePid),
    [snapshot, activePid],
  );

  const profileDrafts = useMemo(
    () => (snapshot?.drafts ?? []).filter((d) => d.profileId === activePid),
    [snapshot, activePid],
  );

  const profileEvents = useMemo(
    () => (snapshot?.events ?? []).filter((e) => e.profileId === activePid),
    [snapshot, activePid],
  );

  const profileReferences = useMemo(
    () =>
      (snapshot?.references ?? []).filter((r) => r.profileId === activePid),
    [snapshot, activePid],
  );

  const profileInsights = useMemo(
    () => (snapshot?.insights ?? []).filter((i) => i.profileId === activePid),
    [snapshot, activePid],
  );

  const latestByMetric = useMemo(
    () => getLatestObservationsByMetric(profileObservations),
    [profileObservations],
  );

  const currentMissionDay = useMemo(() => {
    if (!activeProfile) return 42;
    const refUtc =
      activeProfile.snapshotUtc ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    try {
      return Math.max(1, computeMissionDay(refUtc, activeProfile.missionEpochUtc));
    } catch {
      return 1;
    }
  }, [activeProfile]);

  const scheduleStatusByMetric = useMemo(() => {
    const refUtc =
      activeProfile?.snapshotUtc ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const out = {} as Record<MetricId, ScheduleFreshnessResult>;
    for (const metricId of METRIC_ORDER) {
      out[metricId] = evaluateMetricSchedule({
        metricId,
        latestObservation: latestByMetric[metricId],
        schedule: activeProfile?.schedules[metricId] ?? null,
        referenceNowUtc: refUtc,
      });
    }
    return out;
  }, [activeProfile, latestByMetric]);

  const coveredMetricCount = useMemo(
    () => countCoveredMetricTypes(profileObservations),
    [profileObservations],
  );

  const [workingDrafts, setWorkingDrafts] = useState<WorkingDraftMap>({});

  const rememberWorkingDraft = useCallback((draft: CheckInDraft) => {
    const key = workingDraftKey(draft.profileId, draft.metricId);
    setWorkingDrafts((prev) => (prev[key] === draft ? prev : { ...prev, [key]: draft }));
  }, []);

  const forgetWorkingDraft = useCallback((profileId: string, metricId: MetricId) => {
    const key = workingDraftKey(profileId, metricId);
    setWorkingDrafts((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const forgetProfileWorkingDrafts = useCallback((profileId: string | null) => {
    setWorkingDrafts((prev) => {
      const next: WorkingDraftMap = {};
      for (const [k, d] of Object.entries(prev)) {
        if (profileId !== null && d.profileId !== profileId) next[k] = d;
      }
      return next;
    });
  }, []);

  const unretainedDrafts = useMemo(
    () => Object.values(workingDrafts).filter(isUnretainedDraft),
    [workingDrafts],
  );

  // Closing or reloading the tab is the one navigation that drops a memory-only draft.
  useEffect(() => {
    if (unretainedDrafts.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unretainedDrafts.length]);

  const hasUncommittedDraft = useMemo(
    () =>
      profileDrafts.some((d) => d.commitStatus === 'uncommitted') ||
      unretainedDrafts.length > 0,
    [profileDrafts, unretainedDrafts.length],
  );

  const effectiveDiagnostics = useMemo<OfflineDiagnostics>(() => {
    const waiting = offlineDiagnostics.updateWaiting || simulatedUpdatePending;
    if (offlineSetupIncompleteOverride) {
      return {
        ...offlineDiagnostics,
        readiness: 'incomplete',
        controllerActive: false,
        updateWaiting: waiting,
        detailMessage:
          'Offline setup incomplete: cached application resources are not confirmed on this device.',
      };
    }
    return {
      ...offlineDiagnostics,
      updateWaiting: waiting,
    };
  }, [
    offlineDiagnostics,
    simulatedUpdatePending,
    offlineSetupIncompleteOverride,
  ]);

  const setAppearance = useCallback(
    async (appearance: AppearancePreference) => {
      try {
        localStorage.setItem('crewsignal.appearance', appearance);
      } catch {
        // ignore
      }
      const next = await repository.updatePreferencesAtomically({ appearance });
      setSnapshot((prev) => (prev ? { ...prev, preferences: next } : prev));
      announce(`Appearance set to ${appearance}.`);
    },
    [announce],
  );

  const setDisplayUnits = useCallback(
    async (displayUnits: {
      blood_glucose: GlucoseUnit;
      body_temperature: TemperatureUnit;
    }) => {
      const next = await repository.updatePreferencesAtomically({ displayUnits });
      setSnapshot((prev) => (prev ? { ...prev, preferences: next } : prev));
      announce('Display unit preference updated.');
    },
    [announce],
  );

  const setHelpMode = useCallback(
    async (helpMode: AppPreferences['helpMode']) => {
      const next = await repository.updatePreferencesAtomically({ helpMode });
      setSnapshot((prev) => (prev ? { ...prev, preferences: next } : prev));
      announce(
        helpMode === 'configured_fixture'
          ? 'Configured Help test fixture enabled.'
          : 'Unconfigured Help mode active.',
      );
    },
    [announce],
  );

  const switchProfile = useCallback(
    async (profileId: string) => {
      const next = await repository.updatePreferencesAtomically({
        activeProfileId: profileId,
      });
      setSnapshot((prev) => (prev ? { ...prev, preferences: next } : prev));
      announce('Switched active synthetic profile.');
    },
    [announce],
  );

  const saveDraft = useCallback(
    async (draft: CheckInDraft) => {
      const saved = await repository.saveDraftAtomically(draft);
      await reloadSnapshot();
      return saved;
    },
    [reloadSnapshot],
  );

  const discardDraft = useCallback(
    async (draftId: string) => {
      await repository.discardDraftAtomically(draftId);
      await reloadSnapshot();
      announce('Draft discarded.');
    },
    [reloadSnapshot, announce],
  );

  const discardAllProfileDrafts = useCallback(
    async (profileId: string) => {
      await repository.discardProfileDraftsAtomically(profileId);
      await reloadSnapshot();
    },
    [reloadSnapshot],
  );

  const commitDraft = useCallback(
    async (draft: CheckInDraft) => {
      const outcome = await repository.commitDraftAtomically(draft);
      await reloadSnapshot();
      announce(`${outcome.receiptTitle}. ${outcome.receiptSubtitle}`);
      return outcome;
    },
    [reloadSnapshot, announce],
  );

  const verifyDraftCommit = useCallback(
    async (draftId: string, profileId: string) => {
      const outcome = await repository.verifyDraftCommitStatus({
        draftId,
        profileId,
      });
      await reloadSnapshot();
      return outcome;
    },
    [reloadSnapshot],
  );

  const recordWorkflowEvent = useCallback(
    async (
      params: Parameters<typeof repository.recordWorkflowEventAtomically>[0],
    ) => {
      const evt = await repository.recordWorkflowEventAtomically(params);
      await reloadSnapshot();
      return evt;
    },
    [reloadSnapshot],
  );

  const commitCsvBatch = useCallback(
    async (params: {
      profileId: string;
      preview: CsvReconciliationPreview;
      conflictChoices: Record<string, CsvConflictChoice>;
      possibleDuplicateChoices: Record<string, CsvPossibleDuplicateChoice>;
      acknowledgedExclusions: boolean;
    }) => {
      const result = await repository.commitCsvBatchAtomically(params);
      await reloadSnapshot();
      announce(
        `CSV import committed: ${result.insertedCount} added, ${result.updatedCount} updated, ${result.skippedCount} skipped.`,
      );
      return result;
    },
    [reloadSnapshot, announce],
  );

  const restoreBackup = useCallback(
    async (params: {
      rawInput: unknown;
      destination: 'separate_profile' | 'replace_existing';
      targetExistingProfileId?: string;
      confirmedReplace?: boolean;
    }) => {
      const res = await repository.restoreBackupAtomically(params);
      if (params.destination === 'replace_existing') {
        forgetProfileWorkingDrafts(res.profile.profileId);
      }
      await reloadSnapshot();
      announce(`Restored backup into ${res.profile.label}.`);
      return res;
    },
    [reloadSnapshot, announce, forgetProfileWorkingDrafts],
  );

  const importDraftRecovery = useCallback(
    async (rawInput: unknown) => {
      const res = await repository.importDraftRecoveryAtomically({
        rawInput,
        fallbackProfileId: activePid,
      });
      await reloadSnapshot();
      return res;
    },
    [activePid, reloadSnapshot],
  );

  const createReferenceVersion = useCallback(
    async (params: {
      metricId: Exclude<MetricId, 'mood'>;
      provenance: 'entered_preflight' | 'user_updated';
      method: string;
      context: string;
      unit: string;
      value: ReferenceValue;
    }) => {
      const list = await repository.createReferenceVersionAtomically({
        ...params,
        profileId: activePid,
      });
      await reloadSnapshot();
      announce('Created new personal reference version.');
      return list;
    },
    [activePid, reloadSnapshot, announce],
  );

  const acknowledgeInsight = useCallback(
    async (insight: Insight) => {
      await repository.acknowledgeInsightAtomically(insight);
      await reloadSnapshot();
      announce('Educational review note acknowledged.');
    },
    [reloadSnapshot, announce],
  );

  const updateSourceEntry = useCallback(
    async (entry: EvidenceReference) => {
      await repository.updateSourceCacheEntry(entry);
      await reloadSnapshot();
    },
    [reloadSnapshot],
  );

  const deleteProfile = useCallback(
    async (profileId: string) => {
      await repository.deleteProfileAtomically(profileId);
      forgetProfileWorkingDrafts(profileId);
      await reloadSnapshot();
      announce('Profile removed from this device.');
    },
    [reloadSnapshot, announce, forgetProfileWorkingDrafts],
  );

  const resetDemo = useCallback(async () => {
    await repository.resetDemoAtomically();
    forgetProfileWorkingDrafts(null);
    setFaultSimulation({
      failDraftWrite: false,
      failCommitRollback: false,
      failCommitAckAfterWrite: false,
      failPostCommitRead: false,
      failLogLoad: false,
    });
    setSimulatedUpdatePending(false);
    setOfflineSetupIncompleteOverride(false);
    await reloadSnapshot();
    announce('Demo reset to SIM-01 starter dataset.');
  }, [reloadSnapshot, setFaultSimulation, announce, forgetProfileWorkingDrafts]);

  const requestPersistence = useCallback(async () => {
    if (!pwaRef.current) return 'unsupported' as const;
    const status = await pwaRef.current.requestPersistence();
    announce(
      status === 'granted'
        ? 'Persistent browser storage granted.'
        : 'Browser declined persistent storage or could not guarantee eviction protection.',
    );
    return status;
  }, [announce]);

  const applyPendingSwUpdate = useCallback(async () => {
    if (hasUncommittedDraft) {
      announce(
        'Update deferred: finish, save, or discard your uncommitted check-in draft first.',
      );
      return false;
    }
    if (simulatedUpdatePending && !offlineDiagnostics.updateWaiting) {
      setSimulatedUpdatePending(false);
      setUpdateModalOpen(false);
      announce('Simulated service worker update applied.');
      return true;
    }
    const ok = await (pwaRef.current?.applyPendingUpdate() ?? Promise.resolve(false));
    return ok;
  }, [
    hasUncommittedDraft,
    simulatedUpdatePending,
    offlineDiagnostics.updateWaiting,
    announce,
  ]);

  const refreshOfflineDiagnostics = useCallback(async () => {
    await pwaRef.current?.refreshDiagnostics();
  }, []);

  const value: AppStateContextValue = {
    loading,
    loadError,
    snapshot,
    preferences,
    resolvedTheme,
    profiles: snapshot?.profiles ?? [],
    activeProfile,
    profileObservations,
    profileDrafts,
    profileEvents,
    profileReferences,
    profileInsights,
    sources: snapshot?.sources ?? [],
    latestByMetric,
    currentMissionDay,
    scheduleStatusByMetric,
    coveredMetricCount,
    hasUncommittedDraft,
    workingDrafts,
    rememberWorkingDraft,
    forgetWorkingDraft,
    unretainedDrafts,
    offlineDiagnostics: effectiveDiagnostics,
    updateModalOpen,
    setUpdateModalOpen,
    simulatedUpdatePending,
    setSimulatedUpdatePending,
    offlineSetupIncompleteOverride,
    setOfflineSetupIncompleteOverride,
    faultSimulation: faults,
    setFaultSimulation,
    announcement,
    announce,
    reloadSnapshot,
    setAppearance,
    setDisplayUnits,
    setHelpMode,
    switchProfile,
    saveDraft,
    discardDraft,
    discardAllProfileDrafts,
    commitDraft,
    verifyDraftCommit,
    recordWorkflowEvent,
    commitCsvBatch,
    restoreBackup,
    importDraftRecovery,
    createReferenceVersion,
    acknowledgeInsight,
    updateSourceEntry,
    deleteProfile,
    resetDemo,
    requestPersistence,
    applyPendingSwUpdate,
    refreshOfflineDiagnostics,
  };

  return (
    <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
  );
}

export function useAppState(): AppStateContextValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useAppState must be used inside AppStateProvider');
  }
  return ctx;
}
