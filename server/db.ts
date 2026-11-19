// One tiny query interface over AlloyDB (via `pg`) or, when DATABASE_URL is
// unset or AlloyDB can't be reached, an embedded PGlite database. The fallback
// keeps a live demo working on bad Wi-Fi; /api/health reports which one is used.
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Row = Record<string, unknown>;
export interface Db {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  kind: 'alloydb' | 'pglite';
  note?: string;
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
    try {
      const { default: pg } = await import('pg');
      const host = new URL(url).hostname;
      const local = host === '127.0.0.1' || host === 'localhost'; // e.g. the AlloyDB Auth Proxy
      const pool = new pg.Pool({
        connectionString: url,
        max: 5,
        connectionTimeoutMillis: 10_000,
        // AlloyDB's public DNS endpoint uses TLS with a Google-managed CA.
        ssl: local || /sslmode=/.test(url) ? undefined : { rejectUnauthorized: false },
      });
      await pool.query(schema);
      console.log(`[db] connected to AlloyDB (${local ? 'via Auth Proxy' : host})`);
      return {
        kind: 'alloydb',
        async query(sql, params = []) {
          const res = await pool.query(sql, params);
          return res.rows;
        },
      };
    } catch (e) {
      if (process.env.DB_STRICT === '1') throw e;
      console.error('[db] AlloyDB unavailable, falling back to PGlite:', (e as Error).message);
      return openLite(schema, `AlloyDB unavailable: ${(e as Error).message}`);
    }
  }
  return openLite(schema);
}

async function openLite(schema: string, note?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || '.data/pglite';
  mkdirSync(dir, { recursive: true });
  const lite = new PGlite(dir);
  await lite.exec(schema);
  console.log(`[db] using PGlite in ${dir}`);
  return {
    kind: 'pglite',
    note,
    async query(sql, params = []) {
      const res = await lite.query(sql, params);
      return res.rows as never;
    },
  };
}
