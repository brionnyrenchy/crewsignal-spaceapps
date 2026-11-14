import { describe, expect, it } from 'vitest';
import { validateManualReference, needsManualReferenceConfirmation, createNewReferenceVersion, compareObservationToReference, PersonalReferenceSchema, METRIC_DEFINITIONS, SIM_01_OBSERVATIONS, SIM_01_REFERENCES } from '../src';
const input = {metricId:'blood_pressure' as const,primaryText:'118',secondaryText:'76',unit:'mmHg',method:'Manual cuff',context:'At rest'};
describe('Explicit manual reference values',()=>{
 it.each(['','118junk','118/76','0x76','1e2','Infinity','NaN'])('rejects malformed primary %s',primaryText=>expect(validateManualReference({...input,primaryText}).errors.primary).toBeTruthy());
 it.each(['','76junk','Infinity'])('rejects missing/malformed diastolic %s',secondaryText=>expect(validateManualReference({...input,secondaryText}).errors.secondary).toBeTruthy());
 it.each(['','Not specified','Unknown'])('requires known context %s',context=>expect(validateManualReference({...input,context}).errors.context).toBeTruthy());
 it('requires a selected method and canonical labelled unit',()=>{
   expect(validateManualReference({...input,method:''}).errors.method).toBeTruthy();
   expect(validateManualReference({...input,unit:'bpm'}).errors.unit).toBeTruthy();
 });
 it('preserves every BP decimal allowed by the contract and never derives a component',()=>{
   expect(validateManualReference({...input,primaryText:'118.12345',secondaryText:'76.56789'}).value).toEqual({kind:'blood_pressure',systolic:118.12345,diastolic:76.56789});
   expect(validateManualReference({...input,secondaryText:''}).value).toBeNull();
 });
 it('rejects fractional sleep minutes rather than silently rounding',()=>expect(validateManualReference({metricId:'sleep',primaryText:'444.5',unit:'min',method:METRIC_DEFINITIONS.sleep.methodOptions[0]!,context:METRIC_DEFINITIONS.sleep.contextOptions[0]!}).valid).toBe(false));
 it('keeps unverifiable legacy BP history readable but unavailable until explicit replacement',()=>{
   const observation=SIM_01_OBSERVATIONS.find(o=>o.metricId==='blood_pressure')!;
   const prior=PersonalReferenceSchema.parse({...SIM_01_REFERENCES[0]!,metricId:'blood_pressure',referenceId:'legacy-bp',unit:'mmHg',method:'Manual cuff',context:'At rest',value:{kind:'blood_pressure',systolic:118,diastolic:76},provenance:'user_updated',manualCapture:undefined});
   expect(needsManualReferenceConfirmation(prior)).toBe(true);
   expect(compareObservationToReference(observation,prior).comparisonAvailable).toBe(false);
   const parsed=validateManualReference({...input,confirmedPreviousReferenceId:prior.referenceId});
   const versions=createNewReferenceVersion({existingReferences:[prior],profileId:prior.profileId,metricId:'blood_pressure',provenance:'user_updated',method:input.method,context:input.context,unit:'mmHg',value:parsed.value!,manualCapture:parsed.capture!,createdAtUtc:'2026-11-14T01:00:00Z'});
   expect(versions[0]!.value).toEqual(prior.value);
   expect(versions[0]!.status).toBe('superseded');
   const fresh=versions[1]!;
   expect(fresh.manualCapture!.confirmedPreviousReferenceId).toBe(prior.referenceId);
   expect(needsManualReferenceConfirmation(PersonalReferenceSchema.parse(fresh))).toBe(false);
   const result=compareObservationToReference({...observation,canonical:{kind:'blood_pressure',systolic:120,diastolic:80,precision:1,conversionVersion:observation.canonical.kind==='blood_pressure'?observation.canonical.conversionVersion:'v1',unit:'mmHg'}},fresh);
   expect(result.deltaNumeric).toBe(2);expect(result.diastolicDeltaNumeric).toBe(4);
   expect(compareObservationToReference({...observation,context:'Standing'},fresh).comparisonAvailable).toBe(false);
   expect(compareObservationToReference({...observation,method:'Automated cuff'},fresh).comparisonAvailable).toBe(false);
 });
});
