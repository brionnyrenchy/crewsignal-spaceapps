import {
  BODY_MODEL_CAMERA_DISTANCE,
  BODY_MODEL_CAMERA_FOV_DEG,
  BODY_MODEL_CAMERA_TARGET,
  bodyModelCameraPosition,
  bodyModelHighlightFor,
  decodeBase64,
  loadMappedBodyModel,
  type BodyModelView,
  type BodySystemId,
} from '../../shared';
import { BODY_MODEL_GLB_BASE64 } from '../../shared/src/bodyModelAsset';

export interface BodyModelColors {
  idle: string;
  selected: string;
  wholeBody: string;
}

export interface BodyModelSceneController {
  setSelected(id: BodySystemId): void;
  setView(view: BodyModelView): void;
  setColors(colors: BodyModelColors): void;
  resize(width: number, height: number): void;
  pick(x: number, y: number): BodySystemId | null;
  dispose(): void;
}

type Vec3 = readonly [number, number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function cameraMatrix(view: BodyModelView): Float32Array {
  const eye = bodyModelCameraPosition(view, BODY_MODEL_CAMERA_DISTANCE);
  const target = BODY_MODEL_CAMERA_TARGET;
  const z = unit([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = unit(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

function projectionMatrix(aspect: number): Float32Array {
  const f = 1 / Math.tan(BODY_MODEL_CAMERA_FOV_DEG * Math.PI / 360);
  const near = 0.1;
  const far = 20;
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0,
  ]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      for (let k = 0; k < 4; k++) result[col * 4 + row]! += a[k * 4 + row]! * b[col * 4 + k]!;
    }
  }
  return result;
}

function rgb(css: string): [number, number, number] {
  const channels = css.match(/[\d.]+/g)?.map(Number) ?? [125, 125, 125];
  return [channels[0]! / 255, channels[1]! / 255, channels[2]! / 255];
}

/** Reuses the bundled GLB and shared region mapping without a remote loader. */
export function createBodyModelScene(canvas: HTMLCanvasElement, options: {
  colors: BodyModelColors;
  selectedId: BodySystemId;
  view: BodyModelView;
  onContextLost: () => void;
}): BodyModelSceneController {
  const model = loadMappedBodyModel(decodeBase64(BODY_MODEL_GLB_BASE64));
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'low-power' });
  if (!gl) throw new Error('WebGL2 is unavailable');
  const shaders: WebGLShader[] = [];
  const buffers: WebGLBuffer[] = [];
  const arrays: WebGLVertexArrayObject[] = [];
  let program: WebGLProgram | null = null;
  let frame = 0;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    canvas.removeEventListener('webglcontextlost', onLost);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const array of arrays) gl.deleteVertexArray(array);
    for (const shader of shaders) gl.deleteShader(shader);
    if (program) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    if (!disposed) options.onContextLost();
  };

  try {
    const shader = (type: number, source: string) => {
      const compiled = gl.createShader(type);
      if (!compiled) throw new Error('Cannot create model shader');
      shaders.push(compiled);
      gl.shaderSource(compiled, source);
      gl.compileShader(compiled);
      if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) throw new Error('Cannot compile model shader');
      return compiled;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Cannot create model program');
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      layout(location = 0) in vec3 position;
      layout(location = 1) in vec3 normal;
      uniform mat4 view;
      uniform mat4 viewProjection;
      out vec3 surfaceNormal;
      void main() {
        surfaceNormal = mat3(view) * normal;
        gl_Position = viewProjection * vec4(position, 1.0);
      }`));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec3 surfaceNormal;
      uniform vec3 color;
      out vec4 fragment;
      void main() {
        vec3 n = normalize(surfaceNormal);
        float light = 0.48 + 0.52 * max(dot(n, normalize(vec3(0.4, 0.7, 1.0))), 0.0);
        fragment = vec4(color * light, 1.0);
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Cannot link model program');
    const viewUniform = gl.getUniformLocation(program, 'view');
    const projectionUniform = gl.getUniformLocation(program, 'viewProjection');
    const colorUniform = gl.getUniformLocation(program, 'color');

    const meshes = model.meshes.map(mesh => {
      const vao = gl.createVertexArray();
      if (!vao) throw new Error('Cannot create model geometry');
      arrays.push(vao);
      gl.bindVertexArray(vao);
      const upload = (target: number, data: ArrayBufferView) => {
        const buffer = gl.createBuffer();
        if (!buffer) throw new Error('Cannot create model buffer');
        buffers.push(buffer);
        gl.bindBuffer(target, buffer);
        gl.bufferData(target, data, gl.STATIC_DRAW);
      };
      upload(gl.ARRAY_BUFFER, mesh.positions);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (mesh.normals) {
        upload(gl.ARRAY_BUFFER, mesh.normals);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      } else {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 1);
      }
      upload(gl.ELEMENT_ARRAY_BUFFER, mesh.indices);
      return { ...mesh, vao, indexType: mesh.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    });
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    canvas.addEventListener('webglcontextlost', onLost);
    let selected = options.selectedId;
    let view = options.view;
    let colors = options.colors;
    let width = 1;
    let height = 1;
    const matrices = () => {
      const camera = cameraMatrix(view);
      return { camera, combined: multiply(projectionMatrix(width / height), camera) };
    };
    const render = () => {
      frame = 0;
      if (disposed) return;
      const { camera, combined } = matrices();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniformMatrix4fv(viewUniform, false, camera);
      gl.uniformMatrix4fv(projectionUniform, false, combined);
      for (const mesh of meshes) {
        const highlight = bodyModelHighlightFor(selected, mesh.bodySystemId);
        gl.uniform3fv(colorUniform, rgb(highlight === 'selected' ? colors.selected : highlight === 'whole_body' ? colors.wholeBody : colors.idle));
        gl.bindVertexArray(mesh.vao);
        gl.drawElements(gl.TRIANGLES, mesh.indices.length, mesh.indexType, 0);
      }
      gl.bindVertexArray(null);
    };
    const requestRender = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(render);
    };
    return {
      setSelected(id) { selected = id; requestRender(); },
      setView(next) { view = next; requestRender(); },
      setColors(next) { colors = next; requestRender(); },
      resize(w, h) {
        width = Math.max(1, w);
        height = Math.max(1, h);
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        requestRender();
      },
      pick(x, y) {
        const { combined: m } = matrices();
        let closest = Infinity;
        let hit: BodySystemId | null = null;
        for (const mesh of meshes) {
          const project = (index: number): Vec3 | null => {
            const v = mesh.positions;
            const px = v[index * 3]!;
            const py = v[index * 3 + 1]!;
            const pz = v[index * 3 + 2]!;
            const w = m[3]! * px + m[7]! * py + m[11]! * pz + m[15]!;
            if (w <= 0) return null;
            return [
              ((m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!) / w + 1) * width / 2,
              (1 - (m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!) / w) * height / 2,
              (m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!) / w,
            ];
          };
          const vertices = Array.from({ length: mesh.positions.length / 3 }, (_, i) => project(i));
          for (let i = 0; i < mesh.indices.length; i += 3) {
            const a = vertices[mesh.indices[i]!]!;
            const b = vertices[mesh.indices[i + 1]!]!;
            const c = vertices[mesh.indices[i + 2]!]!;
            if (!a || !b || !c) continue;
            const area = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
            if (Math.abs(area) < 1e-8) continue;
            const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / area;
            const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / area;
            const t = 1 - u - v;
            const depth = u * a[2] + v * b[2] + t * c[2];
            if (u >= 0 && v >= 0 && t >= 0 && depth >= -1 && depth <= 1 && depth < closest) {
              closest = depth;
              hit = mesh.bodySystemId;
            }
          }
        }
        return hit;
      },
      dispose: cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
