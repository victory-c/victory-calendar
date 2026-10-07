/* eslint-disable @next/next/no-img-element -- email markup rendered to a string, not a Next page */
import { type CSSProperties, Fragment, type ReactNode } from 'react';
import { Head, Html } from 'react-email';
import { licenseCodeOfUrl, licenseLabel } from '@/lib/covers/credit';
import { ALT_TITLE_MAX, chips, clip, dayLabel, NOTE_MAX, when, where } from '@/lib/digest/fields';
import { isDigestSeal, type VariantSelection } from '@/lib/digest/select';
import type { DigestEvent, DigestLinks, DigestSnapshot } from '@/lib/digest/types';
import { note, titles } from '@/lib/events/display';
import { fmtDayHeader } from '@/lib/format/date';
import { CATEGORIES, type Locale } from '@/lib/taxonomy';
import { COPY, htmlLang, other, sealAlt } from './copy';
import { C, categoryHex, DARK_CSS, FONT, OUTLOOK_DARK_CSS } from './tokens';

// The weekly digest (PRD §8, guide「digest 组装」「邮件」). Rules that shape this markup:
// - 600 px single column built from presentation tables only (no flex/grid/position), every style
//   inline in hex; the head <style> only adds dark mode. No web fonts, no SVG, no data: images.
// - font-family sits on every text <td>: classic Outlook doesn't inherit fonts into nested tables.
// - Gmail clips at 102 KB and render.ts refuses anything over 90 KB, so repeated rows use short
//   styles and plain elements (react-email's <Button>/<Text>/<Img> add MSO spans and default
//   longhands to every item: the 30-event worst case went from ~116 KB to well under the cap).
// - Every <img> has an absolute src, numeric width/height and a non-empty alt (Outlook blocks
//   images by default and shows the alt in the box). Seals carry a hidden text twin, because the
//   plain-text part skips images.
// - Covers sit in a cell marked data-skip-in-text, so the text part has no bare image URLs. Their
//   credit line does reach the text part, an Openverse credit's links as `label <url>`.
// - Per-reader links carry render.ts's placeholder token; it is swapped per recipient afterwards.
// - Colours that matter in dark mode carry a class (bg / fg / mut / btn / chip / note / rule), and
//   so does every element with an inline background (react-email's <Body> isn't used: it copies the
//   paper colour onto a class-less full-width td that stays light around the dark column).
// - Classic Outlook ignores max-width: an MSO-only 600 px ghost table holds the column (MSO_SWAPS).
// The going alert (going-alert.tsx) is built from the exported pieces below, so both emails follow
// these rules the same way; the exports change nothing in the digest's own markup.

type Snap = Pick<DigestSnapshot, 'origin' | 'isoWeek' | 'from' | 'showAttendance'>;

export type DigestEmailProps = {
  locale: Locale;
  snap: Snap;
  subject: string;
  preheader: string;
  /** Intro paragraphs in the email's language (may be empty). */
  intro: string[];
  selection: VariantSelection;
  links: DigestLinks;
  /** F19: one footer line naming the reader's facets (copy.ts facetNote); absent without facets. */
  facetNote?: string | null;
};

export type EmptyNoticeProps = Omit<DigestEmailProps, 'intro' | 'selection'>;

const hidden = { display: 'none', msoHide: 'all' } as CSSProperties;

