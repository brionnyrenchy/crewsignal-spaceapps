import { BODY_SYSTEM_DEFINITIONS, type BodySystemId } from "../shared/src";

interface BodyDiagramProps {
  selectedId: BodySystemId;
  onSelect: (id: BodySystemId) => void;
}

export function BodyDiagram({ selectedId, onSelect }: BodyDiagramProps) {
  const systemsById = new Map(BODY_SYSTEM_DEFINITIONS.map((s) => [s.id, s]));
  const isSelected = (id: BodySystemId) => selectedId === id;

  return (
    <div className="body-diagram-box">
      <svg
        className="body-svg"
        viewBox="0 0 220 340"
        role="group"
        aria-label="Anatomical navigation diagram for body systems"
      >
        {/* Whole-body subtle outline (Immune & Nutrition context) */}
        <rect
          x="14"
          y="10"
          width="192"
          height="320"
          rx="14"
          fill="none"
          stroke={
            isSelected("immune_context") || isSelected("nutrition_metabolism")
              ? "var(--series-measured)"
              : "var(--border-hairline)"
          }
          strokeDasharray="4 4"
          strokeWidth={isSelected("immune_context") || isSelected("nutrition_metabolism") ? 2 : 1}
        />

        {/* Neutral figure silhouette */}
        <circle
          cx="110"
          cy="52"
          r="24"
          fill={isSelected("sleep_cognition") ? "var(--surface-hover)" : "var(--surface-raised)"}
          stroke={isSelected("sleep_cognition") ? "var(--series-measured)" : "var(--border-control)"}
          strokeWidth={isSelected("sleep_cognition") ? 2.5 : 1.5}
        />
        {/* Neck + Torso */}
        <rect
          x="74"
          y="84"
          width="72"
          height="108"
          rx="16"
          fill={
            isSelected("cardiovascular") || isSelected("nutrition_metabolism")
              ? "var(--surface-hover)"
              : "var(--surface-raised)"
          }
          stroke={
            isSelected("cardiovascular")
              ? "var(--series-measured)"
              : "var(--border-control)"
          }
          strokeWidth={isSelected("cardiovascular") ? 2.5 : 1.5}
        />
        {/* Left & Right Arms / Lower limbs representing musculoskeletal */}
        <rect
          x="42"
          y="92"
          width="24"
          height="92"
          rx="10"
          fill={isSelected("musculoskeletal") ? "var(--surface-hover)" : "var(--surface-raised)"}
          stroke={isSelected("musculoskeletal") ? "var(--series-measured)" : "var(--border-control)"}
          strokeWidth={isSelected("musculoskeletal") ? 2.5 : 1.5}
        />
        <rect
          x="154"
          y="92"
          width="24"
          height="92"
          rx="10"
          fill={isSelected("musculoskeletal") ? "var(--surface-hover)" : "var(--surface-raised)"}
          stroke={isSelected("musculoskeletal") ? "var(--series-measured)" : "var(--border-control)"}
          strokeWidth={isSelected("musculoskeletal") ? 2.5 : 1.5}
        />
        <rect
          x="78"
          y="198"
          width="26"
          height="112"
          rx="10"
          fill={isSelected("musculoskeletal") ? "var(--surface-hover)" : "var(--surface-raised)"}
          stroke={isSelected("musculoskeletal") ? "var(--series-measured)" : "var(--border-control)"}
          strokeWidth={isSelected("musculoskeletal") ? 2.5 : 1.5}
        />
        <rect
          x="116"
          y="198"
          width="26"
          height="112"
          rx="10"
          fill={isSelected("musculoskeletal") ? "var(--surface-hover)" : "var(--surface-raised)"}
          stroke={isSelected("musculoskeletal") ? "var(--series-measured)" : "var(--border-control)"}
          strokeWidth={isSelected("musculoskeletal") ? 2.5 : 1.5}
        />

        {/* Interactive 44px+ regional targets */}
        <g
          role="button"
          tabIndex={0}
          aria-label={`Select ${systemsById.get("sleep_cognition")?.name ?? "Sleep and cognition"}`}
          aria-pressed={isSelected("sleep_cognition")}
          className="diagram-hotspot"
          onClick={() => onSelect("sleep_cognition")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("sleep_cognition");
            }
          }}
        >
          <circle
            cx="110"
            cy="52"
            r="26"
            fill="transparent"
          />
          <circle
            cx="110"
            cy="52"
            r="6"
            fill={isSelected("sleep_cognition") ? "var(--series-measured)" : "var(--text-supporting)"}
          />
        </g>

        <g
          role="button"
          tabIndex={0}
          aria-label={`Select ${systemsById.get("cardiovascular")?.name ?? "Cardiovascular"}`}
          aria-pressed={isSelected("cardiovascular")}
          className="diagram-hotspot"
          onClick={() => onSelect("cardiovascular")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("cardiovascular");
            }
          }}
        >
          <rect x="82" y="96" width="56" height="52" rx="10" fill="transparent" />
          <circle
            cx="110"
            cy="122"
            r="7"
            fill={isSelected("cardiovascular") ? "var(--series-measured)" : "var(--text-supporting)"}
          />
        </g>

        <g
          role="button"
          tabIndex={0}
          aria-label={`Select ${systemsById.get("musculoskeletal")?.name ?? "Musculoskeletal"}`}
          aria-pressed={isSelected("musculoskeletal")}
          className="diagram-hotspot"
          onClick={() => onSelect("musculoskeletal")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect("musculoskeletal");
            }
          }}
        >
          <rect x="74" y="210" width="72" height="60" rx="10" fill="transparent" />
          <circle
            cx="110"
            cy="240"
            r="7"
            fill={isSelected("musculoskeletal") ? "var(--series-measured)" : "var(--text-supporting)"}
          />
        </g>
      </svg>

      <div className="chip-group" style={{ justifyContent: "center" }}>
        <button
          type="button"
          className="chip-btn"
          aria-pressed={isSelected("immune_context")}
          onClick={() => onSelect("immune_context")}
        >
          Immune context
        </button>
        <button
          type="button"
          className="chip-btn"
          aria-pressed={isSelected("nutrition_metabolism")}
          onClick={() => onSelect("nutrition_metabolism")}
        >
          Nutrition & metabolism
        </button>
      </div>
    </div>
  );
}
