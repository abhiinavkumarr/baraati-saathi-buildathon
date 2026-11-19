// One tiny query interface over AlloyDB Express (via `pg`) or, when
// DATABASE_URL is unset, an embedded PGlite database for local development.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Row = Record<string, unknown>;
export interface Db {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  kind: 'alloydb' | 'pglite';
}

const schemaPath = fileURLToPath(new URL('../db/schema.sql', import.meta.url));

let dbPromise: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  dbPromise ??= open();
  return dbPromise;
}

async function open(): Promise<Db> {
  const schema = readFileSync(schemaPath, 'utf8');
  const url = process.env.DATABASE_URL;

  if (url) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    await pool.query(schema);
    console.log('[db] connected to AlloyDB / Postgres');
    return {
      kind: 'alloydb',
      async query(sql, params = []) {
        const res = await pool.query(sql, params);
        return res.rows;
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  mkdirSync('.data', { recursive: true });
  const lite = new PGlite('.data/pglite');
  await lite.exec(schema);
  console.log('[db] using local PGlite in .data/pglite (set DATABASE_URL for AlloyDB)');
  return {
    kind: 'pglite',
    async query(sql, params = []) {
      const res = await lite.query(sql, params);
      return res.rows as never;
    },
  };
}
