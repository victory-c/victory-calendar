// Create, list or revoke personal API tokens until the Settings screen exists (week 10).
//   pnpm api-token create "iPhone Add to Picks" ingest
//   pnpm api-token create "iPhone Add & Publish" ingest,publish
//   pnpm api-token create weekly-events-skill candidates,ingest
//   pnpm api-token list
//   pnpm api-token revoke tok_…
// The plaintext token is printed once; only its SHA-256 is stored. Uses DATABASE_URL from
// .env.local, or pass DATABASE_URL=… for another database (e.g. Neon production).
import { config } from 'dotenv';

config({ path: '.env.local' });

const SCOPES = ['ingest', 'publish', 'candidates'];

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { eq } = await import('drizzle-orm');
  const { Pool } = await import('pg');
  const schema = await import('../src/lib/db/schema');
  const { newId } = await import('../src/lib/ids');
  const { generateToken, hashToken } = await import('../src/lib/api/token-hash');
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle({ client: pool, schema });
  try {
    if (cmd === 'create' && a) {
      const scopes = (b ?? 'ingest').split(',').map((s) => s.trim());
      const bad = scopes.filter((s) => !SCOPES.includes(s));
      if (bad.length) throw new Error(`unknown scope: ${bad.join(', ')} (use ${SCOPES.join(', ')})`);
      const token = generateToken();
      const id = newId('tok');
      await db.insert(schema.apiTokens).values({ id, name: a, tokenHash: hashToken(token), scopes });
      console.log(`created ${id} "${a}" [${scopes.join(', ')}]\n\n${token}\n\nShown once. Store it in the shortcut, not in chat or git.`);
    } else if (cmd === 'list') {
      const rows = await db.select().from(schema.apiTokens);
      for (const r of rows) {
        console.log(`${r.id}  ${r.name}  [${r.scopes.join(',')}]  last used ${r.lastUsedAt?.toISOString() ?? 'never'}${r.revokedAt ? '  REVOKED' : ''}`);
      }
    } else if (cmd === 'revoke' && a) {
      await db.update(schema.apiTokens).set({ revokedAt: new Date() }).where(eq(schema.apiTokens.id, a));
      console.log(`revoked ${a}`);
    } else {
      console.log('usage: pnpm api-token create <name> [scopes] | list | revoke <id>');
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
