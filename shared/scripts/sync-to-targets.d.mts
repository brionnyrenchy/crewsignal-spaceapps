export interface SyncResult {
  copied: number;
  totalFiles: number;
}

export interface ParityReport {
  ok: boolean;
  totalExpected: number;
  missing: string[];
  mismatches: string[];
  extra: string[];
}

export function collectSharedFiles(): Map<string, string>;
export function syncToTargetDir(targetSharedDir: string): SyncResult;
export function checkTargetParity(targetSharedDir: string): ParityReport;
