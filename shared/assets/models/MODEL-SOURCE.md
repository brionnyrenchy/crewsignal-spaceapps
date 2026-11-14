# CrewSignal anatomical navigation model

| Field | Value |
| --- | --- |
| File | `crewsignal-body.glb` (glTF 2.0 binary, one embedded buffer, no textures, no extensions) |
| Purpose | Navigation illustration for the Health Explorer. It is not an anatomical, diagnostic or measurement model. |
| Source | `shared/scripts/build-body-model.mjs`. The model is built procedurally from ellipsoids and capsules. It uses no scan data, third-party meshes or external downloads. |
| Author / attribution | POP N' SEB (CrewSignal team), 2026 |
| Licence | Apache License 2.0, the same as the project (`LICENSE`). The GLB `asset.copyright` field records this. |
| Embedded copy | `shared/src/bodyModelAsset.ts` holds the same bytes as base64. Desktop and Android both load it from the app bundle with no network access. |

## Reproduce

```bash
cd shared
node scripts/build-body-model.mjs          # rewrites the .glb and bodyModelAsset.ts
node scripts/build-body-model.mjs --check  # exits 1 if either output is stale
node scripts/sync-to-targets.mjs --write all
```

The generator has no dependencies and rounds every coordinate to 4 decimals before encoding. Repeated runs are byte-identical, and `shared/tests/body-model.test.ts` checks this.

## Region mapping

Each mesh is a named node. Its `extras.bodySystemId` must match `BODY_MODEL_REGION_MAP` in `shared/src/bodyModel.ts`. `loadMappedBodyModel` rejects an asset that adds an unmapped mesh or changes a mapping.

| Node | BodySystemId | Hit target |
| --- | --- | --- |
| `region_head` | `sleep_cognition` | Head |
| `region_torso` | `cardiovascular` | Chest |
| `region_arm_left`, `region_arm_right`, `region_leg_left`, `region_leg_right` | `musculoskeletal` (not assessed) | Limbs |
| `shape_neck` | none | Shape only, not selectable |

`immune_context` and `nutrition_metabolism` are whole-body context, so they have no region. You select them from the Systems list. While one is selected, every region shows the same neutral tint and the caption says it is whole-body context.

## Profile

At generator v1 the model has 7 meshes, 2,363 vertices, 3,996 triangles and 7 draw calls in 86,240 bytes. The Khronos glTF Validator `2.0.0-dev.3.10` reports 0 errors, 0 warnings, 0 infos and 0 hints. The figure faces +Z with Y up, is about 1.8 units tall and stands on y = 0.
