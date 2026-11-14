import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { NodeSqliteDriver } from '../src/storage/nodeDriver';
import { CrewSignalSqliteStore } from '../src/storage/sqliteStore';
import { validateManualReference, needsManualReferenceConfirmation, buildBackupBundle } from '../src/shared/src';
describe('Explicit reference SQLite persistence',()=>{
 test('clean Personal defaults, validation rejection, failed write rollback, and versioned backup restore',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'crewsignal-reference-'));const filename=path.join(directory,'restart.db');
  let driver=new NodeSqliteDriver(filename);let store=new CrewSignalSqliteStore(driver);await store.initialize();
  try {
   const profile=await store.createPersonalProfile({label:'Synthetic reference harness',missionEpochUtc:'2026-11-14T00:00:00Z',nowUtc:'2026-11-14T00:00:00Z'});
   const initial=await store.loadAppSnapshot();expect(initial.active.references).toHaveLength(0);
   const input={metricId:'blood_pressure' as const,primaryText:'118',secondaryText:'76',unit:'mmHg',method:'Manual cuff',context:'At rest'};
   const parsed=validateManualReference(input);
   const params={profileId:profile.profileId,metricId:'blood_pressure' as const,provenance:'user_updated' as const,unit:'mmHg',method:input.method,context:input.context,value:parsed.value!,manualCapture:parsed.capture!,nowUtc:'2026-11-14T01:00:00Z'};
   await expect(store.upsertPersonalReference({...params,manualCapture:{...params.manualCapture,primaryText:'118junk'}})).rejects.toThrow();
   expect((await store.loadAppSnapshot()).active.references).toHaveLength(0);
   const first=await store.upsertPersonalReference(params);expect(first.value).toEqual({kind:'blood_pressure',systolic:118,diastolic:76});
   expect(first.method).toBe('Manual cuff');expect(first.context).toBe('At rest');expect(needsManualReferenceConfirmation(first)).toBe(false);
   await driver.close();driver=new NodeSqliteDriver(filename);store=new CrewSignalSqliteStore(driver);
   expect((await store.loadAppSnapshot()).active.references[0]!.value).toEqual(first.value);
   await store.updatePreferences({...initial.preferences,displayUnits:{...initial.preferences.displayUnits,body_temperature:'F',blood_glucose:'mmol/L'}});
   const run=driver.run.bind(driver);let fail=true;
   driver.run=async(sql,args)=>{if(fail&&sql.includes('INSERT INTO personal_references')){fail=false;throw new Error('simulated disk failure');}return run(sql,args);};
   await expect(store.upsertPersonalReference(params)).rejects.toThrow('simulated disk failure');driver.run=run;
   const reloaded=await new CrewSignalSqliteStore(driver).loadAppSnapshot();expect(reloaded.active.references).toEqual([first]);expect(reloaded.active.observations).toEqual(initial.active.observations);
   const bundle=buildBackupBundle({confirmedIncludeAllProfileData:true,exportedAtUtc:'2026-11-14T01:01:00Z',profile,preferences:reloaded.preferences,observations:reloaded.active.observations,checkInEvents:reloaded.active.checkInEvents,references:reloaded.active.references,insights:reloaded.active.insights});
   const restored=await store.restoreBackupBundle({rawBackup:bundle,destination:'separate_profile'});expect(restored.ok).toBe(true);
   const after=await store.loadAppSnapshot();expect(after.active.references[0]!.value).toEqual(first.value);expect(after.active.references[0]!.manualCapture).toEqual(first.manualCapture);
   expect(after.active.profile.profileId).not.toBe(profile.profileId);
  }finally{await driver.close();if(!path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))throw new Error('Unexpected cleanup directory');fs.rmSync(directory,{recursive:true,force:true});}
 });
});
