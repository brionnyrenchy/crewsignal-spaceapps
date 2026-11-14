import {
  CONVERSION_RULE_VERSION,
  NEEDS_RECHECK_LABEL,
  type AppPreferences,
  type CheckInDraft,
  type GlucoseUnit,
  type Observation,
  type TemperatureUnit,
} from './contracts';

export const GLUCOSE_MMOL_TO_MGDL_FACTOR = 18.02 as const;

/**
 * Deterministic rounding helper avoiding binary floating-point representation artifacts.
 */
export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Cannot round non-finite number: ${value}`);
  }
  const factor = Math.pow(10, decimals);
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(value) + Number.EPSILON) * factor)) / factor;
}

export function countDecimalPlaces(raw: string): number {
  const trimmed = raw.trim();
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx === -1) return 0;
  return Math.max(0, trimmed.length - dotIdx - 1);
}

/**
 * Converts blood glucose from mmol/L to mg/dL using CDC NHANES 2021-2022 factor 18.02.
 */
export function mmolLToMgDl(mmolL: number): number {
  if (!Number.isFinite(mmolL) || mmolL < 0) {
    throw new RangeError(`Invalid mmol/L value: ${mmolL}`);
  }
  return roundToDecimals(mmolL * GLUCOSE_MMOL_TO_MGDL_FACTOR, 6);
}

/**
 * Converts blood glucose from mg/dL to mmol/L using exact reciprocal 1 / 18.02.
 */
export function mgDlToMmolL(mgDl: number): number {
  if (!Number.isFinite(mgDl) || mgDl < 0) {
    throw new RangeError(`Invalid mg/dL value: ${mgDl}`);
  }
  return roundToDecimals(mgDl / GLUCOSE_MMOL_TO_MGDL_FACTOR, 6);
}

export function convertGlucose(
  value: number,
  fromUnit: GlucoseUnit,
  toUnit: GlucoseUnit,
): {
  exact: number;
  rounded1: number;
  conversionVersion: typeof CONVERSION_RULE_VERSION;
} {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Invalid glucose value: ${value}`);
  }
  if (fromUnit === toUnit) {
    return {
      exact: roundToDecimals(value, 6),
      rounded1: roundToDecimals(value, 1),
      conversionVersion: CONVERSION_RULE_VERSION,
    };
  }
  const exact =
    fromUnit === 'mmol/L' ? mmolLToMgDl(value) : mgDlToMmolL(value);
  return {
    exact,
    rounded1: roundToDecimals(exact, 1),
    conversionVersion: CONVERSION_RULE_VERSION,
  };
}

/**
 * Exact NIST Celsius to Fahrenheit equation: F = C * 1.8 + 32.
 */
export function celsiusToFahrenheit(celsius: number): number {
  if (!Number.isFinite(celsius)) {
    throw new RangeError(`Invalid Celsius value: ${celsius}`);
  }
  return roundToDecimals(celsius * 1.8 + 32, 6);
}

/**
 * Exact NIST Fahrenheit to Celsius equation: C = (F - 32) / 1.8.
 */
export function fahrenheitToCelsius(fahrenheit: number): number {
  if (!Number.isFinite(fahrenheit)) {
    throw new RangeError(`Invalid Fahrenheit value: ${fahrenheit}`);
  }
  return roundToDecimals((fahrenheit - 32) / 1.8, 6);
}

