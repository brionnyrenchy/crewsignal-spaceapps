import { useCallback, useEffect, useRef, useState } from "react";
import {
  BODY_MODEL_DEFAULT_VIEW,
  BODY_MODEL_REGION_TARGETS,
  BODY_MODEL_ROTATE_STEP,
  BODY_MODEL_TAP_SLOP_PX,
  BODY_MODEL_WHOLE_BODY_SYSTEMS,
  BODY_SYSTEM_DEFINITIONS,
  bodyModelRegionLabel,
  bodyModelSelectionCaption,
  dragToRotation,
  rotateBodyModelView,
  type BodyModelView as CameraView,
  type BodySystemId,
} from "../../shared/src";
import type { BodyModelColors, BodyModelSceneController } from "./bodyModelScene";

export type BodyModelSceneLoader = () => Promise<typeof import("./bodyModelScene")>;

const defaultLoader: BodyModelSceneLoader = () => import("./bodyModelScene");

export interface BodyModelViewProps {
  selectedId: BodySystemId;
  onSelect: (id: BodySystemId) => void;
  /** Called when the renderer cannot start or loses its context. */
  onFailure: (reason: "load_error" | "context_lost") => void;
  /** Injectable for tests; defaults to the lazily loaded three.js scene. */
  loadScene?: BodyModelSceneLoader;
}

