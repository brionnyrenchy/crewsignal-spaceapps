/**
 * Expo GL adapter for the Health Explorer's 3D navigation illustration.
 *
 * It uses the same GLB, the same region mapping and the same camera model as
 * the Windows app, through the shared adapter in ../../shared/src/bodyModel.
 * three.js draws into the native GL context that expo-gl provides. It renders
 * on demand only, with no animation loop and no auto-rotation, and dispose()
 * releases every GPU resource.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import type { ExpoWebGLRenderingContext } from 'expo-gl';
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
} from '../../shared/src';
import { BODY_MODEL_GLB_BASE64 } from '../../shared/src/bodyModelAsset';

export interface BodyModelColorsNative {
  idle: string;
  selected: string;
  wholeBody: string;
}

export interface BodyModelSceneControllerNative {
  setSelected(id: BodySystemId): void;
  setView(view: BodyModelView): void;
  setColors(colors: BodyModelColorsNative): void;
  /** Layout size of the GLView in dp. */
  resize(widthDp: number, heightDp: number): void;
  /** Hit test in GLView-local dp coordinates. */
  pick(xDp: number, yDp: number): BodySystemId | null;
  dispose(): void;
}

export interface BodyModelSceneOptionsNative {
  colors: BodyModelColorsNative;
  selectedId: BodySystemId;
  view: BodyModelView;
  widthDp: number;
  heightDp: number;
}

export type CreateBodyModelSceneNative = (
  gl: ExpoWebGLRenderingContext,
  options: BodyModelSceneOptionsNative,
) => BodyModelSceneControllerNative;

/** Minimal canvas stand-in so three.js can wrap the expo-gl context. */
function canvasShim(gl: ExpoWebGLRenderingContext) {
  return {
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    style: {},
    clientWidth: gl.drawingBufferWidth,
    clientHeight: gl.drawingBufferHeight,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext: () => gl,
  } as unknown as HTMLCanvasElement;
}

export const createBodyModelSceneGL: CreateBodyModelSceneNative = (gl, options) => {
  // Parse first so a bad asset fails before any GPU work.
  const model = loadMappedBodyModel(decodeBase64(BODY_MODEL_GLB_BASE64));

  const renderer = new WebGLRenderer({
    canvas: canvasShim(gl),
    context: gl as unknown as WebGL2RenderingContext,
    antialias: false,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(BODY_MODEL_CAMERA_FOV_DEG, 1, 0.1, 20);
  const key = new DirectionalLight(0xffffff, 6.5);
  key.position.set(0.7, 1.1, 1);
  camera.add(key);
  const rim = new DirectionalLight(0xffffff, 1.6);
  rim.position.set(-1, 0.3, -0.6);
  camera.add(rim);
  scene.add(camera);
  scene.add(new AmbientLight(0xffffff, 2.4));

  const root = new Group();
  scene.add(root);
  const meshes: Mesh<BufferGeometry, MeshLambertMaterial>[] = [];
  for (const parsed of model.meshes) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(parsed.positions, 3));
    if (parsed.normals) geometry.setAttribute('normal', new BufferAttribute(parsed.normals, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new BufferAttribute(parsed.indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, new MeshLambertMaterial({ color: 0x888888 }));
    mesh.name = parsed.name;
    mesh.userData.bodySystemId = parsed.bodySystemId;
    root.add(mesh);
    meshes.push(mesh);
  }

  let selectedId = options.selectedId;
  let view = options.view;
  let colors = options.colors;
  let layout = { w: Math.max(1, options.widthDp), h: Math.max(1, options.heightDp) };
  let disposed = false;
  let frame: number | null = null;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const tmp = new Color();

  const applyColors = () => {
    for (const mesh of meshes) {
      const h = bodyModelHighlightFor(selectedId, mesh.userData.bodySystemId as BodySystemId | null);
      tmp.set(h === 'selected' ? colors.selected : h === 'whole_body' ? colors.wholeBody : colors.idle);
      mesh.material.color.copy(tmp);
    }
  };
  const applyCamera = () => {
    camera.aspect = layout.w / layout.h;
    camera.updateProjectionMatrix();
    const [x, y, z] = bodyModelCameraPosition(view, BODY_MODEL_CAMERA_DISTANCE);
    camera.position.set(x, y, z);
    camera.lookAt(...BODY_MODEL_CAMERA_TARGET);
  };
  const render = () => {
    frame = null;
    if (disposed) return;
    renderer.setSize(gl.drawingBufferWidth, gl.drawingBufferHeight, false);
    renderer.render(scene, camera);
    gl.endFrameEXP();
  };
  const requestRender = () => {
    if (disposed || frame !== null) return;
    frame = requestAnimationFrame(render);
  };

  applyColors();
  applyCamera();
  render();

  return {
    setSelected(id) {
      selectedId = id;
      applyColors();
      requestRender();
    },
    setView(next) {
      view = next;
      applyCamera();
      requestRender();
    },
    setColors(next) {
      colors = next;
      applyColors();
      requestRender();
    },
    resize(widthDp, heightDp) {
      layout = { w: Math.max(1, widthDp), h: Math.max(1, heightDp) };
      applyCamera();
      requestRender();
    },
    pick(xDp, yDp) {
      ndc.set((xDp / layout.w) * 2 - 1, -(yDp / layout.h) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      for (const hit of raycaster.intersectObjects(meshes, false)) {
        const id = hit.object.userData.bodySystemId as BodySystemId | null;
        if (id) return id;
      }
      return null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      renderer.dispose();
    },
  };
};
