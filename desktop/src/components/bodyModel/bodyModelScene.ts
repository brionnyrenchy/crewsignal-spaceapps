/**
 * three.js scene for the Health Explorer's 3D navigation illustration.
 *
 * Loaded on demand (dynamic import) so the renderer never weighs on app
 * start-up. It renders only when something changes, with no animation loop
 * and no auto-rotation. dispose() releases every GPU resource and the WebGL
 * context so leaving the route or hiding the window frees the renderer.
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
} from "three";
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
} from "../../shared/src";
import { BODY_MODEL_GLB_BASE64 } from "../../shared/src/bodyModelAsset";

export interface BodyModelColors {
  idle: string;
  selected: string;
  /** Mixed between idle and selected when a whole-body system is selected. */
  wholeBody: string;
}

export interface BodyModelSceneController {
  setSelected(id: BodySystemId): void;
  setView(view: BodyModelView): void;
  setColors(colors: BodyModelColors): void;
  resize(widthCss: number, heightCss: number): void;
  /** Hit-test in canvas CSS pixels. Returns the mapped system or null. */
  pick(xCss: number, yCss: number): BodySystemId | null;
  dispose(): void;
}

export interface BodyModelSceneOptions {
  colors: BodyModelColors;
  selectedId: BodySystemId;
  view: BodyModelView;
  onContextLost: () => void;
}

export function createBodyModelScene(
  canvas: HTMLCanvasElement,
  options: BodyModelSceneOptions,
): BodyModelSceneController {
  // Parse first: a bad asset throws before any GPU work happens.
  const model = loadMappedBodyModel(decodeBase64(BODY_MODEL_GLB_BASE64));

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(BODY_MODEL_CAMERA_FOV_DEG, 1, 0.1, 20);
  // Key light travels with the camera so the visible side is always lit.
  // Intensities are in three.js physical units (Lambert divides by PI), tuned
  // so a front-facing surface shows close to its CSS colour.
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
    geometry.setAttribute("position", new BufferAttribute(parsed.positions, 3));
    if (parsed.normals) geometry.setAttribute("normal", new BufferAttribute(parsed.normals, 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new BufferAttribute(parsed.indices, 1));
    geometry.computeBoundingSphere();
    const material = new MeshLambertMaterial({ color: 0x888888 });
    const mesh = new Mesh(geometry, material);
    mesh.name = parsed.name;
    mesh.userData.bodySystemId = parsed.bodySystemId;
    root.add(mesh);
    meshes.push(mesh);
  }

  let selectedId = options.selectedId;
  let view = options.view;
  let colors = options.colors;
  let disposed = false;
  let frame = 0;
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const tmp = new Color();

  const applyColors = () => {
    for (const mesh of meshes) {
      const h = bodyModelHighlightFor(selectedId, mesh.userData.bodySystemId as BodySystemId | null);
      const css = h === "selected" ? colors.selected : h === "whole_body" ? colors.wholeBody : colors.idle;
      try {
        tmp.setStyle(css);
      } catch {
        tmp.set(0x888888);
      }
      mesh.material.color.copy(tmp);
    }
  };

  const applyView = () => {
    const [x, y, z] = bodyModelCameraPosition(view, BODY_MODEL_CAMERA_DISTANCE);
    camera.position.set(x, y, z);
    camera.lookAt(...BODY_MODEL_CAMERA_TARGET);
  };

  const render = () => {
    frame = 0;
    if (disposed) return;
    renderer.render(scene, camera);
  };
  const requestRender = () => {
    if (disposed || frame) return;
    frame = window.requestAnimationFrame(render);
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    options.onContextLost();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  applyColors();
  applyView();

  return {
    setSelected(id) {
      selectedId = id;
      applyColors();
      requestRender();
    },
    setView(next) {
      view = next;
      applyView();
      requestRender();
    },
    setColors(next) {
      colors = next;
      applyColors();
      requestRender();
    },
    resize(width, height) {
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    },
    pick(xCss, yCss) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      ndc.set((xCss / rect.width) * 2 - 1, -(yCss / rect.height) * 2 + 1);
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
      if (frame) window.cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
