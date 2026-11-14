import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Linking from 'expo-linking';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  formatObservationDisplay,
  formatUtcTimeHHMM,
  getObservedMissionDay,
  METRIC_DEFINITIONS,
  type AppPreferences,
  type Observation,
  type ReportBundle,
} from '../shared/src';

export type NativeFileOutcomeKind =
  | 'saved'
  | 'shared'
  | 'printed'
  | 'cancelled'
  | 'access_refused'
  | 'write_failed';

export interface NativeFileActionResult {
  outcome: NativeFileOutcomeKind;
  label: string;
  detail: string;
  uri?: string;
  /** The file name actually written, which differs from the request when a copy already existed. */
  savedAs?: string;
}

export interface PickedTextFileResult {
  outcome: 'picked' | 'cancelled' | 'access_refused' | 'read_failed';
  label: string;
  detail: string;
  fileName?: string;
  content?: string;
}

export interface PlatformIoAdapter {
  saveTextFile(params: {
    filename: string;
    content: string;
    mimeType: string;
    chooseDestination?: boolean;
    /**
     * Never replace an existing file. When the name is taken the adapter picks
     * `name (2).ext`, `name (3).ext`, ... and reports it in `savedAs`; if it cannot,
     * it returns `write_failed` with a collision message and writes nothing.
     */
    avoidOverwrite?: boolean;
  }): Promise<NativeFileActionResult>;
  shareTextFile(params: {
    filename: string;
    content: string;
    mimeType: string;
    title: string;
  }): Promise<NativeFileActionResult>;
  pickTextFile(params: { mimeTypes: string[] }): Promise<PickedTextFileResult>;
  printReportHtml(params: { html: string; filename: string }): Promise<NativeFileActionResult>;
  openExternalUrl(url: string): Promise<{ ok: boolean; message: string }>;
  copyToClipboard(text: string): Promise<boolean>;
}

/**
 * First name that is not in `existingNames`: `base.ext`, then `base (2).ext`, `base (3).ext`...
 * Comparison is case-insensitive because the common phone and desktop file systems are.
 */
export function uniqueFilename(filename: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  if (!taken.has(filename.toLowerCase())) {
    return filename;
  }
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

function isCollisionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return msg.includes('already exist') || msg.includes('eexist') || msg.includes('exists');
}

/** A folder listing the platform cannot provide is treated as "unknown", not as an error. */
function listNames(dir: unknown): string[] {
  try {
    const lister = (dir as { list?: () => { name: string }[] }).list;
    return typeof lister === 'function'
      ? lister.call(dir).map((entry) => entry.name)
      : [];
  } catch {
    return [];
  }
}

