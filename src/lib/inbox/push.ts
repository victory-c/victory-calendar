import 'server-only';
import { z } from 'zod';
import type { DB } from '../db';
import { newId } from '../ids';
import { normalizeUrl } from '../ingest/normalize';
import { upsertCandidate } from './candidates';
import { providerKeyFrom } from './keys';

// POST /api/ingest with mode "candidate" (guide「快速添加与 skill 共用的 API 契约」): the
// weekly-events skill's picks land in the inbox, never on the site. Same dedupe as the feeds.

export const CandidateItem = z.object({
  url: z.string().min(4).max(2048),
  title: z.string().trim().min(1).max(300),
  start_at: z.iso.datetime({ offset: true }),
  end_at: z.iso.datetime({ offset: true }).nullish(),
  tz: z.string().max(64).nullish(),
  location: z.string().max(200).nullish(),
  ical_uid: z.string().max(500).nullish(),
  comment: z.string().max(2000).nullish(),
  suggest_going: z.boolean().nullish(),
});
export const CandidateBatch = z.object({
  mode: z.literal('candidate'),
  batch: z.array(CandidateItem).min(1).max(100),
});

export type PushResult = {
  url: string;
  status: 'created' | 'merged' | 'added' | 'error';
  candidate_id?: string;
  event_id?: string;
  error?: string;
};

export async function pushCandidates(batch: z.infer<typeof CandidateItem>[], opts: { db?: DB; now?: Date } = {}) {
  const batchId = newId('skb');
  const results: PushResult[] = [];
  for (const item of batch) {
    let url: string;
    try {
      url = normalizeUrl(item.url).toString();
    } catch (e) {
      results.push({ url: item.url, status: 'error', error: e instanceof Error ? e.message : 'bad url' });
      continue;
    }
    const start = new Date(item.start_at);
    const end = item.end_at ? new Date(item.end_at) : null;
    const r = await upsertCandidate(
      {
        sourceKind: 'skill',
        sourceRef: batchId,
        providerKey: providerKeyFrom([url], item.ical_uid),
        icalUid: item.ical_uid ?? null,
        title: item.title,
        startAt: start,
        endAt: end && end > start ? end : null,
        location: item.location ?? null,
        links: [url],
        snippet: null,
        suggestComment: item.comment?.trim().slice(0, 2000) || null,
        suggestGoing: item.suggest_going ?? false,
      },
      opts,
    );
    if (!r) continue;
    results.push({
      url,
      status: r.eventId ? 'added' : r.created ? 'created' : 'merged',
      candidate_id: r.id,
      ...(r.eventId ? { event_id: r.eventId } : {}),
    });
  }
  return { batch_id: batchId, results };
}
