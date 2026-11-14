/**
 * Renderer-agnostic support for the Health Explorer's 3D anatomical
 * navigation illustration.
 *
 * Everything here is pure TypeScript with no DOM, WebGL or React Native
 * dependency, so the Windows (three.js in the Tauri WebView) and Android
 * (three.js on Expo GL) adapters share one mapping, one parser, one camera
 * model and one fallback policy, and all of it is unit-testable.
 *
 * The model is a navigation aid only. The Systems list and detail panel stay
 * the source of accessible labels and measured / self-reported / context-only
 * status; nothing here adds or implies a measurement.
 */
import type { BodySystemId } from './contracts';
import { BODY_SYSTEM_DEFINITIONS } from './metrics';

// ------------------------------------------------------------------ mapping

/**
 * Explicit mapping from named GLB nodes to existing BodySystemId values.
 * `null` = drawn for shape only, never a hit target. The asset generator
 * writes the same value into each node's `extras.bodySystemId`; a shared test
 * fails if the two disagree or if a node is unmapped.
 */
export const BODY_MODEL_REGION_MAP: Readonly<Record<string, BodySystemId | null>> = {
  region_head: 'sleep_cognition',
  shape_neck: null,
  region_torso: 'cardiovascular',
  region_arm_left: 'musculoskeletal',
  region_arm_right: 'musculoskeletal',
  region_leg_left: 'musculoskeletal',
  region_leg_right: 'musculoskeletal',
};

export interface BodyModelRegionTarget {
  systemId: BodySystemId;
  /** Short anatomical label for the hit target (e.g. "Head"). */
  regionLabel: string;
}

/**
 * Systems that have a region on the model, in display order. Whole-body
 * systems (immune context, nutrition & metabolism) intentionally have no
 * region: they stay in the list as whole-body context.
 */
export const BODY_MODEL_REGION_TARGETS: readonly BodyModelRegionTarget[] = [
  { systemId: 'sleep_cognition', regionLabel: 'Head' },
  { systemId: 'cardiovascular', regionLabel: 'Chest' },
  { systemId: 'musculoskeletal', regionLabel: 'Limbs' },
];

export const BODY_MODEL_WHOLE_BODY_SYSTEMS: readonly BodySystemId[] =
  BODY_SYSTEM_DEFINITIONS.filter((s) => s.anchorType === 'whole_body').map((s) => s.id);

export function bodySystemForMesh(meshName: string): BodySystemId | null {
  return Object.prototype.hasOwnProperty.call(BODY_MODEL_REGION_MAP, meshName)
    ? (BODY_MODEL_REGION_MAP[meshName] ?? null)
    : null;
}

export function meshesForBodySystem(systemId: BodySystemId): string[] {
  return Object.entries(BODY_MODEL_REGION_MAP)
    .filter(([, id]) => id === systemId)
    .map(([name]) => name);
}

export function isModelRegionSystem(systemId: BodySystemId): boolean {
  return BODY_MODEL_REGION_TARGETS.some((t) => t.systemId === systemId);
}

/** Accessible label for a region control, built from the shared definitions. */
export function bodyModelRegionLabel(target: BodyModelRegionTarget): string {
  const def = BODY_SYSTEM_DEFINITIONS.find((s) => s.id === target.systemId);
  if (!def) return target.regionLabel;
  return `${target.regionLabel}: ${def.name}, ${def.coverageLabel}`;
}

export type BodyModelHighlight = 'selected' | 'whole_body' | 'idle';

/**
 * How a mesh should be drawn for the current selection. When a whole-body
 * system is selected, every selectable region shows a uniform context tint,
 * so no single region is implied to be measured.
 */
export function bodyModelHighlightFor(
  selectedId: BodySystemId,
  meshSystemId: BodySystemId | null,
): BodyModelHighlight {
  if (BODY_MODEL_WHOLE_BODY_SYSTEMS.includes(selectedId)) {
    return meshSystemId === null ? 'idle' : 'whole_body';
  }
  return meshSystemId !== null && meshSystemId === selectedId ? 'selected' : 'idle';
}

