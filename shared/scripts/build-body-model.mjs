#!/usr/bin/env node
/**
 * Reproducible source for the CrewSignal anatomical navigation model.
 *
 * Builds a deliberately simple, neutral, low-poly figure from parametric
 * ellipsoids and capsules and writes it as a single glTF 2.0 binary (GLB):
 *
 *   shared/assets/models/crewsignal-body.glb     canonical asset
 *   shared/src/bodyModelAsset.ts                 same bytes, base64-embedded
 *                                                so every app loads it locally
 *
 * The figure is an illustration for navigation only. It is not derived from
 * scan data and carries no anatomical measurement claims.
 *
 * Usage:
 *   node scripts/build-body-model.mjs           write both outputs
 *   node scripts/build-body-model.mjs --check   fail if outputs are stale
 *
 * The script has no dependencies. Every coordinate is rounded before encoding
 * so repeated runs produce byte-identical files.
 *
 * Copyright 2026 POP N' SEB. Licensed under the Apache License, Version 2.0.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHARED_ROOT = path.resolve(import.meta.dirname, '..');
const GLB_PATH = path.join(SHARED_ROOT, 'assets', 'models', 'crewsignal-body.glb');
const TS_PATH = path.join(SHARED_ROOT, 'src', 'bodyModelAsset.ts');

export const MODEL_GENERATOR = 'crewsignal shared/scripts/build-body-model.mjs v1';
export const MODEL_COPYRIGHT = "Copyright 2026 POP N' SEB. Apache-2.0.";

const R = 4; // decimals kept for positions and normals

// ---------------------------------------------------------------- vectors
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rotation that maps +Y onto unit vector d (Rodrigues). */
function rotationFromY(d) {
  const y = [0, 1, 0];
  const c = dot(y, d);
  if (c > 0.999999) return (v) => v;
  if (c < -0.999999) return (v) => [v[0], -v[1], -v[2]];
  const k = norm(cross(y, d));
  const s = Math.sqrt(1 - c * c);
  return (v) => {
    const kv = cross(k, v);
    const kdv = dot(k, v);
    return [
      v[0] * c + kv[0] * s + k[0] * kdv * (1 - c),
      v[1] * c + kv[1] * s + k[1] * kdv * (1 - c),
      v[2] * c + kv[2] * s + k[2] * kdv * (1 - c),
    ];
  };
}

// ---------------------------------------------------------------- shapes
function newGeometry() {
  return { positions: [], normals: [], indices: [] };
}

function appendGrid(geo, rows, cols, vertexAt) {
  const base = geo.positions.length / 3;
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const { p, n } = vertexAt(r, c);
      geo.positions.push(p[0], p[1], p[2]);
      geo.normals.push(n[0], n[1], n[2]);
    }
  }
  const stride = cols + 1;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const a = base + r * stride + c;
      const b = a + stride;
      // Counter-clockwise when viewed from outside.
      geo.indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
}

/** Axis-aligned ellipsoid. */
function ellipsoid(geo, center, radii, cols = 16, rows = 10) {
  appendGrid(geo, rows, cols, (r, c) => {
    const v = r / rows; // 0 top → 1 bottom
    const u = c / cols;
    const theta = v * Math.PI;
    const phi = u * Math.PI * 2;
    const sx = Math.sin(theta) * Math.sin(phi);
    const sy = Math.cos(theta);
    const sz = Math.sin(theta) * Math.cos(phi);
    return {
      p: [center[0] + sx * radii[0], center[1] + sy * radii[1], center[2] + sz * radii[2]],
      n: norm([sx / radii[0], sy / radii[1], sz / radii[2]]),
    };
  });
}

/**
 * Capsule from a to b with radius r. `depthScale` flattens it front-to-back
 * (world Z) after orientation, used for the torso.
 */
function capsule(geo, a, b, r, { cols = 14, capRows = 4, depthScale = 1 } = {}) {
  const axis = sub(b, a);
  const L = len(axis);
  const rot = rotationFromY(norm(axis));
  const rows = capRows * 2 + 1;
  appendGrid(geo, rows, cols, (row, c) => {
    // Rows 0..capRows: top hemisphere (at b); capRows+1..rows: bottom (at a).
    let theta;
    let yOffset;
    if (row <= capRows) {
      theta = (row / capRows) * (Math.PI / 2);
      yOffset = L;
    } else {
      theta = Math.PI / 2 + ((row - capRows - 1) / capRows) * (Math.PI / 2);
      yOffset = 0;
    }
    const phi = (c / cols) * Math.PI * 2;
    const local = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), Math.sin(theta) * Math.cos(phi)];
    const pLocal = [local[0] * r, local[1] * r + yOffset, local[2] * r];
    const p = rot(pLocal);
    const n = rot(local);
    return {
      p: [a[0] + p[0], a[1] + p[1], a[2] + p[2] * depthScale],
      n: norm([n[0], n[1], n[2] / depthScale]),
    };
  });
}

