import { neon } from '@neondatabase/serverless';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

/** True when a database is configured. Without one the public site renders seed fixtures. */
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

function isNeon(url: string) {
  try {
    return new URL(url).hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}

function create(): DB {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Production: Neon over HTTP (guide's @neondatabase/serverless). Local dev: plain Postgres.
  if (isNeon(url)) return drizzleNeon({ client: neon(url), schema }) as unknown as DB;
  return drizzlePg({ client: new Pool({ connectionString: url, max: 5 }), schema }) as unknown as DB;
}

let instance: DB | undefined;
export function getDb(): DB {
  instance ??= create();
  return instance;
}

/** Lazy handle: nothing connects (or throws) until the first query. Safe to import at build time. */
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb();
    const v = Reflect.get(real, prop, real);
    return typeof v === 'function' ? v.bind(real) : v;
  },
});

export { schema };