/** Short visible caption that pairs the colour highlight with text. */
export function bodyModelSelectionCaption(selectedId: BodySystemId): string {
  const def = BODY_SYSTEM_DEFINITIONS.find((s) => s.id === selectedId);
  const name = def?.name ?? selectedId;
  const coverage = def?.coverageLabel ?? '';
  if (BODY_MODEL_WHOLE_BODY_SYSTEMS.includes(selectedId)) {
    return `Selected: ${name} (${coverage}). Whole-body context, not a single region.`;
  }
  const region = BODY_MODEL_REGION_TARGETS.find((t) => t.systemId === selectedId);
  return `Selected: ${region ? `${region.regionLabel}, ` : ''}${name} (${coverage}).`;
}

// ------------------------------------------------------------------ camera

export interface BodyModelView {
  /** Rotation around the vertical axis, radians, wrapped to (-PI, PI]. */
  yaw: number;
  /** Tilt, radians, clamped to ±BODY_MODEL_PITCH_LIMIT. */
  pitch: number;
}

export const BODY_MODEL_DEFAULT_VIEW: Readonly<BodyModelView> = { yaw: 0, pitch: 0.08 };
export const BODY_MODEL_PITCH_LIMIT = 0.6;
export const BODY_MODEL_ROTATE_STEP = Math.PI / 8;
/** Pointer travel (px) below which a press counts as a tap, not a drag. */
export const BODY_MODEL_TAP_SLOP_PX = 6;
/** Camera framing for a ~1.8 unit tall figure centred at TARGET. */
export const BODY_MODEL_CAMERA_TARGET: readonly [number, number, number] = [0, 0.9, 0];
export const BODY_MODEL_CAMERA_DISTANCE = 3.1;
export const BODY_MODEL_CAMERA_FOV_DEG = 38;

