import React from 'react';
import type { BodySystemId } from '../shared';

export interface BodyDiagramProps {
  selectedSystem: BodySystemId;
  onSelectSystem: (system: BodySystemId) => void;
  hasImmuneObservation: boolean;
  hasNutritionObservation: boolean;
}

const REGION_SYSTEMS: ReadonlyArray<{
  id: BodySystemId;
  label: string;
  regionLabel: string;
}> = [
  { id: 'sleep_cognition', label: 'Sleep & Cognition', regionLabel: 'Head region' },
  { id: 'cardiovascular', label: 'Cardiovascular', regionLabel: 'Chest region' },
  { id: 'musculoskeletal', label: 'Musculoskeletal', regionLabel: 'Torso & limbs region' },
];

export function BodyDiagram({
  selectedSystem,
  onSelectSystem,
  hasImmuneObservation,
  hasNutritionObservation,
}: BodyDiagramProps) {
  return (
    <div className="cs-card cs-stack" style={{ gap: '14px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <span className="cs-mono-stamp">Interactive body overview</span>
        <span className="cs-pill" style={{ whiteSpace: 'nowrap' }}>Not a medical scan</span>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '8px 0',
        }}
      >
        <svg
          viewBox="0 0 220 340"
          width="220"
          height="320"
          role="group"
          aria-label="Neutral 2D anatomical body outline with selectable Sleep and Cognition (head), Cardiovascular (chest), and Musculoskeletal (limbs) system anchors"
          style={{ maxWidth: '100%', height: 'auto' }}
        >
          {/* Neutral geometric anatomical silhouette */}
          <circle
            cx="110"
            cy="44"
            r="24"
            fill={selectedSystem === 'sleep_cognition' ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
            stroke={selectedSystem === 'sleep_cognition' ? 'var(--text-primary)' : 'var(--border-strong)'}
            strokeWidth={selectedSystem === 'sleep_cognition' ? 2.5 : 1.5}
          />
          {/* Neck */}
          <rect
            x="101"
            y="68"
            width="18"
            height="14"
            rx="4"
            fill="var(--bg-subtle)"
            stroke="var(--border-strong)"
            strokeWidth="1.2"
          />
          {/* Torso */}
          <path
            d="M72 86 C72 80 86 78 110 78 C134 78 148 80 148 86 L142 184 C142 190 132 194 110 194 C88 194 78 190 78 184 Z"
            fill={selectedSystem === 'cardiovascular' ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
            stroke={selectedSystem === 'cardiovascular' ? 'var(--text-primary)' : 'var(--border-strong)'}
            strokeWidth={selectedSystem === 'cardiovascular' ? 2 : 1.5}
          />
          {/* Left & Right Arms */}
          <path
            d="M68 88 L46 168 C45 174 52 178 58 175 L72 114"
            fill={selectedSystem === 'musculoskeletal' ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
            stroke={selectedSystem === 'musculoskeletal' ? 'var(--text-primary)' : 'var(--border-strong)'}
            strokeWidth={selectedSystem === 'musculoskeletal' ? 2.2 : 1.4}
          />
          <path
            d="M152 88 L174 168 C175 174 168 178 162 175 L148 114"
            fill={selectedSystem === 'musculoskeletal' ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
            stroke={selectedSystem === 'musculoskeletal' ? 'var(--text-primary)' : 'var(--border-strong)'}
            strokeWidth={selectedSystem === 'musculoskeletal' ? 2.2 : 1.4}
          />
          {/* Pelvis & Legs */}
          <path
            d="M80 194 L76 312 C76 318 86 320 92 316 L104 218 L116 218 L128 316 C134 320 144 318 144 312 L140 194 Z"
            fill={selectedSystem === 'musculoskeletal' ? 'var(--bg-hover)' : 'var(--bg-subtle)'}
            stroke={selectedSystem === 'musculoskeletal' ? 'var(--text-primary)' : 'var(--border-strong)'}
            strokeWidth={selectedSystem === 'musculoskeletal' ? 2.2 : 1.4}
          />

          {/* Interactive Anchor: Sleep & Cognition (Head) */}
          <g
            role="button"
            tabIndex={0}
            aria-label="Inspect Sleep and Cognition"
            aria-pressed={selectedSystem === 'sleep_cognition'}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectSystem('sleep_cognition')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSystem('sleep_cognition');
              }
            }}
          >
            <circle
              cx="110"
              cy="44"
              r="14"
              fill={selectedSystem === 'sleep_cognition' ? 'var(--accent-primary)' : 'var(--bg-surface)'}
              stroke="var(--text-primary)"
              strokeWidth="1.5"
            />
            <circle
              cx="110"
              cy="44"
              r="4"
              fill={selectedSystem === 'sleep_cognition' ? 'var(--accent-primary-text)' : 'var(--text-primary)'}
            />
          </g>

          {/* Interactive Anchor: Cardiovascular (Chest) */}
          <g
            role="button"
            tabIndex={0}
            aria-label="Inspect Cardiovascular"
            aria-pressed={selectedSystem === 'cardiovascular'}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectSystem('cardiovascular')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSystem('cardiovascular');
              }
            }}
          >
            <circle
              cx="110"
              cy="118"
              r="14"
              fill={selectedSystem === 'cardiovascular' ? 'var(--accent-primary)' : 'var(--bg-surface)'}
              stroke="var(--text-primary)"
              strokeWidth="1.5"
            />
            <circle
              cx="110"
              cy="118"
              r="4"
              fill={selectedSystem === 'cardiovascular' ? 'var(--accent-primary-text)' : 'var(--text-primary)'}
            />
          </g>

          {/* Interactive Anchor: Musculoskeletal (Limb/Structural) */}
          <g
            role="button"
            tabIndex={0}
            aria-label="Inspect Musculoskeletal"
            aria-pressed={selectedSystem === 'musculoskeletal'}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelectSystem('musculoskeletal')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectSystem('musculoskeletal');
              }
            }}
          >
            <circle
              cx="88"
              cy="252"
              r="14"
              fill={selectedSystem === 'musculoskeletal' ? 'var(--accent-primary)' : 'var(--bg-surface)'}
              stroke="var(--text-primary)"
              strokeWidth="1.5"
            />
            <circle
              cx="88"
              cy="252"
              r="4"
              fill={selectedSystem === 'musculoskeletal' ? 'var(--accent-primary-text)' : 'var(--text-primary)'}
            />
          </g>
        </svg>
      </div>

      <div className="cs-stack" style={{ gap: '8px' }}>
        <div className="cs-row" style={{ gap: '6px' }}>
          {REGION_SYSTEMS.map((item) => {
            const active = selectedSystem === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={active ? 'cs-btn cs-btn-primary cs-btn-wrap' : 'cs-btn cs-btn-secondary cs-btn-wrap'}
                aria-pressed={active}
                onClick={() => onSelectSystem(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: '10px',
          }}
        >
          <span className="cs-mono-stamp">Whole-body systems (no organ pin)</span>
          <div className="cs-row" style={{ gap: '8px', marginTop: '8px' }}>
            <button
              type="button"
              className={
                selectedSystem === 'immune_context'
                  ? 'cs-btn cs-btn-primary cs-btn-wrap'
                  : 'cs-btn cs-btn-secondary cs-btn-wrap'
              }
              aria-pressed={selectedSystem === 'immune_context'}
              onClick={() => onSelectSystem('immune_context')}
            >
              Immune & fever context · {hasImmuneObservation ? 'Temperature logged' : 'Unlogged'}
            </button>
            <button
              type="button"
              className={
                selectedSystem === 'nutrition_metabolism'
                  ? 'cs-btn cs-btn-primary cs-btn-wrap'
                  : 'cs-btn cs-btn-secondary cs-btn-wrap'
              }
              aria-pressed={selectedSystem === 'nutrition_metabolism'}
              onClick={() => onSelectSystem('nutrition_metabolism')}
            >
              Nutrition & metabolism · {hasNutritionObservation ? 'Glucose logged' : 'Not logged'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
