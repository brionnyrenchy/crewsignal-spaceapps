import { guidanceReviewIdentity } from "../shared/src";
import type { BackupBundle, MetricId, ProfileConfig } from "../shared/src";
import {
  desktopBridge,
  profileConfigToRecord,
  type ActionReviewRecord,
  type ClockHistoryEntry,
  type ProfileBundleData,
} from "../bridge/desktopBridge";

export type RestoreMode = "separate_profile" | "replace_profile";
type RestoreRequest = Parameters<(typeof desktopBridge)["restoreBackup"]>[0];

const MODE_LABEL: Record<ProfileConfig["mode"], string> = {
  demo: "Demo",
  personal: "Personal",
};

/** Platform history written into a full backup alongside the shared records. */
export function backupHistoryFrom(profileData: ProfileBundleData) {
  return {
    actionReviews: profileData.actionReviews as unknown as Array<Record<string, unknown>>,
    clockHistory: profileData.clockHistory as unknown as Array<Record<string, unknown>>,
    corrections: profileData.corrections.filter(
      (c): c is Record<string, unknown> => typeof c === "object" && c !== null,
    ),
  };
}

/**
 * Why a restore cannot run as chosen, or null when it can. Replacement is only
 * allowed into a profile of the same mode, so synthetic data never lands in a
 * Personal log and a Personal backup never overwrites the demo.
 */
export function restoreBlockReason(params: {
  bundle: BackupBundle;
  mode: RestoreMode;
  activeProfile: ProfileConfig;
  confirmReplace: boolean;
}): string | null {
  if (params.mode !== "replace_profile") return null;
  if (params.activeProfile.mode === "demo") {
    return "Replacing the public SIM-01 demo isn't available. Restore as a separate profile instead.";
  }
  if (params.bundle.profile.mode !== params.activeProfile.mode) {
    return `This is a ${MODE_LABEL[params.bundle.profile.mode]} backup, so it can't replace a ${MODE_LABEL[params.activeProfile.mode]} profile. Restore it as a separate profile instead.`;
  }
  if (!params.confirmReplace) return `Confirm replacing ${params.activeProfile.label} to continue.`;
  return null;
}

/**
 * Builds the native restore request. The source mode is preserved on a separate
 * restore, profile settings come from the backup, and reviewed actions, clock
 * history and corrections are re-scoped to the destination profile.
 */
export function buildRestoreRequest(params: {
  bundle: BackupBundle;
  mode: RestoreMode;
  activeProfile: ProfileConfig;
  nowIso: string;
  uniqueSuffix: string;
}): { request: RestoreRequest; target: ProfileConfig } {
  const b = params.bundle;
  const target: ProfileConfig =
    params.mode === "separate_profile"
      ? {
          ...b.profile,
          profileId: `restored-${b.profile.mode}-${params.uniqueSuffix}`,
          label: `${b.profile.label} (Restored)`,
        }
      : {
          ...b.profile,
          profileId: params.activeProfile.profileId,
          createdAtUtc: params.activeProfile.createdAtUtc,
        };
  const destId = target.profileId;
  const history = b.history ?? { actionReviews: [], clockHistory: [], corrections: [] };

  const request: RestoreRequest = {
    targetMode: params.mode,
    targetProfileId: params.mode === "replace_profile" ? destId : null,
    profile: profileConfigToRecord(target, params.nowIso),
    observations: b.observations.map((o) => ({ ...o, profileId: destId })),
    corrections: history.corrections.map((c) => ({ ...c })),
    checkinEvents: b.checkInEvents.map((e) => ({ ...e, profileId: destId })),
    references: b.references.map((r) => ({ ...r, profileId: destId })),
    actionReviews: history.actionReviews.map((r) => {
      const review = { ...r, profileId: destId } as unknown as ActionReviewRecord;
      const identity = guidanceReviewIdentity(review);
      return { ...review, reviewId: identity ?? review.reviewId };
    }),
    schedules: Object.entries(b.profile.schedules)
      .filter(([, sched]) => sched !== null)
      .map(([metricId, schedule]) => ({ metricId: metricId as MetricId, schedule: schedule! })),
    clockHistory: history.clockHistory.map((c) => ({
      ...c,
      profileId: destId,
    })) as unknown as ClockHistoryEntry[],
  };
  return { request, target };
}
