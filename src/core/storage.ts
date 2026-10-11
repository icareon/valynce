import { copyFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ImportBatch, ImportRow, InsertResult, NcrFields, NcrOrigin, NcrRecord } from './ncr.ts';

// One entry per schema version, applied in order. Never edit an entry that has
// shipped; add a new one. Existing records must survive every migration.
const MIGRATIONS: readonly string[] = [
  // 1: records and settings.
  `
  CREATE TABLE ncr (
    id INTEGER PRIMARY KEY,
    ncr_number TEXT NOT NULL UNIQUE,
    opened_on TEXT,
    part_number TEXT,
    supplier TEXT,
    defect_category TEXT,
    description TEXT,
    quantity_affected INTEGER,
    cost_cents INTEGER,
    status TEXT,
    disposition TEXT,
    reported_cause TEXT,
    origin TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;
  `,
  // 2: currency. Costs stored before this have no stated currency and keep NULL.
  // The only exception is Valynce's own synthetic demo records, which are defined as USD.
  `
  ALTER TABLE ncr ADD COLUMN currency TEXT;
  UPDATE ncr SET currency = 'USD' WHERE origin = 'sample' AND cost_cents IS NOT NULL;
  `,
  // 3: where imported records came from.
  `
  CREATE TABLE import_batch (
    id INTEGER PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_sha256 TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    settings_json TEXT NOT NULL,
    rows_total INTEGER NOT NULL,
    rows_imported INTEGER NOT NULL,
    rows_duplicate INTEGER NOT NULL,
    rows_rejected INTEGER NOT NULL,
    rows_blank INTEGER NOT NULL
  ) STRICT;
  ALTER TABLE ncr ADD COLUMN import_batch_id INTEGER REFERENCES import_batch (id);
  ALTER TABLE ncr ADD COLUMN source_row INTEGER;
  ALTER TABLE ncr ADD COLUMN source_json TEXT;
  `,
];

