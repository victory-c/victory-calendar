import { fmtRange } from './format/date';
import { note, titles } from './events/display';
import type { PublicEvent } from './events/types';
import { eventUrl } from './ics';
import type { Locale } from './taxonomy';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function buildRss({ events, locale, origin, now }: { events: PublicEvent[]; locale: Locale; origin: string; now: Date }) {
  const zh = locale === 'zh';
  const title = zh ? 'Victor 精选' : "Victor's Picks";
  const self = `${origin}${zh ? '/zh' : ''}/feed.xml`;
  const items = events
    .map((e) => {
      const { primary } = titles(e, locale);
      const n = note(e, locale);
      const when = fmtRange(e.startAt, e.endAt, locale);
      const prefix = e.status === 'cancelled' ? (zh ? '[已取消] ' : '[Cancelled] ') : '';
      const body = [when, n?.text, `RSVP: ${e.sourceUrl}`].filter(Boolean).join('\n');
      return `<item>
<title>${esc(prefix + primary)}</title>
<link>${esc(eventUrl(e, locale))}</link>
<guid isPermaLink="false">${esc(`${e.id}:${e.sequence}`)}</guid>
<pubDate>${(e.publishedAt ?? e.startAt).toUTCString()}</pubDate>
<category>${esc(e.category)}</category>
<description>${esc(body)}</description>
</item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(title)}</title>
<link>${esc(`${origin}${zh ? '/zh' : '/'}`)}</link>
<atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
<description>${esc(zh ? '一个双语湾区 tech 活动日历。' : 'A bilingual Bay Area tech events calendar.')}</description>
<language>${zh ? 'zh-Hans' : 'en'}</language>
<lastBuildDate>${now.toUTCString()}</lastBuildDate>
<ttl>60</ttl>
${items}
</channel>
</rss>
`;
}

