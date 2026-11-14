import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  BODY_MODEL_DEFAULT_VIEW,
  BODY_MODEL_PITCH_LIMIT,
  BODY_MODEL_REGION_MAP,
  BODY_MODEL_REGION_TARGETS,
  BODY_MODEL_WHOLE_BODY_SYSTEMS,
  BODY_SYSTEM_DEFINITIONS,
  BodyModelParseError,
  BodySystemIdSchema,
  bodyModelCameraPosition,
  bodyModelHighlightFor,
  bodyModelRegionLabel,
  bodyModelSelectionCaption,
  bodySystemForMesh,
  decodeBase64,
  dragToRotation,
  loadMappedBodyModel,
  meshesForBodySystem,
  parseBodyModelGlb,
  resolveBodyVisualMode,
  rotateBodyModelView,
  shouldClaimRotationGesture,
} from '../src/index';
import {
  BODY_MODEL_GLB_BASE64,
  BODY_MODEL_GLB_BYTE_LENGTH,
  BODY_MODEL_GLB_SHA256,
} from '../src/bodyModelAsset';

const SHARED_ROOT = path.resolve(import.meta.dirname, '..');
const GLB_PATH = path.join(SHARED_ROOT, 'assets', 'models', 'crewsignal-body.glb');
const sha256 = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

