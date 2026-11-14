import { Workbox } from 'workbox-window';

export type OfflineReadinessState =
  | 'ready'
  | 'installing'
  | 'incomplete'
  | 'unsupported';

export type PersistenceStatus = 'granted' | 'refused' | 'unknown' | 'unsupported';

export interface OfflineDiagnostics {
  online: boolean;
  readiness: OfflineReadinessState;
  controllerActive: boolean;
  cacheEntryCount: number;
  persistence: PersistenceStatus;
  updateWaiting: boolean;
  detailMessage: string;
}

export interface PwaController {
  applyPendingUpdate: () => Promise<boolean>;
  refreshDiagnostics: () => Promise<OfflineDiagnostics>;
  requestPersistence: () => Promise<PersistenceStatus>;
  dispose: () => void;
}

export async function inspectPersistenceStatus(): Promise<PersistenceStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return 'unsupported';
  }
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const persisted = await navigator.storage.persisted();
      return persisted ? 'granted' : 'unknown';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.persist !== 'function'
  ) {
    return 'unsupported';
  }
  try {
    const granted = await navigator.storage.persist();
    return granted ? 'granted' : 'refused';
  } catch {
    return 'refused';
  }
}

export async function inspectCacheStatus(): Promise<{
  controllerActive: boolean;
  registrationActive: boolean;
  cacheEntryCount: number;
}> {
  const controllerActive =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    Boolean(navigator.serviceWorker.controller);

  let registrationActive = false;
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      registrationActive = Boolean(reg?.active);
    } catch {
      registrationActive = false;
    }
  }

  let cacheEntryCount = 0;
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        cacheEntryCount += requests.length;
      }
    } catch {
      cacheEntryCount = 0;
    }
  }

  return {
    controllerActive,
    registrationActive,
    cacheEntryCount,
  };
}

export async function getOfflineDiagnostics(
  updateWaiting = false,
  persistenceOverride?: PersistenceStatus,
): Promise<OfflineDiagnostics> {
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const swSupported =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const persistence = persistenceOverride ?? (await inspectPersistenceStatus());

  if (!swSupported) {
    return {
      online,
      readiness: 'unsupported',
      controllerActive: false,
      cacheEntryCount: 0,
      persistence,
      updateWaiting,
      detailMessage:
        'Service worker offline caching is not supported in this browser context.',
    };
  }

  const { controllerActive, registrationActive, cacheEntryCount } =
    await inspectCacheStatus();

  let readiness: OfflineReadinessState = 'incomplete';
  let detailMessage =
    'Offline setup incomplete: application assets are not yet cached by an active service worker.';

  if (controllerActive && cacheEntryCount > 0) {
    readiness = 'ready';
    detailMessage = `Offline ready: ${cacheEntryCount} cached shell, font, and evidence assets on this device.`;
  } else if (registrationActive && cacheEntryCount > 0) {
    readiness = 'ready';
    detailMessage = `Offline cache prepared (${cacheEntryCount} cached assets); reload once if this tab opened before activation.`;
  } else if (import.meta.env.DEV) {
    readiness = 'incomplete';
    detailMessage =
      'Development server mode: run a production build preview to verify full Workbox offline asset caching.';
  }

  return {
    online,
    readiness,
    controllerActive,
    cacheEntryCount,
    persistence,
    updateWaiting,
    detailMessage,
  };
}

export function createPwaController(onChange: (diag: OfflineDiagnostics) => void): PwaController {
  let wb: Workbox | null = null;
  let updateWaiting = false;
  let persistenceOverride: PersistenceStatus | undefined;
  let disposed = false;

  const notify = async () => {
    if (disposed) return;
    const diag = await getOfflineDiagnostics(updateWaiting, persistenceOverride);
    if (!disposed) {
      onChange(diag);
    }
  };

  const handleOnline = () => {
    void notify();
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOnline);
  }

  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    import.meta.env.PROD
  ) {
    wb = new Workbox('/sw.js', { scope: '/' });

    wb.addEventListener('waiting', () => {
      updateWaiting = true;
      void notify();
    });

    wb.addEventListener('installed', (event) => {
      if (event.isUpdate) {
        updateWaiting = true;
      }
      void notify();
    });

    wb.addEventListener('activated', () => {
      updateWaiting = false;
      void notify();
    });

    wb.addEventListener('controlling', () => {
      window.location.reload();
    });

    void wb.register().then(
      (reg) => {
        if (reg?.waiting) {
          updateWaiting = true;
        }
        void notify();
      },
      () => {
        void notify();
      },
    );
  } else {
    void notify();
  }

  return {
    applyPendingUpdate: async () => {
      if (!wb || !updateWaiting) {
        return false;
      }
      wb.messageSkipWaiting();
      return true;
    },
    refreshDiagnostics: async () => {
      const diag = await getOfflineDiagnostics(updateWaiting, persistenceOverride);
      if (!disposed) {
        onChange(diag);
      }
      return diag;
    },
    requestPersistence: async () => {
      const result = await requestPersistentStorage();
      persistenceOverride = result;
      await notify();
      return result;
    },
    dispose: () => {
      disposed = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOnline);
      }
    },
  };
}
