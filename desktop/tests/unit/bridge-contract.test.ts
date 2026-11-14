/**
 * Contract fixture for the native SQLite bridge.
 *
 * The Rust tests load `src-tauri/tests/fixtures/sim01-bridge-contract.json` so
 * they exercise the exact payloads the frontend sends (observationId, metricId,
 * eventType, ...), not a Rust-only shape. This test fails if the frontend seed
 * drifts from the committed fixture. Regenerate with:
 *   UPDATE_BRIDGE_FIXTURE=1 npx vitest run tests/unit/bridge-contract.test.ts
 */
import { describe, expect, it } from "vitest";
import committed from "../../src-tauri/tests/fixtures/sim01-bridge-contract.json";
import {
  CheckInDraftSchema,
  CheckInEventSchema,
  ObservationSchema,
  PersonalReferenceSchema,
} from "../../src/shared/src";
import { buildDemoSeedInput } from "../../src/bridge/desktopBridge";

// The desktop tsconfig has no Node types; reach Node only when regenerating.
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

function buildFixture() {
  const seed = buildDemoSeedInput(true);
  const bp = seed.observations.find((o) => o.metricId === "blood_pressure")!;
  const newObservation = ObservationSchema.parse({
    ...bp,
    observationId: "obs-contract-bp-0718",
    sourceDraftId: "draft-contract-bp-0718",
    timing: { ...bp.timing, observedAtUtc: "2027-03-12T07:18:00.000Z" },
    recordedAtUtc: "2027-03-12T07:19:00.000Z",
    importBatchId: null,
    correctionHistory: [],
  });
  const draft = CheckInDraftSchema.parse({
    ...seed.drafts[0],
    draftId: "draft-contract-bp-0718",
    retentionStatus: "retained",
    commitStatus: "uncommitted",
    committedObservationId: null,
  });
  const event = CheckInEventSchema.parse({
    eventId: "evt-contract-0001",
    profileId: seed.profile.id,
    eventType: "measurement_unavailable",
    metricId: "heart_rate",
    reason: "Cuff not available",
    attemptedAtUtc: "2027-03-12T07:20:00.000Z",
    attemptedMissionDay: 42,
    attemptedTimeLabel: "07:20",
    missionEpochUtc: seed.profile.epochUtc,
    keptDraftId: null,
    committedCountInSession: 0,
    recordedAtUtc: "2027-03-12T07:20:05.000Z",
  });
  const ref = seed.references[0]!;
  const updatedReference = PersonalReferenceSchema.parse({
    ...ref,
    referenceId: `${ref.referenceId}-v${ref.version + 1}`,
    version: ref.version + 1,
    provenance: "user_updated",
    status: "active",
    createdAtUtc: "2027-03-12T08:00:00.000Z",
  });
  return { seed, newObservation, draft, event, updatedReference };
}

describe("native bridge contract fixture", () => {
  it("matches the frontend's production payload shapes", async () => {
    const fixture = buildFixture();
    expect(fixture.seed.observations).toHaveLength(11);
    const plain = JSON.parse(JSON.stringify(fixture)) as unknown;
    if (env.UPDATE_BRIDGE_FIXTURE === "1") {
      const fs = (await import(/* @vite-ignore */ "node:fs" as string)) as {
        writeFileSync: (path: URL, text: string) => void;
      };
      const url = new URL("../../src-tauri/tests/fixtures/sim01-bridge-contract.json", import.meta.url);
      fs.writeFileSync(url, `${JSON.stringify(plain, null, 2)}
`);
      return;
    }
    expect(committed).toEqual(plain);
  });
});