function classifyFsError(error: unknown): 'cancelled' | 'access_refused' | 'write_failed' {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (msg.includes('cancel') || msg.includes('abort')) {
    return 'cancelled';
  }
  if (msg.includes('already exist') || msg.includes('eexist')) {
    return 'write_failed';
  }
  if (
    msg.includes('permission') ||
    msg.includes('denied') ||
    msg.includes('access') ||
    msg.includes('eacces') ||
    msg.includes('security')
  ) {
    return 'access_refused';
  }
  return 'write_failed';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Generates clean A4 monochrome light-palette HTML for Print/PDF export
 * regardless of whether the mobile screen is currently in Dark or Light appearance.
 */
export function buildA4ReportPrintHtml(params: {
  report: ReportBundle;
  displayUnits: AppPreferences['displayUnits'];
}): string {
  const { report, displayUnits } = params;
  const rowsHtml = report.observations
    .map((obs: Observation) => {
      const def = METRIC_DEFINITIONS[obs.metricId];
      const day = getObservedMissionDay(obs);
      const time =
        obs.timing.kind === 'instant'
          ? formatUtcTimeHHMM(obs.timing.observedAtUtc)
          : `${formatUtcTimeHHMM(obs.timing.reportedAtUtc)} (reported)`;
      const formatted = formatObservationDisplay(obs, displayUnits);
      const noteCell = report.includeNotes ? escapeHtml(obs.note ?? '—') : 'Excluded';
      return `
        <tr>
          <td>${escapeHtml(def.shortLabel)}</td>
          <td>Day ${day} · ${escapeHtml(time)}</td>
          <td><strong>${escapeHtml(formatted.primaryText)}</strong></td>
          <td>${escapeHtml(obs.method)} · ${escapeHtml(obs.context)}</td>
          <td>${noteCell}</td>
        </tr>`;
    })
    .join('\n');

  const excludedNames = report.excludedMetricIds
    .map((id) => METRIC_DEFINITIONS[id].name)
    .join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 16mm; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #ffffff;
    color: #171717;
    margin: 0;
    padding: 0;
    font-size: 11pt;
    line-height: 1.45;
  }
  .header {
    border-bottom: 1px solid #ebebeb;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .eyebrow {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 9pt;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: #666666;
  }
  h1 {
    font-size: 20pt;
    font-weight: 500;
    margin: 4px 0 6px 0;
    color: #171717;
  }
  .meta {
    font-size: 9.5pt;
    color: #4d4d4d;
  }
  .privacy-box {
    border: 1px solid #ebebeb;
    background: #fafafa;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 14px;
    font-size: 9.5pt;
    color: #4d4d4d;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
  }
  th, td {
    text-align: left;
    padding: 7px 8px;
    border-bottom: 1px solid #ebebeb;
    font-size: 9.5pt;
    vertical-align: top;
  }
  th {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666666;
    background: #fafafa;
  }
  .footer {
    margin-top: 18px;
    font-size: 8.5pt;
    color: #666666;
    border-top: 1px solid #ebebeb;
    padding-top: 8px;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="eyebrow">CrewSignal Report · A4 Light Print</div>
    <h1>${escapeHtml(report.profileLabel)}</h1>
    <div class="meta">
      Mode: ${escapeHtml(report.mode)} · Window: Day ${report.missionDayRange.startDay}–${report.missionDayRange.endDay} ·
      Entries exported: ${report.observations.length} · Generated: ${escapeHtml(report.generatedAtUtc)}
    </div>
  </div>
  <div class="privacy-box">
    <strong>Included indicators:</strong> ${report.includedMetricIds.map((id) => escapeHtml(METRIC_DEFINITIONS[id].name)).join(', ')}<br/>
    <strong>Privacy exclusions:</strong> ${excludedNames.length > 0 ? escapeHtml(excludedNames) : 'None'} ·
    Notes ${report.includeNotes ? 'included by explicit opt-in' : 'excluded by default'} ·
    Mood ${report.includedMetricIds.includes('mood') ? 'included by explicit opt-in' : 'excluded by default'}
  </div>
  <table>
    <thead>
      <tr>
        <th>Indicator</th>
        <th>Mission Time</th>
        <th>Value</th>
        <th>Context</th>
        <th>Note</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml || '<tr><td colspan="5">No observations in selected window.</td></tr>'}
    </tbody>
  </table>
  <div class="footer">
    Schema v${report.schemaVersion} · CrewSignal offline report. Does not diagnose medical conditions.
  </div>
</body>
</html>`;
}

export const defaultPlatformIo: PlatformIoAdapter = {
  async saveTextFile({ filename, content, mimeType, chooseDestination, avoidOverwrite }) {
    try {
      if (chooseDestination) {
        const pickedDir = await Directory.pickDirectoryAsync();
        const finalName = avoidOverwrite
          ? uniqueFilename(filename, listNames(pickedDir))
          : filename;
        const file = pickedDir.createFile(finalName, mimeType);
        await file.write(content);
        return {
          outcome: 'saved',
          label: 'File saved',
          detail:
            finalName === filename
              ? `Saved ${finalName} to the selected folder.`
              : `Saved ${finalName} to the selected folder. ${filename} was already there and was left untouched.`,
          uri: file.uri,
          savedAs: finalName,
        };
      }

      const appDir = new Directory(Paths.document, 'CrewSignal');
      if (!appDir.exists) {
        appDir.create({ intermediates: true, idempotent: true });
      }
      let finalName = filename;
      if (avoidOverwrite) {
        finalName = uniqueFilename(filename, listNames(appDir));
      }
      const target = new File(appDir, finalName);
      if (avoidOverwrite && target.exists) {
        throw new Error(`${finalName} already exists`);
      }
      if (!target.exists) {
        target.create({ overwrite: true });
      }
      await target.write(content);
      return {
        outcome: 'saved',
        label: 'File saved',
        detail:
          finalName === filename
            ? `Saved ${finalName} to app storage (${target.uri}).`
            : `Saved ${finalName} to app storage (${target.uri}). ${filename} was already there and was left untouched.`,
        uri: target.uri,
        savedAs: finalName,
      };
    } catch (err) {
      if (avoidOverwrite && isCollisionError(err)) {
        return {
          outcome: 'write_failed',
          label: 'File already exists',
          detail: `A file named ${filename} already exists in that location and could not be given a new name. Nothing was overwritten. Choose another folder or try again.`,
        };
      }
      const classified = classifyFsError(err);
      if (classified === 'cancelled') {
        return {
          outcome: 'cancelled',
          label: 'Cancelled',
          detail: 'Folder selection was cancelled before saving.',
        };
      }
      if (classified === 'access_refused') {
        return {
          outcome: 'access_refused',
          label: 'File access refused',
          detail: 'Permission to write to the selected location was denied.',
        };
      }
      return {
        outcome: 'write_failed',
        label: 'Write failed',
        detail: err instanceof Error ? err.message : 'Unable to save file to device storage.',
      };
    }
  },

  async shareTextFile({ filename, content, mimeType, title }) {
    try {
      const cacheDir = new Directory(Paths.cache, 'CrewSignal');
      if (!cacheDir.exists) {
        cacheDir.create({ intermediates: true, idempotent: true });
      }
      const tempFile = new File(cacheDir, filename);
      if (!tempFile.exists) {
        tempFile.create({ overwrite: true });
      }
      await tempFile.write(content);

      const available = await Sharing.isAvailableAsync();
      if (!available) {
        return {
          outcome: 'write_failed',
          label: 'Share unavailable',
          detail: 'Native share sheet is unavailable on this device. Use Save file instead.',
        };
      }

      await Sharing.shareAsync(tempFile.uri, {
        mimeType,
        dialogTitle: title,
      });

      return {
        outcome: 'shared',
        label: 'Share sheet opened',
        detail: `Handed ${filename} to the native share sheet. Saving depends on the destination app you chose.`,
        uri: tempFile.uri,
      };
    } catch (err) {
      const classified = classifyFsError(err);
      if (classified === 'cancelled') {
        return {
          outcome: 'cancelled',
          label: 'Cancelled',
          detail: 'Share request was cancelled.',
        };
      }
      return {
        outcome: classified,
        label: classified === 'access_refused' ? 'File access refused' : 'Share failed',
        detail: err instanceof Error ? err.message : 'Could not open native share sheet.',
      };
    }
  },

  async pickTextFile({ mimeTypes }) {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: mimeTypes,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return {
          outcome: 'cancelled',
          label: 'Cancelled',
          detail: 'File selection cancelled.',
        };
      }

      const asset = result.assets[0]!;
      const pickedFile = new File(asset.uri);
      const content = await pickedFile.text();
      return {
        outcome: 'picked',
        label: 'File read',
        detail: `Loaded ${asset.name}.`,
        fileName: asset.name,
        content,
      };
    } catch (err) {
      const classified = classifyFsError(err);
      if (classified === 'access_refused') {
        return {
          outcome: 'access_refused',
          label: 'File access refused',
          detail: 'Could not read the selected file due to storage permission refusal.',
        };
      }
      return {
        outcome: 'read_failed',
        label: 'Read failed',
        detail: err instanceof Error ? err.message : 'Unable to read selected file.',
      };
    }
  },

  async printReportHtml({ html, filename }) {
    try {
      await Print.printAsync({
        html,
        width: 595,
        height: 842,
      });
      return {
        outcome: 'printed',
        label: 'Print dialog opened',
        detail: `Prepared A4 light print layout for ${filename}.`,
      };
    } catch (err) {
      const classified = classifyFsError(err);
      if (classified === 'cancelled') {
        return {
          outcome: 'cancelled',
          label: 'Cancelled',
          detail: 'Print request was cancelled.',
        };
      }
      return {
        outcome: 'write_failed',
        label: 'Print failed',
        detail: err instanceof Error ? err.message : 'Could not start native print preview.',
      };
    }
  },

  async openExternalUrl(url: string) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        return {
          ok: false,
          message: 'No external browser handler is available for this link. Copy the URL instead.',
        };
      }
      await Linking.openURL(url);
      return {
        ok: true,
        message: 'Opened external source in your browser.',
      };
    } catch {
      return {
        ok: false,
        message: 'Could not open external browser on this device. Copy the URL instead.',
      };
    }
  },

  async copyToClipboard(text: string) {
    try {
      await Clipboard.setStringAsync(text);
      return true;
    } catch {
      return false;
    }
  },
};
