import { describe, expect, test } from '@jest/globals';
import { backupIdentityOf, draftSignatureOf, stableStringify } from '../src/state/backupIdentity';
import { uniqueFilename } from '../src/platform/files';

describe('backup identity and draft signature (bind preview, consent, file and write)', () => {
  const backup = { kind: 'crewsignal-backup', profile: { profileId: 'p1', label: 'A' }, observations: [{ id: 'o1', v: 1 }] };

  test('a backup keeps its identity whatever the key order, and any content change changes it', () => {
    const reordered = { observations: [{ v: 1, id: 'o1' }], profile: { label: 'A', profileId: 'p1' }, kind: 'crewsignal-backup' };
    expect(backupIdentityOf(reordered)).toBe(backupIdentityOf(backup));
    expect(backupIdentityOf(backup)).toMatch(/^bk-[0-9a-f]+-[0-9a-f]{14}$/);
    expect(backupIdentityOf({ ...backup, profile: { profileId: 'p1', label: 'B' } })).not.toBe(backupIdentityOf(backup));
    expect(backupIdentityOf({ ...backup, observations: [{ id: 'o1', v: 2 }] })).not.toBe(backupIdentityOf(backup));
    expect(backupIdentityOf({ ...backup, observations: [] })).not.toBe(backupIdentityOf(backup));
    // Array order is part of the content.
    expect(backupIdentityOf({ a: [1, 2] })).not.toBe(backupIdentityOf({ a: [2, 1] }));
  });

  test('undefined fields are ignored, as they are in JSON', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(backupIdentityOf({ a: 1, b: undefined })).toBe(backupIdentityOf(JSON.parse('{"a":1}')));
  });

  test('a draft set has one signature however it is ordered, and it moves with the set and the content', () => {
    const d1 = { draftId: 'd1', note: 'x' };
    const d2 = { draftId: 'd2', note: 'y' };
    expect(draftSignatureOf([d1, d2])).toBe(draftSignatureOf([d2, d1]));
    expect(draftSignatureOf([d1, d2])).toMatch(/^dr-2-/);
    expect(draftSignatureOf([])).toMatch(/^dr-0-/);
    expect(draftSignatureOf([d1])).not.toBe(draftSignatureOf([d1, d2]));
    expect(draftSignatureOf([d1, { ...d2, note: 'changed' }])).not.toBe(draftSignatureOf([d1, d2]));
    expect(draftSignatureOf([d1, { draftId: 'd3', note: 'y' }])).not.toBe(draftSignatureOf([d1, d2]));
  });
});

describe('uniqueFilename (repeat saves never replace an existing recovery copy)', () => {
  test('a free name is kept as is', () => {
    expect(uniqueFilename('crewsignal-backup-p1.json', [])).toBe('crewsignal-backup-p1.json');
    expect(uniqueFilename('crewsignal-backup-p1.json', ['other.json'])).toBe('crewsignal-backup-p1.json');
  });

  test('a taken name gets "(2)", then "(3)", before the extension', () => {
    expect(uniqueFilename('b.json', ['b.json'])).toBe('b (2).json');
    expect(uniqueFilename('b.json', ['b.json', 'b (2).json'])).toBe('b (3).json');
    expect(uniqueFilename('b.json', ['b.json', 'b (3).json'])).toBe('b (2).json');
  });

  test('names compare case-insensitively, as common file systems do', () => {
    expect(uniqueFilename('Backup.json', ['backup.JSON'])).toBe('Backup (2).json');
    expect(uniqueFilename('backup.json', ['BACKUP.json', 'Backup (2).JSON'])).toBe('backup (3).json');
  });

  test('names without an extension, or only a leading dot, still get a suffix', () => {
    expect(uniqueFilename('notes', ['notes'])).toBe('notes (2)');
    expect(uniqueFilename('.hidden', ['.hidden'])).toBe('.hidden (2)');
  });
});