// ---------------------------------------------------------------- figure
function limb(side, parts) {
  const geo = newGeometry();
  // The figure faces +Z (towards the default camera), so its left side is +X.
  const s = side === 'left' ? 1 : -1;
  for (const part of parts) {
    if (part.kind === 'capsule') {
      capsule(
        geo,
        [part.a[0] * s, part.a[1], part.a[2]],
        [part.b[0] * s, part.b[1], part.b[2]],
        part.r,
        part.opts,
      );
    } else {
      ellipsoid(geo, [part.c[0] * s, part.c[1], part.c[2]], part.radii, part.cols, part.rows);
    }
  }
  return geo;
}

const ARM_PARTS = [
  { kind: 'capsule', a: [0.215, 1.4, 0], b: [0.262, 1.13, 0], r: 0.047 },
  { kind: 'capsule', a: [0.262, 1.13, 0.0], b: [0.292, 0.88, 0.02], r: 0.04 },
  { kind: 'ellipsoid', c: [0.3, 0.815, 0.025], radii: [0.032, 0.06, 0.045], cols: 12, rows: 8 },
];

const LEG_PARTS = [
  { kind: 'capsule', a: [0.088, 0.93, 0], b: [0.1, 0.51, 0.005], r: 0.068 },
  { kind: 'capsule', a: [0.1, 0.51, 0.005], b: [0.106, 0.12, -0.005], r: 0.052 },
  { kind: 'ellipsoid', c: [0.108, 0.045, 0.045], radii: [0.048, 0.035, 0.1], cols: 12, rows: 8 },
];

/**
 * Explicit region table (see buildFigure). Each node's `extras.bodySystemId`
 * must match BODY_MODEL_REGION_MAP in shared/src/bodyModel.ts; a shared test
 * enforces this. `null` marks geometry drawn for shape only, not a hit target.
 */
export function buildFigure() {
  const head = newGeometry();
  ellipsoid(head, [0, 1.625, 0], [0.098, 0.12, 0.108], 20, 14);

  const neck = newGeometry();
  capsule(neck, [0, 1.42, 0], [0, 1.52, 0], 0.048, { cols: 12, capRows: 3 });

  const torso = newGeometry();
  capsule(torso, [0, 0.99, 0], [0, 1.33, 0], 0.168, { cols: 22, capRows: 5, depthScale: 0.62 });

  return [
    { name: 'region_head', bodySystemId: 'sleep_cognition', geo: head },
    { name: 'shape_neck', bodySystemId: null, geo: neck },
    { name: 'region_torso', bodySystemId: 'cardiovascular', geo: torso },
    { name: 'region_arm_left', bodySystemId: 'musculoskeletal', geo: limb('left', ARM_PARTS) },
    { name: 'region_arm_right', bodySystemId: 'musculoskeletal', geo: limb('right', ARM_PARTS) },
    { name: 'region_leg_left', bodySystemId: 'musculoskeletal', geo: limb('left', LEG_PARTS) },
    { name: 'region_leg_right', bodySystemId: 'musculoskeletal', geo: limb('right', LEG_PARTS) },
  ];
}

// ---------------------------------------------------------------- GLB
const round = (x) => {
  const f = 10 ** R;
  const v = Math.round(x * f) / f;
  return Object.is(v, -0) ? 0 : v;
};

const pad4 = (n) => (n + 3) & ~3;