export function styles(l: Locale) {
  const f = FONT[l];
  return {
    /** Every text cell: font, size, leading and colour (Outlook inherits none of them into tables). */
    td: { fontFamily: f.body, fontSize: '16px', lineHeight: f.lineHeight, color: C.ink } satisfies CSSProperties,
    p: { margin: `0 0 ${f.gap}` } satisfies CSSProperties,
    meta: { fontSize: '13px', color: C.muted } satisfies CSSProperties,
    title: { fontFamily: f.title, fontSize: '18px', fontWeight: 700, color: C.ink, textDecoration: 'none' } satisfies CSSProperties,
    h2: { padding: '0 0 0 10px', fontFamily: f.title, fontSize: '20px', lineHeight: 1.3, color: C.ink } satisfies CSSProperties,
    day: { margin: '14px 0 10px', padding: '0 0 4px', borderBottom: `1px solid ${C.rule}`, fontSize: '13px', fontWeight: 600, color: C.muted } satisfies CSSProperties,
    chip: { padding: '1px 7px', borderRadius: '9px', backgroundColor: C.chip, fontSize: '12px' } satisfies CSSProperties,
    note: { margin: '8px 0 0', paddingLeft: '10px', borderLeft: `2px solid ${C.seal}`, fontSize: '15px' } satisfies CSSProperties,
    btn: { display: 'inline-block', marginTop: '8px', padding: '7px 14px', borderRadius: '99px', backgroundColor: C.ink, color: C.paper, fontSize: '14px', textDecoration: 'none' } satisfies CSSProperties,
    small: { margin: '0 0 6px', fontSize: '12px', color: C.muted } satisfies CSSProperties,
    link: { color: C.muted } satisfies CSSProperties,
  };
}
type S = ReturnType<typeof styles>;

/** A presentation table of rows (Outlook ignores margins on tables, so spacing goes on cells). */
export function Table({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={style}>
      <tbody>{children}</tbody>
    </table>
  );
}

export const eventUrl = (origin: string, l: Locale, slug: string) => `${origin}${l === 'zh' ? '/zh' : ''}/events/${encodeURIComponent(slug)}`;
const sealUrl = (origin: string, l: Locale, seal: string) => `${origin}/og/seal/${seal}?l=${l}`;
/** Only tag text whose language differs from the email's. */
const langIf = (lang: string, l: Locale) => (lang === htmlLang(l) ? undefined : lang);

