import { useState } from "react";
import {
  convertGlucose,
  convertTemperature,
  formatObservationDisplay,
  formatTemperatureUnitSymbol,
  getMoodLabel,
  getObservedMissionDay,
  type AppPreferences,
  type MetricId,
  type Observation,
  type PersonalReference,
} from "../shared/src";

interface TrendChartProps {
  metricId: MetricId;
  observations: readonly Observation[];
  reference: PersonalReference | null;
  rangeDays: 7 | 30;
  currentMissionDay: number;
  displayUnits: AppPreferences["displayUnits"];
}

interface DayPoint {
  day: number;
  obs: Observation | null;
  primaryValue: number | null;
  secondaryValue: number | null; // For diastolic BP
  labelText: string;
}

export function TrendChart({
  metricId,
  observations,
  reference,
  rangeDays,
  currentMissionDay,
  displayUnits,
}: TrendChartProps) {
  const startDay = Math.max(1, currentMissionDay - rangeDays + 1);
  const days = Array.from({ length: rangeDays }, (_, idx) => startDay + idx);

  const obsForMetric = observations.filter((o) => o.metricId === metricId);
  const byDay = new Map<number, Observation>();
  for (const obs of obsForMetric) {
    const day = getObservedMissionDay(obs);
    // Keep latest on that day
    byDay.set(day, obs);
  }

  const points: DayPoint[] = days.map((day) => {
    const obs = byDay.get(day) ?? null;
    if (!obs) {
      return { day, obs: null, primaryValue: null, secondaryValue: null, labelText: "No entry" };
    }
    const formatted = formatObservationDisplay(obs, displayUnits);
    if (obs.canonical.kind === "blood_pressure") {
      return {
        day,
        obs,
        primaryValue: obs.canonical.systolic,
        secondaryValue: obs.canonical.diastolic,
        labelText: formatted.primaryText,
      };
    }
    if (obs.canonical.kind === "sleep_duration") {
      return {
        day,
        obs,
        primaryValue: Number((obs.canonical.durationMinutes / 60).toFixed(2)),
        secondaryValue: null,
        labelText: formatted.primaryText,
      };
    }
    if (obs.canonical.kind === "mood_ordinal") {
      return {
        day,
        obs,
        primaryValue: obs.canonical.score,
        secondaryValue: null,
        labelText: `${obs.canonical.score} / 5 (${getMoodLabel(obs.canonical.score)})`,
      };
    }
    // scalar
    let val = obs.canonical.value;
    if (metricId === "blood_glucose") {
      val = convertGlucose(obs.canonical.value, "mg/dL", displayUnits.blood_glucose).rounded1;
    } else if (metricId === "body_temperature") {
      val = convertTemperature(obs.canonical.value, "C", displayUnits.body_temperature).rounded1;
    }
    return {
      day,
      obs,
      primaryValue: val,
      secondaryValue: null,
      labelText: formatted.primaryText,
    };
  });

  const nonNullPoints = points.filter((p) => p.primaryValue !== null);
  const [selectedDay, setSelectedDay] = useState<number | null>(
    nonNullPoints[nonNullPoints.length - 1]?.day ?? null,
  );

  // Compute reference line(s) in current display unit
  let refPrimary: number | null = null;
  let refSecondary: number | null = null;
  let refLineLabel = "";
  if (reference && reference.status === "active" && reference.value) {
    if (reference.value.kind === "sleep_duration") {
      refPrimary = Number((reference.value.durationMinutes / 60).toFixed(2));
      const h = Math.floor(reference.value.durationMinutes / 60);
      const m = reference.value.durationMinutes % 60;
      refLineLabel = `Personal reference ${h}h ${m.toString().padStart(2, "0")}m`;
    } else if (reference.value.kind === "blood_pressure") {
      refPrimary = reference.value.systolic;
      refSecondary = reference.value.diastolic;
      refLineLabel = `Reference ${refPrimary}/${refSecondary} mmHg`;
    } else if (reference.value.kind === "scalar") {
      let rv = reference.value.value;
      let u = reference.unit;
      if (metricId === "blood_glucose") {
        rv = convertGlucose(rv, reference.unit as "mg/dL" | "mmol/L", displayUnits.blood_glucose).rounded1;
        u = displayUnits.blood_glucose;
      } else if (metricId === "body_temperature") {
        rv = convertTemperature(rv, reference.unit as "C" | "F", displayUnits.body_temperature).rounded1;
        u = formatTemperatureUnitSymbol(displayUnits.body_temperature);
      }
      refPrimary = rv;
      refLineLabel = `Personal reference ${rv} ${u}`;
    }
  }

  if (nonNullPoints.length === 0) {
    return (
      <div className="notice-banner" role="status">
        <div>
          <strong>Not recorded in the last {rangeDays} days.</strong>{" "}
          Empty days stay unrecorded and are not drawn as zero.
        </div>
      </div>
    );
  }

  // Build SVG bounds
  const width = 680;
  const height = 220;
  const padLeft = 46;
  const padRight = 22;
  const padTop = 20;
  const padBottom = 34;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const numericSamples: number[] = [];
  for (const p of nonNullPoints) {
    if (p.primaryValue !== null) numericSamples.push(p.primaryValue);
    if (p.secondaryValue !== null) numericSamples.push(p.secondaryValue);
  }
  if (refPrimary !== null) numericSamples.push(refPrimary);
  if (refSecondary !== null) numericSamples.push(refSecondary);

  let yMin = metricId === "mood" ? 1 : Math.min(...numericSamples);
  let yMax = metricId === "mood" ? 5 : Math.max(...numericSamples);
  if (metricId === "sleep") {
    // Agreed sparse sleep scale: 0/5/10 hours (extended in 5-hour steps only if needed).
    yMin = 0;
    yMax = Math.max(10, Math.ceil(yMax / 5) * 5);
  } else if (metricId !== "mood") {
    const span = Math.max(4, yMax - yMin);
    yMin = Math.floor(yMin - span * 0.15);
    yMax = Math.ceil(yMax + span * 0.15);
  }
  if (yMax <= yMin) yMax = yMin + 1;

  const xForIdx = (idx: number) =>
    days.length === 1
      ? padLeft + plotW / 2
      : padLeft + (idx / (days.length - 1)) * plotW;

  const yForVal = (val: number) =>
    padTop + ((yMax - val) / (yMax - yMin)) * plotH;

  // Connect ONLY consecutive observed days without interpolating over missing gap days
  const primarySegments: string[] = [];
  const secondarySegments: string[] = [];
  if (metricId !== "mood") {
    let curPath = "";
    let curSecPath = "";
    points.forEach((pt, idx) => {
      if (pt.primaryValue !== null) {
        const x = xForIdx(idx).toFixed(1);
        const y = yForVal(pt.primaryValue).toFixed(1);
        curPath += curPath ? ` L ${x} ${y}` : `M ${x} ${y}`;
      } else if (curPath) {
        primarySegments.push(curPath);
        curPath = "";
      }
      if (pt.secondaryValue !== null) {
        const x = xForIdx(idx).toFixed(1);
        const y = yForVal(pt.secondaryValue).toFixed(1);
        curSecPath += curSecPath ? ` L ${x} ${y}` : `M ${x} ${y}`;
      } else if (curSecPath) {
        secondarySegments.push(curSecPath);
        curSecPath = "";
      }
    });
    if (curPath) primarySegments.push(curPath);
    if (curSecPath) secondarySegments.push(curSecPath);
  }

  const yTicks =
    metricId === "mood"
      ? [1, 2, 3, 4, 5]
      : metricId === "sleep"
        ? Array.from({ length: yMax / 5 + 1 }, (_, i) => i * 5)
        : [yMin, Number(((yMin + yMax) / 2).toFixed(1)), yMax];

  const inspectedPoint =
    points.find((p) => p.day === selectedDay) ??
    nonNullPoints[nonNullPoints.length - 1] ??
    null;

  return (
    <div className="stack-sm">
      <div className="chart-wrap">
        <svg
          className="chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`${metricId.replace("_", " ")} over ${rangeDays} days showing ${nonNullPoints.length} observed day(s) and ${days.length - nonNullPoints.length} gap day(s)`}
        >
          {/* Horizontal grid lines */}
          {yTicks.map((tick) => {
            const y = yForVal(tick);
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="var(--border-hairline)"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  fill="var(--text-supporting)"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                >
                  {metricId === "sleep" ? `${tick}h` : tick}
                </text>
              </g>
            );
          })}

          {/* Reference dashed line */}
          {refPrimary !== null && metricId !== "mood" ? (
            <g>
              <line
                x1={padLeft}
                y1={yForVal(refPrimary)}
                x2={width - padRight}
                y2={yForVal(refPrimary)}
                stroke="var(--series-reference)"
                strokeWidth="1.5"
                strokeDasharray="5 4"
              />
              <text
                x={width - padRight}
                y={Math.max(padTop + 10, yForVal(refPrimary) - 6)}
                textAnchor="end"
                fill="var(--text-supporting)"
                fontSize="11"
              >
                {refLineLabel}
              </text>
            </g>
          ) : null}

          {refSecondary !== null && metricId === "blood_pressure" ? (
            <line
              x1={padLeft}
              y1={yForVal(refSecondary)}
              x2={width - padRight}
              y2={yForVal(refSecondary)}
              stroke="var(--series-reference)"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
          ) : null}

          {/* Consecutive observed line paths */}
          {primarySegments.map((d, i) => (
            <path
              key={`p-${i}`}
              d={d}
              fill="none"
              stroke="var(--series-measured)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {secondarySegments.map((d, i) => (
            <path
              key={`s-${i}`}
              d={d}
              fill="none"
              stroke="var(--text-supporting)"
              strokeWidth="1.8"
              strokeDasharray="2 3"
              strokeLinecap="round"
            />
          ))}

          {/* X axis labels and data points */}
          {points.map((pt, idx) => {
            const x = xForIdx(idx);
            const showTick =
              rangeDays === 7 || idx === 0 || idx === points.length - 1 || pt.day % 5 === 0;
            const isSelected = inspectedPoint?.day === pt.day;
            return (
              <g key={pt.day}>
                {showTick ? (
                  <text
                    x={x}
                    y={height - 10}
                    textAnchor="middle"
                    fill="var(--text-supporting)"
                    fontSize="11"
                    fontFamily="var(--font-mono)"
                  >
                    D{pt.day}
                  </text>
                ) : null}

                {pt.primaryValue !== null ? (
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Day ${pt.day}: ${pt.labelText}`}
                    aria-pressed={isSelected}
                    className="diagram-hotspot"
                    onClick={() => setSelectedDay(pt.day)}
                    onFocus={() => setSelectedDay(pt.day)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDay(pt.day);
                      }
                    }}
                  >
                    <circle
                      cx={x}
                      cy={yForVal(pt.primaryValue)}
                      r={isSelected ? 6 : 4.5}
                      fill="var(--series-measured)"
                      stroke="var(--surface-panel)"
                      strokeWidth="2"
                    />
                    {pt.secondaryValue !== null ? (
                      <circle
                        cx={x}
                        cy={yForVal(pt.secondaryValue)}
                        r={isSelected ? 5.5 : 4}
                        fill="var(--surface-panel)"
                        stroke="var(--series-measured)"
                        strokeWidth="2"
                      />
                    ) : null}
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div
        className="row-wrap"
        style={{
          justifyContent: "space-between",
          fontSize: 13,
          color: "var(--text-supporting)",
          borderTop: "1px solid var(--border-hairline)",
          paddingTop: 10,
        }}
      >
        <div>
          {inspectedPoint && inspectedPoint.obs ? (
            <span>
              <strong style={{ color: "var(--text-primary)" }}>
                Day {inspectedPoint.day}:
              </strong>{" "}
              <span className="tabular-value">{inspectedPoint.labelText}</span> ·{" "}
              {inspectedPoint.obs.method} ({inspectedPoint.obs.context})
            </span>
          ) : (
            <span>Select any observed point to inspect its details.</span>
          )}
        </div>
        <div className="mono-label">
          {nonNullPoints.length} observed · {days.length - nonNullPoints.length} unrecorded gap day(s)
        </div>
      </div>
    </div>
  );
}