const INSERT_NCR = `
  INSERT INTO ncr (
    ncr_number, opened_on, part_number, supplier, defect_category, description,
    quantity_affected, cost_cents, currency, status, disposition, reported_cause, origin, created_at,
    import_batch_id, source_row, source_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function ncrValues(r: NcrFields): (string | number | null)[] {
  return [
    r.ncrNumber,
    r.openedOn,
    r.partNumber,
    r.supplier,
    r.defectCategory,
    r.description,
    r.quantityAffected,
    r.costCents,
    r.currency,
    r.status,
    r.disposition,
    r.reportedCause,
  ];
}

export interface ImportBatchInput {
  fileName: string;
  fileSha256: string;
  /** The mapping and options the import used, kept so the result can be explained later. */
  settings: unknown;
  rowsTotal: number;
  rowsDuplicate: number;
  rowsRejected: number;
  rowsBlank: number;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

export class NcrStorage {
  readonly #db: DatabaseSync;

  /** Pass a file path, or ':memory:' for a throwaway database. */
  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    const row = this.#db.prepare('PRAGMA user_version').get();
    const version = Number(row?.user_version ?? 0);
    if (version > SCHEMA_VERSION) {
      this.#db.close();
      throw new Error(
        `This database is schema version ${version}, but this Valynce only knows up to ${SCHEMA_VERSION}. ` +
          'It was not changed. Use a newer Valynce to open it.',
      );
    }
    if (version > 0 && version < SCHEMA_VERSION && dbPath !== ':memory:') {
      // Keep an untouched copy of an existing database before changing its structure.
      const backup = `${dbPath}.v${version}.bak`;
      if (!existsSync(backup)) copyFileSync(dbPath, backup);
    }
    for (let next = version; next < SCHEMA_VERSION; next += 1) {
      this.#transaction(() => {
        this.#db.exec(MIGRATIONS[next]!);
        this.#db.exec(`PRAGMA user_version = ${next + 1}`);
      });
    }
  }

  list(): NcrRecord[] {
    const rows = this.#db
      .prepare('SELECT * FROM ncr ORDER BY opened_on IS NULL, opened_on DESC, ncr_number')
      .all();
    return rows.map((row) => ({
      id: row.id as number,
      ncrNumber: row.ncr_number as string,
      openedOn: row.opened_on as string | null,
      partNumber: row.part_number as string | null,
      supplier: row.supplier as string | null,
      defectCategory: row.defect_category as string | null,
      description: row.description as string | null,
      quantityAffected: row.quantity_affected as number | null,
      costCents: row.cost_cents as number | null,
      currency: row.currency as string | null,
      status: row.status as string | null,
      disposition: row.disposition as string | null,
      reportedCause: row.reported_cause as string | null,
      origin: row.origin as NcrOrigin,
      createdAt: row.created_at as string,
      importBatchId: row.import_batch_id as number | null,
      sourceRow: row.source_row as number | null,
      sourceValues: row.source_json === null ? null : (JSON.parse(row.source_json as string) as Record<string, string>),
    }));
  }

  count(origin?: NcrOrigin): number {
    const row =
      origin === undefined
        ? this.#db.prepare('SELECT COUNT(*) AS n FROM ncr').get()
        : this.#db.prepare('SELECT COUNT(*) AS n FROM ncr WHERE origin = ?').get(origin);
    return Number(row?.n ?? 0);
  }

  /**
   * Stores records in one transaction. A record whose NCR number is already
   * stored (or repeated earlier in the same batch) is skipped, not overwritten.
   */
  insertMany(records: readonly NcrFields[], origin: NcrOrigin): InsertResult {
    const insert = this.#db.prepare(`${INSERT_NCR} ON CONFLICT (ncr_number) DO NOTHING`);
    const createdAt = new Date().toISOString();
    const result: InsertResult = { inserted: 0, skippedDuplicates: [] };
    this.#transaction(() => {
      for (const r of records) {
        const { changes } = insert.run(...ncrValues(r), origin, createdAt, null, null, null);
        if (Number(changes) === 1) result.inserted += 1;
        else result.skippedDuplicates.push(r.ncrNumber);
      }
    });
    return result;
  }

  /**
   * Stores one imported file's records together with a record of the import
   * itself. All of it is written, or none of it: an NCR ID that is already
   * stored makes the whole import fail rather than overwrite anything.
   */
  importBatch(input: ImportBatchInput, rows: readonly ImportRow[]): ImportBatch {
    const importedAt = new Date().toISOString();
    let id = 0;
    this.#transaction(() => {
      const batch = this.#db
        .prepare(`
          INSERT INTO import_batch (
            file_name, file_sha256, imported_at, settings_json,
            rows_total, rows_imported, rows_duplicate, rows_rejected, rows_blank
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          input.fileName,
          input.fileSha256,
          importedAt,
          JSON.stringify(input.settings),
          input.rowsTotal,
          rows.length,
          input.rowsDuplicate,
          input.rowsRejected,
          input.rowsBlank,
        );
      id = Number(batch.lastInsertRowid);
      const insert = this.#db.prepare(INSERT_NCR);
      for (const row of rows) {
        insert.run(...ncrValues(row.fields), 'import', importedAt, id, row.sourceRow, JSON.stringify(row.sourceValues));
      }
    });
    return this.listImports().find((batch) => batch.id === id)!;
  }

  /** Imports that still have their record, newest first. */
  listImports(): ImportBatch[] {
    return this.#db
      .prepare('SELECT * FROM import_batch ORDER BY id DESC')
      .all()
      .map((row) => ({
        id: row.id as number,
        fileName: row.file_name as string,
        fileSha256: row.file_sha256 as string,
        importedAt: row.imported_at as string,
        rowsTotal: row.rows_total as number,
        rowsImported: row.rows_imported as number,
        rowsDuplicate: row.rows_duplicate as number,
        rowsRejected: row.rows_rejected as number,
        rowsBlank: row.rows_blank as number,
      }));
  }

  /** Undoes one import: removes the records it added and its entry. Returns how many records went. */
  deleteImport(id: number): number | null {
    let removed: number | null = null;
    this.#transaction(() => {
      const exists = this.#db.prepare('SELECT 1 FROM import_batch WHERE id = ?').get(id);
      if (exists === undefined) return;
      removed = Number(this.#db.prepare('DELETE FROM ncr WHERE import_batch_id = ?').run(id).changes);
      this.#db.prepare('DELETE FROM import_batch WHERE id = ?').run(id);
    });
    return removed;
  }

  deleteByOrigin(origin: NcrOrigin): number {
    const { changes } = this.#db.prepare('DELETE FROM ncr WHERE origin = ?').run(origin);
    return Number(changes);
  }

  getMeta(key: string): string | null {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row === undefined ? null : (row.value as string);
  }

  setMeta(key: string, value: string): void {
    this.#db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  close(): void {
    this.#db.close();
  }

  #transaction(work: () => void): void {
    this.#db.exec('BEGIN');
    try {
      work();
      this.#db.exec('COMMIT');
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }
}
