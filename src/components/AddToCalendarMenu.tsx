import { getTranslations } from 'next-intl/server';
import { googleEvent, outlookEvent, targetOrder } from '@/lib/calendar-links';
import { note, titles } from '@/lib/events/display';
import type { PublicEvent } from '@/lib/events/types';
import { eventUrl } from '@/lib/ics';
import type { Locale } from '@/lib/taxonomy';

/** <details> menu: zero JS, keyboard accessible. zh order puts Google last. */
export async function AddToCalendarMenu({ event: e, locale }: { event: PublicEvent; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'Event' });
  const { primary } = titles(e, locale);
  const end = e.endAt ?? new Date(e.startAt.getTime() + 2 * 3600_000);
  const details = [note(e, locale)?.text, `RSVP: ${e.sourceUrl}`, eventUrl(e, locale)].filter(Boolean).join('\n\n');
  const location = [e.venueName, e.format === 'online' ? null : e.city].filter(Boolean).join(', ');
  const single = { title: primary, start: e.startAt, end, details, location, tz: e.tz };
  const ics = `/events/${e.slug}.ics${locale === 'zh' ? '?lang=zh' : ''}`;
  const links = {
    apple: { href: ics, label: t('apple') },
    google: { href: googleEvent(single), label: t('google') },
    outlook: { href: outlookEvent(single), label: t('outlook') },
  } as const;
  const order = targetOrder(locale).filter((k): k is keyof typeof links => k in links);
  return (
    <details className="group relative">
      <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-rule px-5 text-sm [&::-webkit-details-marker]:hidden">
        {t('addToCalendar')}
        <span aria-hidden className="text-muted transition-transform group-open:rotate-180">▾</span>
      </summary>
      <ul className="absolute left-0 z-20 mt-2 min-w-56 rounded-card border border-rule bg-paper p-1.5 shadow-lg">
        {order.map((k) => (
          <li key={k}>
            <a
              href={links[k].href}
              {...(k === 'apple' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
              className="flex h-11 items-center rounded-lg px-3 text-sm hover:bg-rule/50"
            >
              {links[k].label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
