// A small CSV reader (RFC 4180 plus the semicolon and tab variants spreadsheets export).
// It only splits text into cells. It never trims, converts or drops a value.

export type Delimiter = ',' | ';' | '\t';

export interface CsvTable {
  delimiter: Delimiter;
  /** The first row, trimmed. */
  headers: string[];
  /** Every row after the header, including blank ones, so row numbers match the file. */
  rows: string[][];
}

export type CsvResult = { ok: true; table: CsvTable } | { ok: false; error: string };

const DELIMITERS: readonly Delimiter[] = [',', ';', '\t'];

/** Picks the delimiter that occurs most often in the header row, outside quotes. */
function detectDelimiter(text: string): Delimiter {
  const counts = new Map<Delimiter, number>(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === '\n' || char === '\r')) break;
    else if (!quoted && counts.has(char as Delimiter)) counts.set(char as Delimiter, counts.get(char as Delimiter)! + 1);
  }
  let best: Delimiter = ',';
  for (const delimiter of DELIMITERS) if (counts.get(delimiter)! > counts.get(best)!) best = delimiter;
  return best;
}

export function parseCsv(input: string): CsvResult {
  const text = input.startsWith('﻿') ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let quoteStartRecord = 0;
  let sawAnything = false;

  const endCell = () => {
    record.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    records.push(record);
    record = [];
    sawAnything = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') {
        cell += char;
      } else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
      quoteStartRecord = records.length + 1;
      sawAnything = true;
    } else if (char === delimiter) {
      endCell();
      sawAnything = true;
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
    } else {
      cell += char;
      sawAnything = true;
    }
  }
  if (quoted) {
    return { ok: false, error: `A quoted value that starts on row ${quoteStartRecord} is never closed.` };
  }
  // The last line counts unless the file simply ended with a line break.
  if (sawAnything || cell !== '' || record.length > 0) endRecord();

  const [first, ...rows] = records;
  const headers = (first ?? []).map((header) => header.trim());
  if (headers.every((header) => header === '')) {
    return { ok: false, error: 'The file has no header row. The first row must name the columns.' };
  }
  return { ok: true, table: { delimiter, headers, rows } };
}

/** Column names for display: unnamed columns get a position, repeated names get a counter. */
export function columnLabels(headers: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header === '' ? `Column ${index + 1}` : header;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}