function parseRgb(css: string): [number, number, number] | null {
  const m = css.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function mix(a: string, b: string, t: number): string {
  const ra = parseRgb(a);
  const rb = parseRgb(b);
  if (!ra || !rb) return b;
  const c = ra.map((v, i) => Math.round(v + (rb[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function readColors(probeRoot: HTMLElement | null): BodyModelColors {
  const fallback = { idle: "rgb(125, 125, 125)", selected: "rgb(23, 23, 23)" };
  const idleEl = probeRoot?.querySelector<HTMLElement>('[data-probe="idle"]');
  const selEl = probeRoot?.querySelector<HTMLElement>('[data-probe="selected"]');
  const opaque = (css: string | undefined, fb: string) => {
    const rgb = css ? parseRgb(css) : null;
    return rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : fb;
  };
  const idle = opaque(idleEl ? getComputedStyle(idleEl).color : undefined, fallback.idle);
  const selected = opaque(selEl ? getComputedStyle(selEl).color : undefined, fallback.selected);
  return { idle, selected, wholeBody: mix(idle, selected, 0.45) };
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/**
 * Interactive 3D navigation illustration. The canvas is a pointer
 * convenience; every action it offers is also a labelled button here and in
 * the Systems list, which remains the accessible source of truth.
 */
export function BodyModelView({ selectedId, onSelect, onFailure, loadScene = defaultLoader }: BodyModelViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BodyModelSceneController | null>(null);
  const viewRef = useRef<CameraView>({ ...BODY_MODEL_DEFAULT_VIEW });
  const selectedRef = useRef(selectedId);
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;
  const dragRef = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const [ready, setReady] = useState(false);
  const visible = useDocumentVisible();

  // Create the renderer while the route is shown and the window is visible;
  // dispose it on leave or when the app is hidden / minimised.
  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    setReady(false);

    // A fresh canvas per renderer: a canvas whose context was released with
    // forceContextLoss() cannot host a new WebGL context.
    let canvas: HTMLCanvasElement | null = null;

    void loadScene()
      .then((mod) => {
        const stage = stageRef.current;
        if (cancelled || !stage) return;
        canvas = document.createElement("canvas");
        canvas.className = "body-model-canvas";
        canvas.setAttribute("aria-hidden", "true");
        stage.prepend(canvas);
        const controller = mod.createBodyModelScene(canvas, {
          colors: readColors(probeRef.current),
          selectedId: selectedRef.current,
          view: viewRef.current,
          onContextLost: () => onFailureRef.current("context_lost"),
        });
        controllerRef.current = controller;
        const sizeToStage = () => {
          const rect = stage.getBoundingClientRect();
          controller.resize(rect.width, rect.height);
        };
        sizeToStage();
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(sizeToStage);
          observer.observe(stage);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) onFailureRef.current("load_error");
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      controllerRef.current?.dispose();
      controllerRef.current = null;
      canvas?.remove();
    };
  }, [visible, loadScene]);

  useEffect(() => {
    selectedRef.current = selectedId;
    controllerRef.current?.setSelected(selectedId);
  }, [selectedId]);

  // Follow theme, colour-scheme and forced-colours changes.
  useEffect(() => {
    const refresh = () => controllerRef.current?.setColors(readColors(probeRef.current));
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const queries = ["(prefers-color-scheme: dark)", "(forced-colors: active)"].map((q) => window.matchMedia?.(q));
    for (const q of queries) q?.addEventListener?.("change", refresh);
    return () => {
      observer.disconnect();
      for (const q of queries) q?.removeEventListener?.("change", refresh);
    };
  }, []);

  const setView = useCallback((next: CameraView) => {
    viewRef.current = next;
    controllerRef.current?.setView(next);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > BODY_MODEL_TAP_SLOP_PX) d.moved = true;
    if (d.moved) {
      const width = e.currentTarget.getBoundingClientRect().width;
      const { deltaYaw, deltaPitch } = dragToRotation(e.clientX - d.lastX, e.clientY - d.lastY, width);
      // Touch: vertical pans belong to page scrolling (touch-action: pan-y).
      setView(rotateBodyModelView(viewRef.current, -deltaYaw, e.pointerType === "touch" ? 0 : deltaPitch));
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.id !== e.pointerId || d.moved) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = controllerRef.current?.pick(e.clientX - rect.left, e.clientY - rect.top) ?? null;
    if (hit) onSelect(hit);
  };

  const nameOf = (id: BodySystemId) => BODY_SYSTEM_DEFINITIONS.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="body-model-box" data-testid="body-model-view">
      <div
        className="body-model-stage"
        ref={stageRef}
        role="img"
        aria-label="3D anatomical navigation illustration. Drag to rotate. Region buttons below and the Systems list select the same systems."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        {!ready ? (
          <p className="body-model-loading" role="status">
            Loading 3D model…
          </p>
        ) : null}
      </div>

      <p className="body-model-caption" data-testid="body-model-caption">
        {bodyModelSelectionCaption(selectedId)}
      </p>

      <div className="chip-group body-model-regions" role="group" aria-label="Select a body region or whole-body context">
        {BODY_MODEL_REGION_TARGETS.map((target) => (
          <button
            key={target.systemId}
            type="button"
            className="chip-btn"
            aria-pressed={selectedId === target.systemId}
            aria-label={`Select ${bodyModelRegionLabel(target)}`}
            onClick={() => onSelect(target.systemId)}
          >
            {target.regionLabel}
          </button>
        ))}
        {BODY_MODEL_WHOLE_BODY_SYSTEMS.map((id) => (
          <button
            key={id}
            type="button"
            className="chip-btn"
            aria-pressed={selectedId === id}
            onClick={() => onSelect(id)}
          >
            {nameOf(id)}
          </button>
        ))}
      </div>

      <div className="row-wrap body-model-controls" role="group" aria-label="3D view controls">
        <button type="button" className="btn-ghost" onClick={() => setView(rotateBodyModelView(viewRef.current, BODY_MODEL_ROTATE_STEP))}>
          Rotate left
        </button>
        <button type="button" className="btn-ghost" onClick={() => setView(rotateBodyModelView(viewRef.current, -BODY_MODEL_ROTATE_STEP))}>
          Rotate right
        </button>
        <button type="button" className="btn-secondary" onClick={() => setView({ ...BODY_MODEL_DEFAULT_VIEW })}>
          Reset view
        </button>
      </div>

      <div ref={probeRef} className="body-model-probes" aria-hidden="true">
        <span data-probe="idle" />
        <span data-probe="selected" />
      </div>
    </div>
  );
}
