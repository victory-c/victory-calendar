import type { DigestEvent } from '@/lib/digest/types';
import type { Locale } from '@/lib/taxonomy';
import { ALERT_COPY, other } from './copy';
import { bothLabels, EmailFrame, eventUrl, FooterBlock, GoingRow, NoteBlock, Rsvp, styles, Table } from './digest';

// F20 going alert (会去提醒): at most one a day, the events Victor marked as publicly going since the
// last one. Built from the digest's pieces (digest.tsx), so it follows the same email rules: tables
// only, inline hex styles, dark-mode classes, the Outlook ghost table (render.ts MSO_SWAPS), hosted
// seal images with a text twin, both languages in the footer. Each row is the digest's going row
// ("打算去 · 10月14日周三 · SoMa": the day, never a clock time) plus the note and the RSVP button.
// Per-reader links carry the placeholder token; lib/alerts/render.ts swaps it per recipient.

/** About two lines in the 600 px column (the digest allows about three): the rest is on the event page. */
export const ALERT_NOTE_MAX = { en: 120, 'zh-Hans': 54 } as const;

export type AlertLinks = {
  /** The manual page that turns going alerts off: /unsubscribe?t=…&list=going. */
  offAlerts: string;
  prefs: string;
  /** Unsubscribe from everything: /unsubscribe?t=…. */
  unsubscribe: string;
  privacy: string;
};

export type GoingAlertProps = {
  locale: Locale;
  origin: string;
  subject: string;
  preheader: string;
  /** In display order, every one with a public seal (lib/alerts/render.ts checks both). */
  events: DigestEvent[];
  links: AlertLinks;
};

export function GoingAlertEmail({ locale: l, origin, subject, preheader, events, links }: GoingAlertProps) {
  const s = styles(l);
  const a = ALERT_COPY[l];
  const o = ALERT_COPY[other(l)];
  const items = [
    [`${a.offAlerts} ${o.offAlerts}`, links.offAlerts],
    [bothLabels(l, (c) => c.prefs), links.prefs],
    [`${a.unsubscribeAll} ${o.unsubscribeAll}`, links.unsubscribe],
    [bothLabels(l, (c) => c.privacy), links.privacy],
  ] as const;
  return (
    <EmailFrame locale={l} subject={subject} preheader={preheader} kicker={a.kicker} footer={<FooterBlock l={l} s={s} items={items} note={a.why} />}>
      <p className="fg" style={{ margin: '0 0 20px' }}>
        {events.length === 1 ? a.introOne : a.introMany}
      </p>
      <Table>
        {events.map((e) => (
          <GoingRow key={e.id} e={e} l={l} s={s} origin={origin} gap="24px">
            <NoteBlock e={e} l={l} s={s} max={ALERT_NOTE_MAX} />
            <Rsvp e={e} l={l} s={s} fallback={eventUrl(origin, l, e.slug)} />
          </GoingRow>
        ))}
      </Table>
    </EmailFrame>
  );
}