/** Only http(s) links leave the email; anything else falls back to our own page. */
const httpOr = (url: string, fallback: string) => (/^https?:\/\//i.test(url) ? url : fallback);

/**
 * The cover credit as stored. An Openverse credit (`"Title" by Creator · CC BY-SA 2.0 · cropped`)
 * links the work to its page and the licence to its deed, as the site does: CC BY / BY-SA 2.0 ask
 * for the licence URI with every copy. Covers without links (and snapshots frozen before them)
 * show the text alone.
 */
function CoverCredit({ e, s }: { e: DigestEvent; s: S }) {
  const credit = e.coverCredit ?? '';
  const page = e.coverSourceUrl && /^https?:\/\//i.test(e.coverSourceUrl) ? e.coverSourceUrl : null;
  // Only a creativecommons.org deed is linked (licenseCodeOfUrl parses nothing else).
  const label = licenseLabel(licenseCodeOfUrl(e.coverLicenseUrl));
  const deed = label ? e.coverLicenseUrl! : null;
  const a = (href: string, text: string) => (
    <a href={href} className="mut" style={s.link}>
      {text}
    </a>
  );
  const at = deed && label ? credit.lastIndexOf(` · ${label}`) : -1;
  if (deed && label && at > 0) {
    const work = credit.slice(0, at);
    return (
      <>
        {page ? <>{a(page, work)} · </> : `${work} · `}
        {a(deed, label)}
        {credit.slice(at + 3 + label.length)}
      </>
    );
  }
  // Not in the stored shape: the whole line to the page, then the deed.
  return (
    <>
      {page ? a(page, credit) : credit}
      {deed && label && <> · {a(deed, label)}</>}
    </>
  );
}

/** Hosted 96 px PNG shown at 48 px, one language per seal; the alt is styled for blocked images. */
function SealImg({ e, l, origin }: { e: DigestEvent; l: Locale; origin: string }) {
  if (!isDigestSeal(e.seal)) return null;
  return (
    <img
      src={sealUrl(origin, l, e.seal)}
      width={48}
      height={48}
      alt={sealAlt(e.seal, l)}
      style={{ display: 'block', border: 0, color: C.sealText, fontSize: '12px', fontWeight: 700 }}
    />
  );
}

/** "[会去] " for the plain-text part: images are skipped there, so the seal needs a text twin. */
function SealText({ e, l }: { e: DigestEvent; l: Locale }) {
  return isDigestSeal(e.seal) ? <span style={hidden}>{`${sealAlt(e.seal, l)} `}</span> : null;
}

type NoteLang = keyof typeof NOTE_MAX;

/** Victor's note (other language tagged), clipped to `max` characters, signed; nothing without one. */
export function NoteBlock({ e, l, s, max }: { e: DigestEvent; l: Locale; s: S; max: Record<NoteLang, number> }) {
  const n = note(e, l);
  if (!n) return null;
  return (
    <div className="note" style={s.note}>
      {langIf(n.lang, l) ? <span lang={n.lang}>{clip(n.text, max[n.lang])}</span> : clip(n.text, max[n.lang])}
      <br />
      <span className="mut" style={{ fontSize: '12px', color: C.muted }}>
        {COPY[l].signature}
      </span>
    </div>
  );
}

/** The RSVP button to the official page ("RSVP on Luma"); a link that isn't http(s) opens `fallback`. */
export function Rsvp({ e, l, s, fallback }: { e: DigestEvent; l: Locale; s: S; fallback: string }) {
  return (
    <a href={httpOr(e.sourceUrl, fallback)} className="btn" style={s.btn}>
      {e.platform ? COPY[l].rsvpAt(e.platform) : COPY[l].rsvp}
    </a>
  );
}

function Item({ e, l, s, snap }: { e: DigestEvent; l: Locale; s: S; snap: Snap }) {
  const t = titles(e, l);
  const c = chips(e, l);
  const href = eventUrl(snap.origin, l, e.slug);
  const seal = snap.showAttendance && isDigestSeal(e.seal) ? e : null;
  return (
    <tr>
      <td width={96} valign="top" data-skip-in-text="true" style={{ paddingBottom: '22px' }}>
        <img
          src={httpOr(e.coverUrl, `${snap.origin}/og/template/${e.category}?s=192`)}
          width={96}
          height={96}
          alt={CATEGORIES[e.category][l]}
          style={{ display: 'block', border: 0, borderRadius: '6px', fontSize: '12px', color: C.muted }}
        />
      </td>
      <td valign="top" colSpan={seal ? undefined : 2} className="fg" style={{ ...s.td, padding: '0 0 22px 14px' }}>
        {seal && <SealText e={seal} l={l} />}
        <a href={href} lang={langIf(t.primaryLang, l)} className="fg" style={s.title}>
          {t.primary}
        </a>
        {t.secondary && (
          <div lang={t.secondaryLang} className="mut" style={s.meta}>
            {clip(t.secondary, ALT_TITLE_MAX[t.secondaryLang])}
          </div>
        )}
        <div className="mut" style={s.meta}>
          {[when(e, l), ...where(e, l)].join(' · ')}
        </div>
        {c.length > 0 && (
          <div style={{ marginTop: '4px', lineHeight: 1.6 }}>
            {c.map((x, i) => (
              <Fragment key={i}>
                {/* Pills need only a space; the plain-text part reads "Free · Apply", not "Free Apply". */}
                {i > 0 && (
                  <>
                    <span style={hidden}>{' ·'}</span>{' '}
                  </>
                )}
                <span lang={x.lang} className="chip" style={s.chip}>
                  {x.text}
                </span>
              </Fragment>
            ))}
          </div>
        )}
        <NoteBlock e={e} l={l} s={s} max={NOTE_MAX} />
        <Rsvp e={e} l={l} s={s} fallback={href} />
        {e.coverCredit && (
          <div className="mut" style={{ marginTop: '6px', fontSize: '11px', color: C.muted }}>
            <CoverCredit e={e} s={s} />
          </div>
        )}
      </td>
      {seal && (
        <td width={48} valign="top" style={{ padding: '0 0 22px 8px' }}>
          <SealImg e={seal} l={l} origin={snap.origin} />
        </td>
      )}
    </tr>
  );
}

/**
 * Compact going row: seal, title, "打算去 · 10月14日周三" (the day, never an arrival time). The going
 * alert puts the note and the RSVP button under it (`children`) and spaces its rows wider (`gap`).
 */
export function GoingRow({ e, l, s, origin, children, gap = '14px' }: {
  e: DigestEvent;
  l: Locale;
  s: S;
  origin: string;
  children?: ReactNode;
  gap?: string;
}) {
  const t = titles(e, l);
  return (
    <tr>
      <td width={48} valign="top" style={{ paddingBottom: gap }}>
        <SealImg e={e} l={l} origin={origin} />
      </td>
      <td valign="middle" className="fg" style={{ ...s.td, padding: `0 0 ${gap} 12px` }}>
        <SealText e={e} l={l} />
        <a href={eventUrl(origin, l, e.slug)} lang={langIf(t.primaryLang, l)} className="fg" style={{ ...s.title, fontSize: '16px' }}>
          {t.primary}
        </a>
        <div className="mut" style={s.meta}>
          {[COPY[l].planToGo, dayLabel(new Date(e.startAt), l), ...where(e, l)].join(' · ')}
        </div>
        {children}
      </td>
    </tr>
  );
}

/** Next week, compact: title and when / where only (no day header here, so all-day rows carry the day). */
function PreviewRow({ e, l, s, origin }: { e: DigestEvent; l: Locale; s: S; origin: string }) {
  const t = titles(e, l);
  return (
    <p style={{ margin: '0 0 12px' }}>
      <a href={eventUrl(origin, l, e.slug)} lang={langIf(t.primaryLang, l)} className="fg" style={{ ...s.title, fontSize: '16px' }}>
        {t.primary}
      </a>
      <br />
      <span className="mut" style={s.meta}>
        {[when(e, l, true), ...where(e, l)].join(' · ')}
      </span>
    </p>
  );
}

/** Section heading with a 4 px rule: category colour, seal for "going", grey for the preview. */
function Heading({ children, s, color, gap = '4px' }: { children: ReactNode; s: S; color: string; gap?: string }) {
  return (
    <h2 className="fg" style={{ margin: `32px 0 ${gap}`, ...s.h2, borderLeft: `4px solid ${color}` }}>
      {children}
    </h2>
  );
}

/** A footer link label in the email's language, then the other one: "订阅设置 Preferences". */
export function bothLabels(l: Locale, pick: (c: (typeof COPY)[Locale]) => string) {
  return `${pick(COPY[l])} ${pick(COPY[other(l)])}`;
}

/** The digest's footer links: preferences, unsubscribe, the other language, the archive, privacy. */
function Footer({ l, s, links, note }: { l: Locale; s: S; links: DigestLinks; note?: string | null }) {
  const o = other(l);
  const items: [string, string][] = [
    [bothLabels(l, (c) => c.prefs), links.prefs],
    [bothLabels(l, (c) => c.unsubscribe), links.unsubscribe],
    [`${COPY[l].switchLang[l]} ${COPY[o].switchLang[l]}`, links.otherLanguage],
    [bothLabels(l, (c) => c.web), links.web],
    [bothLabels(l, (c) => c.privacy), links.privacy],
  ];
  return <FooterBlock l={l} s={s} items={items} note={note} />;
}

/**
 * Both languages, always (PRD §8 footer): sender, no paid placements, links. No mailing address.
 * An optional first line in the reader's language says why they get this email or what it leaves
 * out (the digest's F19 facet line). `items` are [label, href] pairs, hrefs unique.
 */
export function FooterBlock({ l, s, items, note }: { l: Locale; s: S; items: readonly (readonly [string, string])[]; note?: string | null }) {
  const o = other(l);
  return (
    <Table style={{ marginTop: '28px' }}>
      <tr>
        <td className="rule" style={{ ...s.td, paddingTop: '16px', borderTop: `1px solid ${C.rule}` }}>
          {note && (
            <p className="mut" style={{ ...s.small, marginBottom: '10px' }}>
              {note}
            </p>
          )}
          <p className="mut" style={s.small}>
            {`${COPY[l].sender} · ${COPY[l].noPaid}`}
          </p>
          <p lang={htmlLang(o)} className="mut" style={s.small}>
            {`${COPY[o].sender} · ${COPY[o].noPaid}`}
          </p>
          <p className="mut" style={{ ...s.small, marginTop: '10px' }}>
            {items.map(([label, href], i) => (
              <Fragment key={href}>
                {i > 0 && ' · '}
                <a href={href} className="mut" style={s.link}>
                  {label}
                </a>
              </Fragment>
            ))}
          </p>
        </td>
      </tr>
    </Table>
  );
}

/**
 * Inbox preview text. Hidden everywhere (mso-hide for Outlook), skipped in the plain-text part, and
 * padded with zero-width-non-joiner + no-break-space pairs so the inbox doesn't pull body text in
 * after it. react-email's <Preview> pads with ~3.8 KB of whitespace; ~0.5 KB does the same job.
 */
function Preheader({ text }: { text: string }) {
  const shown = [...text].slice(0, 150);
  return (
    <div
      data-skip-in-text="true"
      style={{ display: 'none', overflow: 'hidden', maxHeight: 0, maxWidth: 0, opacity: 0, fontSize: '1px', lineHeight: '1px', msoHide: 'all' } as CSSProperties}
    >
      {`${shown.join('')}${'‌ '.repeat(Math.max(0, 110 - shown.length))}`}
    </div>
  );
}

/**
 * React can't emit conditional comments, so the template renders markers that render.ts swaps for
 * Outlook-only markup before measuring bytes (each marker exactly once, or the render fails):
 * a 600 px ghost table around the column (the Word engine ignores max-width and would stretch it
 * across the reading pane), and the 96 DPI setting so images keep their size on scaled displays.
 * html-to-text drops comments, so the plain-text part is unchanged.
 */
export const MSO_SWAPS: readonly (readonly [marker: string, markup: string])[] = [
  [
    '<span data-vp-mso="open"></span>',
    '<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->',
  ],
  ['<span data-vp-mso="close"></span>', '<!--[if mso]></td></tr></table><![endif]-->'],
  [
    '</head>',
    '<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]--></head>',
  ],
];
const MsoMarker = ({ edge }: { edge: 'open' | 'close' }) => <span data-vp-mso={edge} />;
/** The `o:` prefix of the head block above. */
const OFFICE_NS = { 'xmlns:o': 'urn:schemas-microsoft-com:office:office' } as Record<string, string>;

function Shell({ locale: l, snap, subject, preheader, links, facetNote, children }: EmptyNoticeProps & { children: ReactNode }) {
  // The covered week's Monday at noon PT, always the right calendar day whatever the DST offset.
  const monday = fmtDayHeader(new Date(Date.parse(snap.from) + 12 * 3600_000), l).date;
  return (
    <EmailFrame
      locale={l}
      subject={subject}
      preheader={preheader}
      kicker={COPY[l].weekOf(monday)}
      footer={<Footer l={l} s={styles(l)} links={links} note={facetNote} />}
    >
      {children}
    </EmailFrame>
  );
}

/**
 * Every newsletter email's page: head (dark mode, Outlook), preheader, full-width paper, the 600 px
 * column (with its Outlook ghost table) holding the masthead "Victor 精选 · {kicker}", the body and
 * the footer.
 */
export function EmailFrame({ locale: l, subject, preheader, kicker, footer, children }: {
  locale: Locale;
  subject: string;
  preheader: string;
  /** The masthead's grey second half: the covered week, or what kind of email this is. */
  kicker: string;
  footer: ReactNode;
  children: ReactNode;
}) {
  const s = styles(l);
  const lang = htmlLang(l);
  return (
    <Html lang={lang} dir="ltr" {...OFFICE_NS}>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
        <title>{subject}</title>
        <style>{DARK_CSS}</style>
        <style>{OUTLOOK_DARK_CSS}</style>
      </Head>
      <body lang={lang} dir="ltr" className="bg" style={{ backgroundColor: C.paper, margin: 0, padding: 0 }}>
        <Preheader text={preheader} />
        {/* Full-width paper (some clients drop the body background), dark-mode class included. */}
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} bgcolor={C.paper} className="bg" style={{ backgroundColor: C.paper }}>
          <tbody>
            <tr>
              {/* No align on this td: it becomes an inherited text-align and would centre every line. */}
              <td className="bg">
                <MsoMarker edge="open" />
                <table
                  role="presentation"
                  align="center"
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  bgcolor={C.paper}
                  className="bg"
                  style={{ maxWidth: '600px', backgroundColor: C.paper }}
                >
                  <tbody>
                    <tr>
                      <td className="fg" style={{ ...s.td, padding: '24px 16px 32px' }}>
                        <p className="fg" style={{ margin: '0 0 20px', fontFamily: FONT[l].title, fontSize: '22px', lineHeight: 1.3, fontWeight: 700 }}>
                          {COPY[l].site}
                          <span className="mut" style={{ fontFamily: FONT[l].body, fontSize: '14px', fontWeight: 400, color: C.muted }}>
                            {` · ${kicker}`}
                          </span>
                        </p>
                        {children}
                        {footer}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <MsoMarker edge="close" />
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </Html>
  );
}

