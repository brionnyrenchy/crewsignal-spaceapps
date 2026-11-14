import { buildDraftRecoveryBundle, type CheckInDraft } from "../shared/src";
import { desktopBridge } from "../bridge/desktopBridge";

/**
 * Writes a draft recovery file (ER-04 "Export draft") through the native Save As
 * dialog. Used wherever a memory-only draft could otherwise be the only copy.
 */
export async function exportDraftRecoveryFile(draft: CheckInDraft, profileLabel: string) {
  const bundle = buildDraftRecoveryBundle({
    draft,
    profileLabel,
    exportedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    includeNotes: false,
  });
  return desktopBridge.saveExportFile({
    defaultFileName: `crewsignal-draft-recovery-${draft.draftId}.json`,
    filterName: "JSON files",
    extensions: ["json"],
    content: JSON.stringify(bundle, null, 2),
  });
}

/** True when the draft has not reached local storage and is not yet in the log. */
export function isUnretainedDraft(draft: CheckInDraft | null, retentionFailed: boolean): boolean {
  return Boolean(
    draft &&
      draft.commitStatus !== "committed" &&
      (retentionFailed || draft.retentionStatus === "memory_only" || draft.retentionStatus === "failed"),
  );
}
