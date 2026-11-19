import { drizzle } from 'drizzle-orm/node-postgres';
import { attachDatabasePool } from '@vercel/functions';
import { Pool } from 'pg';
import { resolveDbConfig } from './connection-config.ts';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

/**
 * One pool per server instance. Settings come from src/db/connection-config.ts: DATABASE_URL
 * (Supabase transaction pooler in production) or the SQL_* variables for local development.
 */
export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool(resolveDbConfig().pool);

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });

    // Vercel Fluid compute: closes idle clients before an instance is suspended, so connections
    // aren't leaked at the pooler. A no-op outside Vercel.
    if (process.env.VERCEL) attachDatabasePool(global._postgresPool);
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