/** Intro → 我会去 / Victor is going → one section per picked category by day → 下周预告 → footer. */
export function DigestEmail(p: DigestEmailProps) {
  const l = p.locale;
  const s = styles(l);
  const { sections, going, preview } = p.selection;
  const origin = p.snap.origin;
  return (
    <Shell locale={l} snap={p.snap} subject={p.subject} preheader={p.preheader} links={p.links} facetNote={p.facetNote}>
      {p.intro.map((line, i) => (
        <p key={i} className="fg" style={s.p}>
          {line}
        </p>
      ))}
      {p.snap.showAttendance && going.length > 0 && (
        <>
          <Heading s={s} color={C.seal} gap="14px">
            {COPY[l].going}
          </Heading>
          <Table>
            {going.map((e) => (
              <GoingRow key={e.id} e={e} l={l} s={s} origin={origin} />
            ))}
          </Table>
        </>
      )}
      {sections.map((sec) => (
        <Fragment key={sec.category}>
          <Heading s={s} color={categoryHex(sec.category)}>
            {CATEGORIES[sec.category][l]}
          </Heading>
          {sec.days.map((d) => (
            <Fragment key={d.key}>
              <p className="mut rule" style={s.day}>
                {`${d.labels[l].date} ${d.labels[l].weekday}`}
              </p>
              <Table>
                {d.events.map((e) => (
                  <Item key={e.id} e={e} l={l} s={s} snap={p.snap} />
                ))}
              </Table>
            </Fragment>
          ))}
        </Fragment>
      ))}
      {preview.length > 0 && (
        <>
          <Heading s={s} color={C.rule} gap="14px">
            {COPY[l].preview}
          </Heading>
          {preview.map((e) => (
            <PreviewRow key={e.id} e={e} l={l} s={s} origin={origin} />
          ))}
        </>
      )}
    </Shell>
  );
}

/**
 * At most once a month per reader: nothing in their categories this week, and how to add some (or,
 * with F19 facets set, how to widen them).
 */
export function EmptyNoticeEmail(p: EmptyNoticeProps) {
  const l = p.locale;
  const s = styles(l);
  const m = p.facetNote ? COPY[l].emptyMoreFiltered : COPY[l].emptyMore;
  return (
    <Shell {...p}>
      <p className="fg" style={s.p}>
        {p.facetNote ? COPY[l].emptyBodyFiltered : COPY[l].emptyBody}
      </p>
      <p className="fg" style={s.p}>
        {m.before}
        <a href={p.links.prefs} className="fg" style={{ color: C.ink }}>
          {m.link}
        </a>
        {m.after}
      </p>
    </Shell>
  );
}
