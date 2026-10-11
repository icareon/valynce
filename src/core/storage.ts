import { DatabaseSync } from 'node:sqlite';
import type { InsertResult, NcrFields, NcrOrigin, NcrRecord } from './ncr.ts';

const SCHEMA_VERSION = 1;

const SCHEMA = `
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
`;

export class NcrStorage {
  readonly #db: DatabaseSync;

  /** Pass a file path, or ':memory:' for a throwaway database. */
  constructor(dbPath: string) {
    this.#db = new DatabaseSync(dbPath);
    const row = this.#db.prepare('PRAGMA user_version').get();
    const version = Number(row?.user_version ?? 0);
    if (version === 0) {
      this.#transaction(() => {
        this.#db.exec(SCHEMA);
        this.#db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      });
    } else if (version !== SCHEMA_VERSION) {
      this.#db.close();
      throw new Error(
        `This database is schema version ${version}, but this Valynce expects ${SCHEMA_VERSION}. ` +
          'It was not changed. Use a matching Valynce version.',
      );
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
      status: row.status as string | null,
      disposition: row.disposition as string | null,
      reportedCause: row.reported_cause as string | null,
      origin: row.origin as NcrOrigin,
      createdAt: row.created_at as string,
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
    const insert = this.#db.prepare(`
      INSERT INTO ncr (
        ncr_number, opened_on, part_number, supplier, defect_category, description,
        quantity_affected, cost_cents, status, disposition, reported_cause, origin, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (ncr_number) DO NOTHING
    `);
    const createdAt = new Date().toISOString();
    const result: InsertResult = { inserted: 0, skippedDuplicates: [] };
    this.#transaction(() => {
      for (const r of records) {
        const { changes } = insert.run(
          r.ncrNumber,
          r.openedOn,
          r.partNumber,
          r.supplier,
          r.defectCategory,
          r.description,
          r.quantityAffected,
          r.costCents,
          r.status,
          r.disposition,
          r.reportedCause,
          origin,
          createdAt,
        );
        if (Number(changes) === 1) result.inserted += 1;
        else result.skippedDuplicates.push(r.ncrNumber);
      }
    });
    return result;
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
