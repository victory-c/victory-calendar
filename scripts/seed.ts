// Insert the 20 sample events (src/lib/events/seed.ts) as published rows with template
// covers. Idempotent: existing slugs are skipped. Usage: pnpm db:seed
import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const schema = await import('../src/lib/db/schema');
  const { seedEvents } = await import('../src/lib/events/seed');
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle({ client: pool, schema });
  let inserted = 0;
  for (const e of seedEvents()) {
    const coverId = `cov_${e.id}`;
    await db
      .insert(schema.covers)
      .values({
        id: coverId, kind: 'template', url1600: `template:${e.category}`, url800: `template:${e.category}`,
        url400: `template:${e.category}`, urlOgEn: '', urlOgZh: '', thumbhash: '', dominant: '', bytes: 0,
      })
      .onConflictDoNothing();
    const res = await db
      .insert(schema.events)
      .values({
        id: e.id, slug: e.slug, status: e.status, titleEn: e.titleEn, titleZh: e.titleZh, noteEn: e.noteEn,
        noteZh: e.noteZh, category: e.category, eventLanguage: e.eventLanguage, startAt: e.startAt, endAt: e.endAt,
        tz: e.tz, format: e.format, venueName: e.venueName, city: e.city, region: e.region, privateVenue: e.privateVenue,
        priceText: e.priceText, access: e.access, hostName: e.hostName, sourceUrl: e.sourceUrl, going: e.going,
        goingVisibility: e.goingVisibility, featured: e.featured, coverId, coverPolicy: 'template',
        publishedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: schema.events.id });
    inserted += res.length;
  }
  await pool.end();
  console.log(`seeded ${inserted} events`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
