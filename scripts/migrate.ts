// Apply drizzle/ migrations and ensure default settings rows exist (idempotent).
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';

config({ path: '.env.local' });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL(_UNPOOLED) is not set — see .env.example');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: './drizzle' });
  const { SETTINGS_DEFAULTS } = await import('../src/lib/settings-defaults');
  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
    await db.execute(
      sql`insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb) on conflict (key) do nothing`,
    );
  }
  await pool.end();
  console.log('migrations applied; settings defaults ensured');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
