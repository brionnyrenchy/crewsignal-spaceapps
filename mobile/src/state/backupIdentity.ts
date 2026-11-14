/**
 * Stable identity helpers used to bind a validated backup file, a replace
 * target and its draft preview together. Pure and synchronous: the same
 * bytes of meaning always yield the same string, whatever the key order.
 */

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`;
}

/** cyrb53: small, fast, non-cryptographic 53-bit hash. Identity, not security. */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return value.toString(16).padStart(14, '0');
}

/** Identity of a parsed backup file's contents. */
export function backupIdentityOf(raw: unknown): string {
  const text = stableStringify(raw);
  return `bk-${text.length.toString(16)}-${hashString(text)}`;
}

/** Signature of the exact set of drafts a replace would supersede. */
export function draftSignatureOf(drafts: readonly { draftId: string }[]): string {
  const sorted = [...drafts].sort((a, b) => a.draftId.localeCompare(b.draftId));
  const text = stableStringify(sorted);
  return `dr-${sorted.length}-${hashString(text)}`;
}
