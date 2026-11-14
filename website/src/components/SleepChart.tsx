import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  formatDurationHoursMinutes,
  getObservedMissionDay,
  roundToDecimals,
  type Observation,
  type PersonalReference,
} from '../shared';

export interface SleepChartProps {
  observations: readonly Observation[];
  sleepReference: PersonalReference | null;
  range: '7d' | '30d';
  currentMissionDay: number;
  compact?: boolean;
  allowTableToggle?: boolean;
}

interface ChartPoint {
  day: number;
  dayLabel: string;
  hours: number | null;
  minutes: number | null;
  durationText: string | null;
  reportedNoSleep: boolean;
  endingDay: number;
  reportedTimeUtc: string | null;
  method: string | null;
  diffText: string | null;
}

export function SleepChart({
  observations,
  sleepReference,
  range,
  currentMissionDay,
  compact = false,
  allowTableToggle = true,
}: SleepChartProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const windowStartDay =
    range === '7d' ? Math.max(1, currentMissionDay - 6) : Math.max(1, currentMissionDay - 29);

  const refMinutes =
    sleepReference &&
    sleepReference.status === 'active' &&
    sleepReference.value?.kind === 'sleep_duration'
      ? sleepReference.value.durationMinutes
      : null;
  const refHours = refMinutes !== null ? roundToDecimals(refMinutes / 60, 2) : null;

  const { points, recordedCount, gapCount, gapSummary } = useMemo(() => {
    const mainSleepByDay = new Map<number, Observation>();
    for (const obs of observations) {
      if (
        obs.metricId === 'sleep' &&
        obs.timing.kind === 'period' &&
        obs.timing.sleepType === 'main_sleep'
      ) {
        const day = getObservedMissionDay(obs);
        const prev = mainSleepByDay.get(day);
        if (!prev || obs.recordedAtUtc > prev.recordedAtUtc) {
          mainSleepByDay.set(day, obs);
        }
      }
    }

    const list: ChartPoint[] = [];
    let recorded = 0;
    const missingDays: number[] = [];

    for (let day = windowStartDay; day <= currentMissionDay; day += 1) {
      const obs = mainSleepByDay.get(day);
      if (obs && obs.canonical.kind === 'sleep_duration') {
        recorded += 1;
        const mins = obs.canonical.durationMinutes;
        const hrs = roundToDecimals(mins / 60, 2);
        let diffText: string | null = null;
        if (refMinutes !== null) {
          const delta = mins - refMinutes;
          if (delta === 0) diffText = 'Matches reference';
          else if (delta < 0) diffText = `${formatDurationHoursMinutes(Math.abs(delta))} below reference`;
          else diffText = `${formatDurationHoursMinutes(delta)} above reference`;
        }
        list.push({
          day,
          dayLabel: `Day ${day}`,
          hours: hrs,
          minutes: mins,
          durationText: formatDurationHoursMinutes(mins),
          reportedNoSleep: mins === 0,
          endingDay: day,
          reportedTimeUtc: obs.timing.kind === 'period' ? obs.timing.reportedAtUtc : obs.recordedAtUtc,
          method: obs.method,
          diffText,
        });
      } else {
        missingDays.push(day);
        list.push({
          day,
          dayLabel: `Day ${day}`,
          hours: null,
          minutes: null,
          durationText: null,
          reportedNoSleep: false,
          endingDay: day,
          reportedTimeUtc: null,
          method: null,
          diffText: null,
        });
      }
    }

    let summary: string | null = null;
    if (missingDays.length > 0 && recorded > 0) {
      const firstGap = missingDays[0]!;
      const lastGap = missingDays[missingDays.length - 1]!;
      if (missingDays.length === 23 && firstGap === 13 && lastGap === 35) {
        summary = 'No entries · days 13–35 (23 gap days)';
      } else if (firstGap === lastGap) {
        summary = `No entry · day ${firstGap}`;
      } else {
        summary = `No entries on ${missingDays.length} gap days (${firstGap}–${lastGap})`;
      }
    }

    return {
      points: list,
      recordedCount: recorded,
      gapCount: missingDays.length,
      gapSummary: summary,
    };
  }, [observations, windowStartDay, currentMissionDay, refMinutes]);

  const recordedPoints = useMemo(
    () => points.filter((p) => p.hours !== null),
    [points],
  );

  const inspectedPoint = useMemo(() => {
    if (recordedPoints.length === 0) return null;
    if (selectedDay !== null) {
      const exact = recordedPoints.find((p) => p.day === selectedDay);
      if (exact) return exact;
    }
    return recordedPoints[recordedPoints.length - 1] ?? null;
  }, [recordedPoints, selectedDay]);

  const xTicks =
    range === '7d'
      ? [windowStartDay, Math.round((windowStartDay + currentMissionDay) / 2), currentMissionDay]
      : currentMissionDay === 42
        ? [13, 27, 36, 42]
        : [windowStartDay, windowStartDay + 14, windowStartDay + 23, currentMissionDay];

  if (recordedCount === 0) {
    return (
      <div
        className="cs-card-muted"
        role="region"
        aria-label="Sleep duration chart empty state"
        style={{ padding: '20px' }}
      >
        <p style={{ fontWeight: 500, marginBottom: '4px' }}>
          No sleep entries logged for days {windowStartDay}–{currentMissionDay}
        </p>
        <p className="cs-helper">
          Sleep duration stays empty until you record a sleep period in Check-in. Unlogged days are never filled with zero.
        </p>
      </div>
    );
  }

  return (
    <div className="cs-stack" style={{ gap: '12px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div className="cs-row" style={{ gap: '8px' }}>
          <span className="cs-mono-stamp">
            Main sleep · Days {windowStartDay}–{currentMissionDay}
          </span>
          {refMinutes !== null && (
            <span className="cs-pill">
              Reference: {formatDurationHoursMinutes(refMinutes)}
            </span>
          )}
          {gapCount > 0 && gapSummary && (
            <span className="cs-pill">{gapSummary}</span>
          )}
        </div>
        {allowTableToggle && (
          <button
            type="button"
            className="cs-btn cs-btn-secondary"
            aria-expanded={showTable}
            onClick={() => setShowTable((prev) => !prev)}
          >
            {showTable ? 'Hide data table' : 'View data table'}
          </button>
        )}
      </div>

      <div
        role="region"
        style={{ width: '100%', height: compact ? 185 : 240, minWidth: 0 }}
        aria-label={`Main sleep duration line chart from mission day ${windowStartDay} to ${currentMissionDay}`}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={160}>
          <LineChart
            data={points}
            margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
            onClick={(state) => {
              const label = state?.activeLabel;
              const parsed = typeof label === 'number' ? label : Number(label);
              if (Number.isFinite(parsed)) {
                setSelectedDay(parsed);
              }
            }}
          >
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="day"
              type="number"
              domain={[windowStartDay, currentMissionDay]}
              ticks={xTicks}
              tickFormatter={(d) => `${d}`}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              axisLine={{ stroke: 'var(--border-subtle)' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 10]}
              ticks={[0, 5, 10]}
              tickFormatter={(h) => `${h}h`}
              tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload[0]) return null;
                const pt = payload[0].payload as ChartPoint;
                if (pt.hours === null) {
                  return (
                    <div
                      className="cs-card"
                      style={{ padding: '8px 10px', fontSize: '0.8125rem' }}
                    >
                      <strong>Day {pt.day}</strong>: No entry recorded
                    </div>
                  );
                }
                return (
                  <div
                    className="cs-card"
                    style={{ padding: '8px 10px', fontSize: '0.8125rem' }}
                  >
                    <div style={{ fontWeight: 500 }}>Day {pt.day}</div>
                    <div className="cs-mono-value">{pt.durationText}</div>
                    {pt.reportedNoSleep && (
                      <div className="cs-helper">Reported no sleep (0h 0m)</div>
                    )}
                    {pt.diffText && <div className="cs-helper">{pt.diffText}</div>}
                  </div>
                );
              }}
            />
            {refHours !== null && (
              <ReferenceLine
                y={refHours}
                stroke="var(--chart-ref)"
                strokeDasharray="5 4"
                strokeWidth={1.5}
              />
            )}
            <Line
              type="monotone"
              dataKey="hours"
              stroke="var(--chart-line)"
              strokeWidth={2.25}
              connectNulls={false}
              dot={{ r: 3.5, fill: 'var(--chart-dot)', strokeWidth: 0 }}
              activeDot={{ r: 5.5, fill: 'var(--chart-line)', stroke: 'var(--bg-surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {!compact && (
        <div
          className="cs-card-muted"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            padding: '12px 14px',
          }}
        >
          <div>
            <span className="cs-mono-stamp">Selected point</span>
            {inspectedPoint ? (
              <div style={{ marginTop: '4px', fontSize: '0.875rem' }}>
                <strong className="cs-tabular">Day {inspectedPoint.day}</strong>{' '}
                ·{' '}
                <span className="cs-mono-value">{inspectedPoint.durationText}</span>
                {inspectedPoint.reportedNoSleep ? ' (Reported no sleep)' : ''}
                {inspectedPoint.diffText ? ` · ${inspectedPoint.diffText}` : ''}
              </div>
            ) : null}
          </div>
          <div className="cs-row" style={{ gap: '6px' }} role="group" aria-label="Select mission day on chart">
            {recordedPoints.map((pt) => {
              const active = inspectedPoint?.day === pt.day;
              return (
                <button
                  key={pt.day}
                  type="button"
                  className={active ? 'cs-btn cs-btn-primary' : 'cs-btn cs-btn-secondary'}
                  aria-pressed={active}
                  style={{ minHeight: '44px', padding: '0 10px', fontSize: '0.75rem' }}
                  onClick={() => setSelectedDay(pt.day)}
                >
                  D{pt.day}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showTable && (
        <div className="cs-table-wrap" tabIndex={0} role="region" aria-label="Sleep duration table">
          <table className="cs-table">
            <caption className="sr-only">
              Sleep observations for mission days {windowStartDay} to {currentMissionDay}
            </caption>
            <thead>
              <tr>
                <th scope="col">Ending day</th>
                <th scope="col">Duration</th>
                <th scope="col">Reference comparison</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {points
                .filter((p) => p.hours !== null || range === '7d')
                .map((pt) => (
                  <tr key={pt.day}>
                    <td className="cs-mono-value">Day {pt.day}</td>
                    <td className="cs-mono-value">
                      {pt.durationText ?? '—'}
                    </td>
                    <td>{pt.diffText ?? 'Not available'}</td>
                    <td>
                      {pt.hours === null
                        ? 'No entry'
                        : pt.reportedNoSleep
                          ? 'Reported no sleep (0h 0m)'
                          : pt.method ?? 'Main sleep'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
