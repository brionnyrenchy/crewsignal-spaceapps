import { Component, useEffect, useState, type ReactNode } from "react";
import {
  bodyVisualStatusMessage,
  resolveBodyVisualMode,
  type BodyModelSupport,
  type BodySystemId,
  type BodyVisualPreference,
} from "../shared/src";
import { BodyDiagram } from "./BodyDiagram";
import { BodyModelView, type BodyModelSceneLoader } from "./bodyModel/BodyModelView";

/**
 * Windows default: the 3D model when WebGL2 is available and reduced motion
 * is off. The SVG diagram stays one click away and is the automatic fallback.
 */
export const DESKTOP_MODEL_DEFAULT = true;

export function detectBodyModelSupport(): BodyModelSupport {
  if (typeof document === "undefined" || typeof WebGL2RenderingContext === "undefined") return "unavailable";
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!gl) return "unavailable";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return "available";
  } catch {
    return "unavailable";
  }
}

function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return undefined;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

class ModelErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export interface BodyExplorerVisualProps {
  selectedId: BodySystemId;
  onSelect: (id: BodySystemId) => void;
  /** Test seams. Production uses WebGL2 detection and the lazy three.js scene. */
  detectSupport?: () => BodyModelSupport;
  loadScene?: BodyModelSceneLoader;
}

export function BodyExplorerVisual({ selectedId, onSelect, detectSupport = detectBodyModelSupport, loadScene }: BodyExplorerVisualProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [support] = useState<BodyModelSupport>(() => detectSupport());
  const [preference, setPreference] = useState<BodyVisualPreference>("auto");
  const [loadError, setLoadError] = useState(false);

  const decision = resolveBodyVisualMode({
    preference,
    reducedMotion,
    support,
    loadError,
    modelDefaultOnPlatform: DESKTOP_MODEL_DEFAULT,
  });
  const status = bodyVisualStatusMessage(decision.reason);

  return (
    <div className="stack-sm body-explorer-visual">
      {decision.modelOffered ? (
        <div className="segmented-group body-visual-switch" role="group" aria-label="Regional map view">
          <button
            type="button"
            className="segmented-btn"
            aria-pressed={decision.mode === "model"}
            onClick={() => setPreference("model")}
          >
            3D model
          </button>
          <button
            type="button"
            className="segmented-btn"
            aria-pressed={decision.mode === "diagram"}
            onClick={() => setPreference("diagram")}
          >
            Diagram
          </button>
        </div>
      ) : null}

      {status ? (
        <p className="body-visual-status" role="status" data-testid="body-visual-status">
          {status}
        </p>
      ) : null}
      {decision.reason === "load_error" ? (
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setLoadError(false);
            setPreference("model");
          }}
        >
          Try the 3D model again
        </button>
      ) : null}

      {decision.mode === "model" ? (
        <ModelErrorBoundary onError={() => setLoadError(true)}>
          <BodyModelView
            selectedId={selectedId}
            onSelect={onSelect}
            onFailure={() => setLoadError(true)}
            loadScene={loadScene}
          />
        </ModelErrorBoundary>
      ) : (
        <BodyDiagram selectedId={selectedId} onSelect={onSelect} />
      )}
    </div>
  );
}