function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = ((a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  if (r <= -Math.PI) r += twoPi;
  return Math.abs(r) < 1e-12 ? 0 : r;
}

export function rotateBodyModelView(
  view: BodyModelView,
  deltaYaw: number,
  deltaPitch = 0,
): BodyModelView {
  const pitch = Math.max(
    -BODY_MODEL_PITCH_LIMIT,
    Math.min(BODY_MODEL_PITCH_LIMIT, view.pitch + deltaPitch),
  );
  return { yaw: wrapAngle(view.yaw + deltaYaw), pitch };
}

/** Converts a drag in pixels to a rotation; a full-width drag ≈ one half turn. */
export function dragToRotation(
  dxPx: number,
  dyPx: number,
  viewportWidthPx: number,
): { deltaYaw: number; deltaPitch: number } {
  const width = Math.max(1, viewportWidthPx);
  const k = Math.PI / width;
  return { deltaYaw: dxPx * k, deltaPitch: dyPx * k };
}

export function bodyModelCameraPosition(
  view: BodyModelView,
  distance = BODY_MODEL_CAMERA_DISTANCE,
): [number, number, number] {
  const [tx, ty, tz] = BODY_MODEL_CAMERA_TARGET;
  const cp = Math.cos(view.pitch);
  return [
    tx + distance * cp * Math.sin(view.yaw),
    ty + distance * Math.sin(view.pitch),
    tz + distance * cp * Math.cos(view.yaw),
  ];
}

/**
 * Decides whether a touch gesture should rotate the model or be left to the
 * page scroll. Horizontal-dominant moves rotate; vertical moves scroll.
 */
export function shouldClaimRotationGesture(dx: number, dy: number): boolean {
  return Math.abs(dx) > BODY_MODEL_TAP_SLOP_PX && Math.abs(dx) > Math.abs(dy) * 1.2;
}

// ------------------------------------------------------------------ fallback

export type BodyVisualPreference = 'auto' | 'model' | 'diagram';
export type BodyModelSupport = 'unknown' | 'available' | 'unavailable';

export type BodyVisualReason =
  | 'model_selected'
  | 'model_default'
  | 'diagram_selected'
  | 'reduced_motion'
  | 'graphics_unavailable'
  | 'load_error'
  | 'model_not_default_on_platform';

export interface BodyVisualDecision {
  mode: 'model' | 'diagram';
  reason: BodyVisualReason;
  /** Whether the person may switch to the 3D model from here. */
  modelOffered: boolean;
}

/**
 * Single fallback policy for both apps. Failures always win; otherwise an
 * explicit choice wins; otherwise reduced motion and platform defaults pick
 * the SVG diagram, which stays one control away.
 */
export function resolveBodyVisualMode(input: {
  preference: BodyVisualPreference;
  reducedMotion: boolean;
  support: BodyModelSupport;
  loadError: boolean;
  modelDefaultOnPlatform: boolean;
}): BodyVisualDecision {
  if (input.support === 'unavailable') {
    return { mode: 'diagram', reason: 'graphics_unavailable', modelOffered: false };
  }
  if (input.loadError) {
    return { mode: 'diagram', reason: 'load_error', modelOffered: false };
  }
  if (input.preference === 'diagram') {
    return { mode: 'diagram', reason: 'diagram_selected', modelOffered: true };
  }
  if (input.preference === 'model') {
    return { mode: 'model', reason: 'model_selected', modelOffered: true };
  }
  if (input.reducedMotion) {
    return { mode: 'diagram', reason: 'reduced_motion', modelOffered: true };
  }
  if (!input.modelDefaultOnPlatform) {
    return { mode: 'diagram', reason: 'model_not_default_on_platform', modelOffered: true };
  }
  return { mode: 'model', reason: 'model_default', modelOffered: true };
}

export function bodyVisualStatusMessage(reason: BodyVisualReason): string | null {
  switch (reason) {
    case 'graphics_unavailable':
      return '3D graphics are not available on this device. Showing the diagram instead; every system is also in the list.';
    case 'load_error':
      return 'The 3D model could not be shown. Showing the diagram instead; every system is also in the list.';
    case 'reduced_motion':
      return 'Showing the diagram because reduced motion is on. You can still open the 3D model.';
    default:
      return null;
  }
}

// ------------------------------------------------------------------ GLB

export interface ParsedBodyMesh {
  name: string;
  bodySystemId: BodySystemId | null;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint16Array | Uint32Array;
}

export interface ParsedBodyModel {
  generator: string | null;
  copyright: string | null;
  meshes: ParsedBodyMesh[];
}

export class BodyModelParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyModelParseError';
  }
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Dependency-free base64 decoder (Hermes, WebView and Node all behave alike). */
export function decodeBase64(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  const lookup = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i += 1) lookup[B64_ALPHABET.charCodeAt(i)] = i;
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const v = lookup[clean.charCodeAt(i)] ?? -1;
    if (v < 0) throw new BodyModelParseError('Invalid base64 input');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buffer >> bits) & 0xff;
      o += 1;
    }
  }
  return out.subarray(0, o);
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i]!;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 >= 0xc0 && b0 < 0xe0) {
      cp = ((b0 & 0x1f) << 6) | (bytes[i + 1]! & 0x3f);
      i += 2;
    } else if (b0 >= 0xe0 && b0 < 0xf0) {
      cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
      i += 3;
    } else {
      cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfJson {
  asset?: { version?: string; generator?: string; copyright?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    extras?: { bodySystemId?: unknown };
  }[];
  meshes?: {
    name?: string;
    primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[];
  }[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
}

/**
 * Minimal GLB reader for CrewSignal's own simple asset: triangle-list meshes
 * with float32 POSITION/NORMAL and uint16/uint32 indices in the embedded BIN
 * chunk, no node transforms, no textures, no extensions. Anything outside that
 * profile is rejected loudly so the UI falls back to the diagram instead of
 * drawing something wrong.
 */
export function parseBodyModelGlb(bytes: Uint8Array): ParsedBodyModel {
  if (bytes.byteLength < 20) throw new BodyModelParseError('GLB too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new BodyModelParseError('Not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new BodyModelParseError('Unsupported GLB version');
  const total = dv.getUint32(8, true);
  if (total !== bytes.byteLength) throw new BodyModelParseError('GLB length mismatch');

  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= total) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > total) throw new BodyModelParseError('GLB chunk overflow');
    const chunk = bytes.subarray(start, start + chunkLength);
    if (chunkType === 0x4e4f534a) {
      try {
        json = JSON.parse(decodeUtf8(chunk)) as GltfJson;
      } catch {
        throw new BodyModelParseError('GLB JSON chunk is not valid JSON');
      }
    } else if (chunkType === 0x004e4942) {
      bin = chunk;
    }
    offset = start + chunkLength;
  }
  if (!json) throw new BodyModelParseError('GLB has no JSON chunk');
  if (!bin) throw new BodyModelParseError('GLB has no BIN chunk');
  if (json.asset?.version !== '2.0') throw new BodyModelParseError('Not glTF 2.0');

  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const views = json.bufferViews ?? [];
  const binChunk = bin;

  const readAccessor = (index: number, expectType: string): Float32Array | Uint16Array | Uint32Array => {
    const acc = accessors[index];
    if (!acc || acc.bufferView === undefined) throw new BodyModelParseError(`Accessor ${index} missing`);
    if (acc.type !== expectType) throw new BodyModelParseError(`Accessor ${index} has type ${acc.type}`);
    const view = views[acc.bufferView];
    if (!view || view.buffer !== 0) throw new BodyModelParseError(`Buffer view ${acc.bufferView} missing`);
    const comps = expectType === 'VEC3' ? 3 : 1;
    const bytesPer = acc.componentType === 5126 || acc.componentType === 5125 ? 4 : acc.componentType === 5123 ? 2 : 0;
    if (bytesPer === 0) throw new BodyModelParseError(`Accessor ${index} component type unsupported`);
    if (view.byteStride !== undefined && view.byteStride !== comps * bytesPer) {
      throw new BodyModelParseError(`Accessor ${index} is interleaved`);
    }
    const start = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const length = acc.count * comps;
    if (start + length * bytesPer > (view.byteOffset ?? 0) + view.byteLength) {
      throw new BodyModelParseError(`Accessor ${index} overruns its buffer view`);
    }
    // Copy so the result is aligned and independent of the source buffer.
    const slice = binChunk.slice(start, start + length * bytesPer);
    if (acc.componentType === 5126) return new Float32Array(slice.buffer, 0, length);
    if (acc.componentType === 5125) return new Uint32Array(slice.buffer, 0, length);
    return new Uint16Array(slice.buffer, 0, length);
  };

  const out: ParsedBodyMesh[] = [];
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    if (node.matrix || node.translation || node.rotation || node.scale) {
      throw new BodyModelParseError(`Node ${node.name ?? '?'} uses transforms; bake them into vertices`);
    }
    const mesh = meshes[node.mesh];
    if (!mesh || mesh.primitives.length !== 1) {
      throw new BodyModelParseError(`Mesh for node ${node.name ?? '?'} must have one primitive`);
    }
    const prim = mesh.primitives[0]!;
    if ((prim.mode ?? 4) !== 4) throw new BodyModelParseError('Only triangle lists are supported');
    if (prim.attributes.POSITION === undefined || prim.indices === undefined) {
      throw new BodyModelParseError(`Mesh ${mesh.name ?? '?'} lacks POSITION or indices`);
    }
    const positions = readAccessor(prim.attributes.POSITION, 'VEC3');
    if (!(positions instanceof Float32Array)) throw new BodyModelParseError('POSITION must be float32');
    const normals =
      prim.attributes.NORMAL !== undefined ? readAccessor(prim.attributes.NORMAL, 'VEC3') : null;
    if (normals && !(normals instanceof Float32Array)) throw new BodyModelParseError('NORMAL must be float32');
    const indices = readAccessor(prim.indices, 'SCALAR');
    if (indices instanceof Float32Array) throw new BodyModelParseError('Indices must be integers');
    const vertexCount = positions.length / 3;
    for (let i = 0; i < indices.length; i += 1) {
      if (indices[i]! >= vertexCount) throw new BodyModelParseError(`Index out of range in ${node.name}`);
    }
    const name = node.name ?? mesh.name ?? `mesh_${out.length}`;
    const extrasId = node.extras?.bodySystemId;
    out.push({
      name,
      bodySystemId:
        typeof extrasId === 'string' ? (extrasId as BodySystemId) : bodySystemForMesh(name),
      positions,
      normals,
      indices,
    });
  }
  if (out.length === 0) throw new BodyModelParseError('GLB contains no meshes');

  return {
    generator: json.asset?.generator ?? null,
    copyright: json.asset?.copyright ?? null,
    meshes: out,
  };
}

/**
 * Parses the model and enforces that every mesh is covered by the explicit
 * mapping and agrees with it, so a re-exported asset cannot silently remap a
 * region.
 */
export function loadMappedBodyModel(bytes: Uint8Array): ParsedBodyModel {
  const model = parseBodyModelGlb(bytes);
  for (const mesh of model.meshes) {
    if (!Object.prototype.hasOwnProperty.call(BODY_MODEL_REGION_MAP, mesh.name)) {
      throw new BodyModelParseError(`Mesh ${mesh.name} is not in BODY_MODEL_REGION_MAP`);
    }
    if (BODY_MODEL_REGION_MAP[mesh.name] !== mesh.bodySystemId) {
      throw new BodyModelParseError(`Mesh ${mesh.name} maps to ${String(mesh.bodySystemId)} in the asset`);
    }
  }
  return model;
}
