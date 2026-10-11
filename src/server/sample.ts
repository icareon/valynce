import { readFileSync } from 'node:fs';
import { parseNcrFields } from '../core/ncr.ts';
import type { NcrFields } from '../core/ncr.ts';

/** Reads the synthetic sample records and refuses the whole file if any record is invalid. */
export function loadSampleRecords(fixturePath: string): NcrFields[] {
  const parsed: unknown = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const list = (parsed as { records?: unknown }).records;
  if (!Array.isArray(list)) throw new Error(`${fixturePath} has no "records" list`);
  return list.map((entry, index) => {
    const result = parseNcrFields(entry);
    if (!result.ok) throw new Error(`${fixturePath} record ${index + 1}: ${result.errors.join('; ')}`);
    return result.value;
  });
}