export function convertTemperature(
  value: number,
  fromUnit: TemperatureUnit,
  toUnit: TemperatureUnit,
): {
  exact: number;
  rounded1: number;
  conversionVersion: typeof CONVERSION_RULE_VERSION;
} {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Invalid temperature value: ${value}`);
  }
  if (fromUnit === toUnit) {
    return {
      exact: roundToDecimals(value, 6),
      rounded1: roundToDecimals(value, 1),
      conversionVersion: CONVERSION_RULE_VERSION,
    };
  }
  const exact =
    fromUnit === 'C' ? celsiusToFahrenheit(value) : fahrenheitToCelsius(value);
  return {
    exact,
    rounded1: roundToDecimals(exact, 1),
    conversionVersion: CONVERSION_RULE_VERSION,
  };
}

export function formatTemperatureUnitSymbol(unit: TemperatureUnit): string {
  return unit === 'C' ? '°C' : '°F';
}

export function formatReviewEquivalent(
  metricId: 'blood_glucose' | 'body_temperature',
  value: number,
  enteredUnit: string,
): {
  targetUnit: string;
  exact: number;
  rounded1: number;
  label: string;
} | null {
  if (metricId === 'blood_glucose') {
    if (enteredUnit === 'mmol/L') {
      const converted = convertGlucose(value, 'mmol/L', 'mg/dL');
      return {
        targetUnit: 'mg/dL',
        exact: converted.exact,
        rounded1: converted.rounded1,
        label: `Equivalent (approx.): ${converted.rounded1.toFixed(1)} mg/dL`,
      };
    }
    if (enteredUnit === 'mg/dL') {
      const converted = convertGlucose(value, 'mg/dL', 'mmol/L');
      return {
        targetUnit: 'mmol/L',
        exact: converted.exact,
        rounded1: converted.rounded1,
        label: `Equivalent (approx.): ${converted.rounded1.toFixed(1)} mmol/L`,
      };
    }
    return null;
  }

  if (metricId === 'body_temperature') {
    if (enteredUnit === 'C') {
      const converted = convertTemperature(value, 'C', 'F');
      return {
        targetUnit: 'F',
        exact: converted.exact,
        rounded1: converted.rounded1,
        label: `Equivalent: ${converted.rounded1.toFixed(1)} °F`,
      };
    }
    if (enteredUnit === 'F') {
      const converted = convertTemperature(value, 'F', 'C');
      return {
        targetUnit: 'C',
        exact: converted.exact,
        rounded1: converted.rounded1,
        label: `Equivalent: ${converted.rounded1.toFixed(1)} °C`,
      };
    }
  }
  return null;
}

export interface InputUnitChangePlan {
  requiresConfirmation: boolean;
  fromUnit: string;
  toUnit: string;
  currentRawValue: string;
  dialogTitle: string;
  dialogBody: string;
  cancelLabel: string;
  confirmLabel: string;
}

function formatUnitDisplayForPrompt(unit: string): string {
  if (unit === 'C') return '°C';
  if (unit === 'F') return '°F';
  return unit;
}

/**
 * Plans an input-unit change during Record entry.
 * Changing unit on a populated numeric field requires explicit confirmation
 * so entered digits are never silently reinterpreted in a new unit.
 */
export function planInputUnitChange(
  currentRawValue: string,
  fromUnit: string,
  toUnit: string,
): InputUnitChangePlan {
  const trimmed = currentRawValue.trim();
  const fromLabel = formatUnitDisplayForPrompt(fromUnit);
  const toLabel = formatUnitDisplayForPrompt(toUnit);
  const requiresConfirmation = fromUnit !== toUnit && trimmed.length > 0;
  return {
    requiresConfirmation,
    fromUnit,
    toUnit,
    currentRawValue: trimmed,
    dialogTitle: 'Change input unit?',
    dialogBody: `You entered ${trimmed} ${fromLabel}. Changing to ${toLabel} will clear this value. Your other details will stay.`,
    cancelLabel: 'Cancel',
    confirmLabel: 'Clear value and change unit',
  };
}

/**
 * Applies or cancels an input-unit change on a CheckInDraft.
 * Canceling preserves all fields untouched; confirming clears ONLY the numeric input
 * and old normalizedCandidate while keeping timing, method, context, note, and draftId.
 */
export function applyInputUnitChange(
  draft: CheckInDraft,
  nextUnit: string,
  confirmed: boolean,
  updatedAtUtc: string,
): CheckInDraft {
  if (draft.selectedUnit === nextUnit) {
    return draft;
  }
  const hadValue = draft.rawFields.primary.trim().length > 0;
  if (hadValue && !confirmed) {
    return draft;
  }
  const nextErrors = { ...draft.validationState.errors };
  delete nextErrors.primary;
  return {
    ...draft,
    selectedUnit: nextUnit,
    rawFields: {
      ...draft.rawFields,
      primary: '',
    },
    normalizedCandidate: null,
    validationState: {
      valid: false,
      errors: nextErrors,
      firstInvalidField: Object.keys(nextErrors)[0] ?? null,
      announcement: null,
    },
    updatedAtUtc,
  };
}

export interface FormattedObservationDisplay {
  primaryText: string;
  valueOnlyText: string;
  unitLabel: string;
  enteredText: string;
  isConvertedDisplay: boolean;
}

/**
 * Formats a committed Observation according to display unit preferences without
 * mutating the stored source value, unit, precision, or conversion version.
 */
export function formatObservationDisplay(
  observation: Observation,
  displayUnits: AppPreferences['displayUnits'],
): FormattedObservationDisplay {
  const display = formatObservationValue(observation, displayUnits);
  if (observation.quality !== 'questionable') return display;
  return {
    ...display,
    primaryText: `${display.primaryText} (${NEEDS_RECHECK_LABEL})`,
  };
}

function formatObservationValue(
  observation: Observation,
  displayUnits: AppPreferences['displayUnits'],
): FormattedObservationDisplay {
  if (observation.entered.kind === 'blood_pressure') {
    const text = `${observation.entered.systolic}/${observation.entered.diastolic}`;
    return {
      primaryText: `${text} mmHg`,
      valueOnlyText: text,
      unitLabel: 'mmHg',
      enteredText: `${text} mmHg`,
      isConvertedDisplay: false,
    };
  }

  if (observation.entered.kind === 'sleep_duration') {
    const mins = observation.entered.durationMinutes;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const formattedDuration = `${h}h ${m.toString().padStart(2, '0')}m`;
    const label = observation.entered.reportedNoSleep
      ? 'Reported no sleep (0h 0m)'
      : formattedDuration;
    const shortLabel = observation.entered.reportedNoSleep ? '0h 0m' : formattedDuration;
    return {
      primaryText: shortLabel,
      valueOnlyText: shortLabel,
      unitLabel: observation.entered.reportedNoSleep ? 'Reported no sleep' : 'Duration',
      enteredText: label,
      isConvertedDisplay: false,
    };
  }

  if (observation.entered.kind === 'mood_ordinal') {
    return {
      primaryText: `${observation.entered.score} / 5`,
      valueOnlyText: `${observation.entered.score} / 5`,
      unitLabel: observation.entered.label,
      enteredText: `${observation.entered.score} / 5 · ${observation.entered.label}`,
      isConvertedDisplay: false,
    };
  }

  // Scalar numeric metrics (heart_rate, blood_glucose, body_temperature)
  const entered = observation.entered;
  const enteredFormatted = `${entered.value.toFixed(entered.precision)}`;

  if (observation.metricId === 'body_temperature') {
    const enteredUnit = entered.unit as TemperatureUnit;
    const targetUnit = displayUnits.body_temperature;
    const enteredUnitSymbol = formatTemperatureUnitSymbol(enteredUnit);
    const enteredFull = `${enteredFormatted} ${enteredUnitSymbol}`;
    if (enteredUnit === targetUnit) {
      return {
        primaryText: enteredFull,
        valueOnlyText: enteredFormatted,
        unitLabel: enteredUnitSymbol,
        enteredText: enteredFull,
        isConvertedDisplay: false,
      };
    }
    const converted = convertTemperature(entered.value, enteredUnit, targetUnit);
    const targetSymbol = formatTemperatureUnitSymbol(targetUnit);
    const targetFormatted = converted.rounded1.toFixed(1);
    return {
      primaryText: `${targetFormatted} ${targetSymbol}`,
      valueOnlyText: targetFormatted,
      unitLabel: targetSymbol,
      enteredText: enteredFull,
      isConvertedDisplay: true,
    };
  }

  if (observation.metricId === 'blood_glucose') {
    const enteredUnit = entered.unit as GlucoseUnit;
    const targetUnit = displayUnits.blood_glucose;
    const enteredFull = `${enteredFormatted} ${enteredUnit}`;
    if (enteredUnit === targetUnit) {
      return {
        primaryText: enteredFull,
        valueOnlyText: enteredFormatted,
        unitLabel: enteredUnit,
        enteredText: enteredFull,
        isConvertedDisplay: false,
      };
    }
    const converted = convertGlucose(entered.value, enteredUnit, targetUnit);
    const targetFormatted = converted.rounded1.toFixed(1);
    return {
      primaryText: `${targetFormatted} ${targetUnit}`,
      valueOnlyText: targetFormatted,
      unitLabel: targetUnit,
      enteredText: enteredFull,
      isConvertedDisplay: true,
    };
  }

  // heart_rate
  return {
    primaryText: `${enteredFormatted} ${entered.unit}`,
    valueOnlyText: enteredFormatted,
    unitLabel: entered.unit,
    enteredText: `${enteredFormatted} ${entered.unit}`,
    isConvertedDisplay: false,
  };
}
