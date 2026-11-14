import { AppPreferencesSchema, type AppPreferences } from "../shared/src";

/**
 * Coerces whatever the native store returned into the shared AppPreferences
 * shape. The Rust side already normalizes (db.rs `normalize_preferences`);
 * this keeps the UI and full-backup export safe if an older database or a
 * hand-edited value slips through. Legacy keys from early desktop builds
 * (`displayUnits.glucose`, `displayUnits.temperature`, `configuredHelpFixture`)
 * are carried over.
 */
export function normalizeAppPreferences(raw: unknown, activeProfileId: string): AppPreferences {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const units = (r.displayUnits && typeof r.displayUnits === "object" ? r.displayUnits : {}) as Record<
    string,
    unknown
  >;
  const oneOf = <T extends string>(allowed: readonly T[], fallback: T, ...vals: unknown[]): T =>
    (vals.find((v) => typeof v === "string" && (allowed as readonly string[]).includes(v)) as T | undefined) ??
    fallback;

  const candidate: AppPreferences = {
    appearance: oneOf(["system", "light", "dark"] as const, "system", r.appearance),
    activeProfileId:
      activeProfileId ||
      (typeof r.activeProfileId === "string" && r.activeProfileId ? r.activeProfileId : "sim-01"),
    displayUnits: {
      blood_glucose: oneOf(["mg/dL", "mmol/L"] as const, "mg/dL", units.blood_glucose, units.glucose),
      body_temperature: oneOf(["C", "F"] as const, "C", units.body_temperature, units.temperature),
    },
    helpMode:
      r.helpMode === "configured_fixture" || r.helpMode === "unconfigured"
        ? r.helpMode
        : r.configuredHelpFixture === true
          ? "configured_fixture"
          : "unconfigured",
  };
  if (typeof r.persistentStorageRequested === "boolean") {
    candidate.persistentStorageRequested = r.persistentStorageRequested;
  }
  if (typeof r.persistentStorageGranted === "boolean") {
    candidate.persistentStorageGranted = r.persistentStorageGranted;
  }
  return AppPreferencesSchema.parse(candidate);
}
