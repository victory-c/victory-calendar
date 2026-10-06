import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seedEvents } from '@/lib/events/seed';

// /calendar.ics with the F19 facets (PRD F19 acceptance: `ev_lang=zh` works). The cached window is
// replaced by the seed week (2 zh events, 1 bilingual, 2 online); filtering happens in the route,
// so getWindow is called with the same arguments whatever the facets are (one cache entry).

const NOW = new Date('2026-09-28T12:00:00Z');
const events = seedEvents(NOW);
const getWindow = vi.hoisted(() => vi.fn());
vi.mock('@/lib/events/queries', () => ({ getWindow }));

vi.stubEnv('PUBLIC_HOST', 'picks.example.com');
const { GET } = await import('@/app/calendar.ics/route');

beforeEach(() => {
  getWindow.mockReset();
  getWindow.mockResolvedValue({ now: NOW.toISOString(), events, showAttendance: true, sample: true });
});

const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '');
async function feed(qs: string) {
  const res = await GET(new Request(`https://picks.example.com/calendar.ics${qs}`));
  expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
  const body = unfold(await res.text());
  const uids = [...body.matchAll(/^UID:(\S+)@picks\.example\.com\r?$/gm)].map((m) => m[1]).sort();
  const name = /^X-WR-CALNAME:(.*?)\r?$/m.exec(body)?.[1];
  return { uids, name };
}
const ids = (pred: (e: (typeof events)[number]) => boolean) => events.filter(pred).map((e) => e.id).sort();

describe('/calendar.ics facets', () => {
  it('ev_lang=zh keeps only Chinese and bilingual events', async () => {
    const { uids, name } = await feed('?ev_lang=zh');
    expect(uids).toEqual(ids((e) => e.eventLanguage === 'zh' || e.eventLanguage === 'bilingual'));
    expect(uids).toHaveLength(3);
    expect(name).toBe("Victor's Picks · Chinese or bilingual");
  });

  it('online=1 drops in-person events; facets AND with categories and each other', async () => {
    expect((await feed('?online=1')).uids).toEqual(ids((e) => e.format !== 'in_person'));
    const both = await feed('?c=ai,vc,campus,hackathon,conference,social,cycling&lang=zh&ev_lang=en&online=1');
    expect(both.uids).toEqual(ids((e) => e.format !== 'in_person' && e.eventLanguage !== 'zh'));
    expect(both.name).toMatch(/ · 英文或双语活动 · 线上$/);
  });

  it('unknown values are ignored: the full feed', async () => {
    const all = ids(() => true);
    expect((await feed('?ev_lang=fr&online=yes')).uids).toEqual(all);
    expect((await feed('')).uids).toEqual(all);
  });

  it('the cached window is read the same way whatever the facets', async () => {
    await feed('?ev_lang=zh&online=1');
    await feed('');
    expect(getWindow.mock.calls).toEqual([[-1, 90], [-1, 90]]);
  });
});
