import './bodyModel/bodyModel.css';
import { Component, useEffect, useState, type ReactNode } from "react";
import {
  bodyVisualStatusMessage,
  resolveBodyVisualMode,
  type BodyModelSupport,
  type BodySystemId,
  type BodyVisualPreference,
} from "../shared";
import { BodyDiagram } from "./BodyDiagram";
import { BodyModelView, type BodyModelSceneLoader } from "./bodyModel/BodyModelView";

/**
 * Website default: the 3D model when WebGL2 is available and reduced motion
 * is off. The SVG diagram stays one click away and is the automatic fallback.
 */
export const WEBSITE_MODEL_DEFAULT = true;

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
  hasImmuneObservation: boolean;
  hasNutritionObservation: boolean;
  selectedId: BodySystemId;
  onSelect: (id: BodySystemId) => void;
  /** Test seams. Production uses WebGL2 detection and the lazy browser scene. */
  detectSupport?: () => BodyModelSupport;
  loadScene?: BodyModelSceneLoader;
}

export function BodyExplorerVisual({ selectedId, onSelect, hasImmuneObservation, hasNutritionObservation, detectSupport = detectBodyModelSupport, loadScene }: BodyExplorerVisualProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [support] = useState<BodyModelSupport>(() => detectSupport());
  const [preference, setPreference] = useState<BodyVisualPreference>("auto");
  const [loadError, setLoadError] = useState(false);

  const decision = resolveBodyVisualMode({
    preference,
    reducedMotion,
    support,
    loadError,
    modelDefaultOnPlatform: WEBSITE_MODEL_DEFAULT,
  });
  const status = bodyVisualStatusMessage(decision.reason);

  return (
    <div className="cs-card cs-stack body-explorer-visual">
      <div className="cs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="cs-mono-stamp">Interactive body overview</span>
        <span className="cs-pill">Not a medical scan</span>
      </div>
      {decision.modelOffered ? (
        <div className="cs-row body-visual-switch" role="group" aria-label="Regional map view">
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            aria-pressed={decision.mode === "model"}
            onClick={() => setPreference("model")}
          >
            3D model
          </button>
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
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
          className="cs-btn cs-btn-ghost"
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
        <BodyDiagram selectedSystem={selectedId} onSelectSystem={onSelect} hasImmuneObservation={hasImmuneObservation} hasNutritionObservation={hasNutritionObservation} />
      )}
    </div>
  );
}