describe('body model asset', () => {
  const fileBytes = new Uint8Array(fs.readFileSync(GLB_PATH));
  const embedded = decodeBase64(BODY_MODEL_GLB_BASE64);

  it('embedded module carries exactly the committed GLB bytes', () => {
    expect(embedded.byteLength).toBe(BODY_MODEL_GLB_BYTE_LENGTH);
    expect(sha256(embedded)).toBe(BODY_MODEL_GLB_SHA256);
    expect(sha256(fileBytes)).toBe(BODY_MODEL_GLB_SHA256);
  });

  it('stays lightweight', () => {
    expect(fileBytes.byteLength).toBeLessThan(150 * 1024);
  });

  it('is reproducible from its committed generator', () => {
    const out = execFileSync(process.execPath, [path.join(SHARED_ROOT, 'scripts', 'build-body-model.mjs'), '--check'], {
      encoding: 'utf8',
    });
    expect(out).toContain('crewsignal-body.glb reproducible: OK');
    expect(out).toContain('bodyModelAsset.ts reproducible: OK');
  });

  it('parses into mapped meshes with attribution metadata', () => {
    const model = loadMappedBodyModel(embedded);
    expect(model.copyright).toMatch(/POP N' SEB/);
    expect(model.generator).toMatch(/build-body-model\.mjs/);
    expect(model.meshes.map((m) => m.name).sort()).toEqual(Object.keys(BODY_MODEL_REGION_MAP).sort());
    for (const mesh of model.meshes) {
      expect(mesh.bodySystemId).toBe(BODY_MODEL_REGION_MAP[mesh.name]);
      expect(mesh.positions.length % 3).toBe(0);
      expect(mesh.normals?.length).toBe(mesh.positions.length);
      expect(mesh.indices.length % 3).toBe(0);
    }
  });

  it('rejects truncated, foreign or remapped assets', () => {
    expect(() => parseBodyModelGlb(embedded.subarray(0, 40))).toThrow(BodyModelParseError);
    expect(() => parseBodyModelGlb(new Uint8Array(64))).toThrow(/Not a GLB/);
    const json = JSON.stringify({ asset: { version: '2.0' } });
    expect(() => parseBodyModelGlb(new TextEncoder().encode(json))).toThrow(BodyModelParseError);

    // Flip region_torso's extras to another system: mapping guard must refuse.
    const text = Buffer.from(embedded).toString('latin1');
    const tampered = text.replace('"extras":{"bodySystemId":"cardiovascular"}', '"extras":{"bodySystemId":"musculoskeleta"}');
    expect(tampered).not.toBe(text);
    expect(() => loadMappedBodyModel(new Uint8Array(Buffer.from(tampered, 'latin1')))).toThrow(/region_torso/);
  });
});

describe('body model mapping', () => {
  it('maps only to existing BodySystemId values', () => {
    for (const id of Object.values(BODY_MODEL_REGION_MAP)) {
      if (id !== null) expect(BodySystemIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('every region target has meshes; whole-body systems have none', () => {
    for (const t of BODY_MODEL_REGION_TARGETS) expect(meshesForBodySystem(t.systemId).length).toBeGreaterThan(0);
    expect(BODY_MODEL_WHOLE_BODY_SYSTEMS).toEqual(['immune_context', 'nutrition_metabolism']);
    for (const id of BODY_MODEL_WHOLE_BODY_SYSTEMS) expect(meshesForBodySystem(id)).toEqual([]);
    const covered = new Set([...BODY_MODEL_REGION_TARGETS.map((t) => t.systemId), ...BODY_MODEL_WHOLE_BODY_SYSTEMS]);
    expect([...covered].sort()).toEqual(BODY_SYSTEM_DEFINITIONS.map((d) => d.id).sort());
  });

  it('resolves mesh names deterministically', () => {
    expect(bodySystemForMesh('region_head')).toBe('sleep_cognition');
    expect(bodySystemForMesh('region_leg_left')).toBe('musculoskeletal');
    expect(bodySystemForMesh('shape_neck')).toBeNull();
    expect(bodySystemForMesh('toString')).toBeNull();
    expect(bodySystemForMesh('unknown')).toBeNull();
  });

  it('labels carry the shared coverage status, including unassessed', () => {
    const labels = BODY_MODEL_REGION_TARGETS.map(bodyModelRegionLabel);
    expect(labels).toEqual([
      'Head: Sleep & cognition, Self-reported',
      'Chest: Cardiovascular, Manual observation',
      'Limbs: Musculoskeletal, Not assessed',
    ]);
    expect(bodyModelSelectionCaption('immune_context')).toMatch(/Not assessed · Context only.*Whole-body context/);
  });

  it('highlights one region, or tints all regions for whole-body context', () => {
    expect(bodyModelHighlightFor('cardiovascular', 'cardiovascular')).toBe('selected');
    expect(bodyModelHighlightFor('cardiovascular', 'musculoskeletal')).toBe('idle');
    expect(bodyModelHighlightFor('immune_context', 'musculoskeletal')).toBe('whole_body');
    expect(bodyModelHighlightFor('nutrition_metabolism', null)).toBe('idle');
  });
});

describe('body model camera and gestures', () => {
  it('clamps pitch, wraps yaw, and resets to the default', () => {
    let v = { ...BODY_MODEL_DEFAULT_VIEW };
    v = rotateBodyModelView(v, 0, 5);
    expect(v.pitch).toBe(BODY_MODEL_PITCH_LIMIT);
    v = rotateBodyModelView(v, Math.PI * 3);
    expect(v.yaw).toBeCloseTo(Math.PI, 10);
    expect(rotateBodyModelView({ yaw: 0, pitch: 0 }, Math.PI * 2).yaw).toBe(0);
    const [x, , z] = bodyModelCameraPosition({ yaw: 0, pitch: 0 });
    expect(x).toBeCloseTo(0, 10);
    expect(z).toBeGreaterThan(0);
  });

  it('converts drags proportionally to viewport width', () => {
    expect(dragToRotation(300, 0, 300).deltaYaw).toBeCloseTo(Math.PI, 10);
    expect(dragToRotation(0, 0, 0).deltaYaw).toBe(0);
  });

  it('leaves vertical gestures to page scrolling', () => {
    expect(shouldClaimRotationGesture(30, 4)).toBe(true);
    expect(shouldClaimRotationGesture(4, 30)).toBe(false);
    expect(shouldClaimRotationGesture(3, 0)).toBe(false);
    expect(shouldClaimRotationGesture(20, 20)).toBe(false);
  });
});

describe('body visual fallback policy', () => {
  const base = { preference: 'auto' as const, reducedMotion: false, support: 'available' as const, loadError: false, modelDefaultOnPlatform: true };

  it('defaults to the model only where allowed and motion is not reduced', () => {
    expect(resolveBodyVisualMode(base)).toEqual({ mode: 'model', reason: 'model_default', modelOffered: true });
    expect(resolveBodyVisualMode({ ...base, reducedMotion: true }).mode).toBe('diagram');
    expect(resolveBodyVisualMode({ ...base, modelDefaultOnPlatform: false })).toEqual({
      mode: 'diagram',
      reason: 'model_not_default_on_platform',
      modelOffered: true,
    });
  });

  it('honours an explicit choice, but failures always fall back', () => {
    expect(resolveBodyVisualMode({ ...base, reducedMotion: true, preference: 'model' }).mode).toBe('model');
    expect(resolveBodyVisualMode({ ...base, preference: 'diagram' }).mode).toBe('diagram');
    expect(resolveBodyVisualMode({ ...base, preference: 'model', loadError: true })).toEqual({
      mode: 'diagram',
      reason: 'load_error',
      modelOffered: false,
    });
    expect(resolveBodyVisualMode({ ...base, preference: 'model', support: 'unavailable' }).reason).toBe('graphics_unavailable');
  });
});
