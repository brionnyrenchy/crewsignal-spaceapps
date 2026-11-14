import { ReferenceValueSchema, type ManualReferenceCapture, type MetricId, type PersonalReference, type ReferenceValue } from './contracts';
import { METRIC_DEFINITIONS, parseStrictFiniteNumber } from './metrics';

export interface ManualReferenceInput {
  metricId: Exclude<MetricId, 'mood'>;
  primaryText: string; secondaryText?: string;
  method: string; context: string; unit: string;
  confirmedPreviousReferenceId?: string;
}
export function validateManualReference(input: ManualReferenceInput): {
  valid: boolean; errors: Record<string,string>; value: ReferenceValue | null; capture: ManualReferenceCapture | null;
} {
  const errors: Record<string,string> = {};
  const def = METRIC_DEFINITIONS[input.metricId];
  const primary = parseStrictFiniteNumber(input.primaryText);
  const secondary = parseStrictFiniteNumber(input.secondaryText ?? '');
  if (primary === null) errors.primary = 'Enter an explicit finite number.';
  if (input.metricId === 'blood_pressure' && primary !== null && primary <= 0) errors.primary = 'Enter a positive systolic value in mmHg.';
  if (input.metricId === 'sleep' && primary !== null && (!Number.isInteger(primary) || primary < 0)) errors.primary = 'Enter whole minutes; the sleep reference contract uses integer minutes.';
  if (input.metricId === 'blood_pressure' && (secondary === null || secondary <= 0)) errors.secondary = 'Enter an explicit positive diastolic value in mmHg.';
  if (!input.method || input.method === 'Not specified' || !def.methodOptions.includes(input.method)) errors.method = 'Select the measurement method.';
  if (!input.context || input.context === 'Not specified' || !def.contextOptions.includes(input.context)) errors.context = 'Select the measurement context.';
  if (input.unit !== def.canonicalUnit) errors.unit = 'Use the labelled canonical unit: ' + def.canonicalUnit;
  let value: ReferenceValue | null = input.metricId === 'blood_pressure'
    ? {kind:'blood_pressure',systolic:primary ?? 0,diastolic:secondary ?? 0}
    : input.metricId === 'sleep' ? {kind:'sleep_duration',durationMinutes:primary ?? 0}
    : {kind:'scalar',value:primary ?? 0};
  if (!ReferenceValueSchema.safeParse(value).success && !errors.primary && !errors.secondary) errors.primary = 'Enter a value supported by this reference contract.';
  if (Object.keys(errors).length) return {valid:false,errors,value:null,capture:null};
  return {valid:true,errors,value,capture:{kind:'explicit_manual_v1',primaryText:input.primaryText,secondaryText:input.secondaryText,method:input.method,context:input.context,unit:input.unit,confirmedPreviousReferenceId:input.confirmedPreviousReferenceId}};
}

/** Never infer whether both inputs were captured from the numeric pair alone. */
export function needsManualReferenceConfirmation(reference: PersonalReference): boolean {
  if (reference.metricId !== 'blood_pressure' || reference.provenance !== 'user_updated') return false;
  const capture = reference.manualCapture;
  if (!capture || capture.kind !== 'explicit_manual_v1') return true;
  const parsed = validateManualReference({...capture,metricId:'blood_pressure'});
  return !parsed.valid || (parsed.value?.kind !== 'blood_pressure' || reference.value?.kind !== 'blood_pressure' || parsed.value.systolic !== reference.value.systolic || parsed.value.diastolic !== reference.value.diastolic) ||
    capture.unit !== reference.unit || capture.method !== reference.method || capture.context !== reference.context;
}
