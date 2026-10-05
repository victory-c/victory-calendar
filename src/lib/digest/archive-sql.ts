import { sql } from 'drizzle-orm';
import { digestIssues } from '../db/schema';

// isArchivable() (archive.ts) as SQL over digest_issues, shared by the public archive's reads
// (archive-queries.ts: the /weekly index, the sitemap, the preview link) and the admin's issue
// list (issues.ts listIssues: the "public page" link), so nothing ever links to a /weekly page
// that 404s. Callers add the status condition ('sending' | 'sent', or 'sent' only for the index).

const snapshot = digestIssues.snapshot;
/** Events in a stored snapshot; 0 when it isn't an array (jsonb_array_length would throw). */
const eventCount = sql`case when jsonb_typeof(${snapshot} -> 'events') = 'array' then jsonb_array_length(${snapshot} -> 'events') else 0 end`;

/** A version-1 snapshot of the row's own week with a preview list and at least one event. Can be NULL (false in a WHERE). */
export const archivable = sql<boolean>`(${snapshot} ->> 'version' = '1' and ${snapshot} ->> 'isoWeek' = ${digestIssues.isoWeek}
  and jsonb_typeof(${snapshot} -> 'preview') = 'array' and ${eventCount} > 0)`;