export function encodeGlb(meshes) {
  const bufferViews = [];
  const accessors = [];
  const gltfMeshes = [];
  const nodes = [];
  const chunks = [];
  let offset = 0;

  const pushView = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const padded = Buffer.alloc(pad4(bytes.length));
    bytes.copy(padded);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    chunks.push(padded);
    offset += padded.length;
    return bufferViews.length - 1;
  };

  for (const mesh of meshes) {
    const pos = new Float32Array(mesh.geo.positions.map(round));
    const nrm = new Float32Array(mesh.geo.normals.map(round));
    const idx = new Uint16Array(mesh.geo.indices);
    if (pos.length / 3 > 65535) throw new Error(`${mesh.name}: too many vertices`);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }

    const posView = pushView(pos, 34962);
    const nrmView = pushView(nrm, 34962);
    const idxView = pushView(idx, 34963);
    const count = pos.length / 3;
    accessors.push({ bufferView: posView, componentType: 5126, count, type: 'VEC3', min, max });
    const posAcc = accessors.length - 1;
    accessors.push({ bufferView: nrmView, componentType: 5126, count, type: 'VEC3' });
    const nrmAcc = accessors.length - 1;
    accessors.push({ bufferView: idxView, componentType: 5123, count: idx.length, type: 'SCALAR' });
    const idxAcc = accessors.length - 1;

    gltfMeshes.push({
      name: mesh.name,
      primitives: [
        { attributes: { POSITION: posAcc, NORMAL: nrmAcc }, indices: idxAcc, material: 0, mode: 4 },
      ],
    });
    nodes.push({
      name: mesh.name,
      mesh: gltfMeshes.length - 1,
      extras: { bodySystemId: mesh.bodySystemId },
    });
  }

  const childIndices = nodes.map((_, i) => i);
  nodes.push({ name: 'CrewSignalBody', children: childIndices });

  const json = {
    asset: { version: '2.0', generator: MODEL_GENERATOR, copyright: MODEL_COPYRIGHT },
    scene: 0,
    scenes: [{ name: 'CrewSignalBodyScene', nodes: [nodes.length - 1] }],
    nodes,
    meshes: gltfMeshes,
    materials: [
      {
        name: 'neutral',
        pbrMetallicRoughness: { baseColorFactor: [0.55, 0.58, 0.62, 1], metallicFactor: 0, roughnessFactor: 0.9 },
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPadded = Buffer.alloc(pad4(jsonBuf.length), 0x20);
  jsonBuf.copy(jsonPadded);
  jsonBuf = jsonPadded;
  const bin = Buffer.concat(chunks);

  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, bin]);
}

export function renderAssetModule(glb) {
  const sha256 = crypto.createHash('sha256').update(glb).digest('hex');
  const b64 = glb.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 100) lines.push(`  '${b64.slice(i, i + 100)}',`);
  return [
    '// GENERATED by shared/scripts/build-body-model.mjs. Do not edit by hand.',
    '// Same bytes as shared/assets/models/crewsignal-body.glb (glTF 2.0 binary).',
    "// Copyright 2026 POP N' SEB. Licensed under the Apache License, Version 2.0.",
    '',
    `export const BODY_MODEL_GLB_SHA256 = '${sha256}';`,
    `export const BODY_MODEL_GLB_BYTE_LENGTH = ${glb.length};`,
    '',
    'export const BODY_MODEL_GLB_BASE64 = [',
    ...lines,
    "].join('');",
    '',
  ].join('\n');
}

function main() {
  const glb = encodeGlb(buildFigure());
  const moduleText = renderAssetModule(glb);
  if (process.argv.includes('--check')) {
    const glbOk = fs.existsSync(GLB_PATH) && Buffer.compare(fs.readFileSync(GLB_PATH), glb) === 0;
    const tsOk =
      fs.existsSync(TS_PATH) &&
      fs.readFileSync(TS_PATH, 'utf8').replace(/\r\n/g, '\n') === moduleText;
    console.log(`crewsignal-body.glb reproducible: ${glbOk ? 'OK' : 'STALE'}`);
    console.log(`bodyModelAsset.ts reproducible: ${tsOk ? 'OK' : 'STALE'}`);
    process.exit(glbOk && tsOk ? 0 : 1);
  }
  fs.mkdirSync(path.dirname(GLB_PATH), { recursive: true });
  fs.writeFileSync(GLB_PATH, glb);
  fs.writeFileSync(TS_PATH, moduleText, 'utf8');
  const sha = crypto.createHash('sha256').update(glb).digest('hex');
  console.log(`Wrote ${path.relative(SHARED_ROOT, GLB_PATH)} (${glb.length} bytes, sha256 ${sha})`);
  console.log(`Wrote ${path.relative(SHARED_ROOT, TS_PATH)}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build-body-model.mjs')) {
  main();
}
