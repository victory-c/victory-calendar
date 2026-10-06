import type { DigestSeal } from '@/lib/digest/types';
import { type EvLang, type Facets, hasFacets } from '@/lib/events/facets';
import { GOING_LABELS, type Locale } from '@/lib/taxonomy';

// Every string the weekly digest prints, in both languages (W14 copy table). Strings that already
// exist on the site (messages/*.json, taxonomy.ts) are copied verbatim so email and site agree;
// the email tree takes no next-intl dependency. No emoji, never "You're invited" (guide「邮件」).

type Copy = {
  site: string;
  /** Masthead: the covered week, from its Monday ("Oct 12" / "10月12日"). */
  weekOf: (monday: string) => string;
  going: string;
  /** The going list gives the day only, never an arrival time (guide「Going 状态安全规则」). */
  planToGo: string;
  preview: string;
  subject: (picks: number, going: number) => string;
  emptySubject: string;
  emptyBody: string;
  /** "You can add categories in your <preferences>." split around the link. */
  emptyMore: { before: string; link: string; after: string };
  /** F19: the empty notice for a reader with facets set (their filters can be what left it empty). */
  emptyBodyFiltered: string;
  emptyMoreFiltered: { before: string; link: string; after: string };
  /** F19 facet names, as the prefs page puts them (zh / en include bilingual events). */
  facets: Record<EvLang, string> & { online: string };
  /**
   * Both facets set: one phrase, because they combine with AND ("online Chinese or bilingual
   * events"), never a list that could read as "online events, and Chinese events".
   */
  onlineOf: (events: string) => string;
  /** One footer line when facets are set; `facets` is the phrase facetNote() builds. */
  facetNote: (facets: string) => string;
  defaultPreheader: string;
  signature: string;
  free: string;
  access: { apply: string; waitlist: string; sold_out: string };
  rsvp: string;
  rsvpAt: (platform: string) => string;
  online: string;
  hybrid: string;
  allDay: string;
  /** Footer, printed in both languages in every email. */
  sender: string;
  noPaid: string;
  prefs: string;
  unsubscribe: string;
  web: string;
  privacy: string;
  /** Label for the "other language" link of an email in `key` language, written in this language. */
  switchLang: Record<Locale, string>;
};

export const COPY: Record<Locale, Copy> = {
  zh: {
    site: 'Victor 精选',
    weekOf: (monday) => `${monday} 这一周`,
    going: '我会去',
    planToGo: '打算去',
    preview: '下周预告',
    subject: (n, g) => (g > 0 ? `本周 ${n} 场精选 · Victor 会去 ${g} 场` : `本周 ${n} 场精选`),
    emptySubject: '本周没有想推荐的',
    emptyBody: '这周你选的类别里没有我想推荐的活动。',
    emptyMore: { before: '可以在', link: '订阅设置', after: '里多选几类。' },
    emptyBodyFiltered: '这周你选的类别和筛选条件里没有我想推荐的活动。',
    emptyMoreFiltered: { before: '可以在', link: '订阅设置', after: '里多选几类，或者放宽筛选。' },
    facets: { zh: '中文或双语活动', en: '英文或双语活动', bilingual: '双语活动', online: '线上活动（含线上线下同步）' },
    onlineOf: (events) => `线上（含线上线下同步）的${events}`,
    facetNote: (f) => `只收：${f}。可以在订阅设置里修改。`,
    defaultPreheader: '这周值得去的湾区 tech 活动。',
    signature: '— Victor',
    free: '免费',
    access: { apply: '需申请', waitlist: '候补', sold_out: '已售罄' },
    rsvp: '报名',
    rsvpAt: (p) => `去 ${p} 报名`,
    online: '线上',
    hybrid: '线上线下',
    allDay: '全天',
    sender: 'Victor 精选 · Victor 亲自挑选的湾区 tech 活动',
    noPaid: '无付费植入。',
    prefs: '订阅设置',
    unsubscribe: '退订',
    web: '网页版',
    privacy: '隐私',
    switchLang: { zh: '改收英文版', en: '改收中文版' },
  },
  en: {
    site: "Victor's Picks",
    weekOf: (monday) => `Week of ${monday}`,
    going: 'Victor is going',
    planToGo: 'I plan to go',
    preview: 'Next week',
    subject: (n, g) => {
      const picks = `${n} ${n === 1 ? 'pick' : 'picks'} this week`;
      return g > 0 ? `${picks} · Victor is going to ${g}` : picks;
    },
    emptySubject: "Nothing I'd recommend this week",
    emptyBody: "Nothing in your categories this week that I'd recommend.",
    emptyMore: { before: 'You can add categories in your ', link: 'preferences', after: '.' },
    emptyBodyFiltered: "Nothing in your categories and filters this week that I'd recommend.",
    emptyMoreFiltered: { before: 'You can add categories or widen your filters in your ', link: 'preferences', after: '.' },
    facets: { zh: 'Chinese or bilingual events', en: 'English or bilingual events', bilingual: 'bilingual events', online: 'online events (incl. hybrid)' },
    onlineOf: (events) => `online (incl. hybrid) ${events}`,
    facetNote: (f) => `Only ${f}. You can change this in your preferences.`,
    defaultPreheader: 'Bay Area tech events worth going to this week.',
    signature: '— Victor',
    free: 'Free',
    access: { apply: 'Apply', waitlist: 'Waitlist', sold_out: 'Sold out' },
    rsvp: 'RSVP',
    rsvpAt: (p) => `RSVP on ${p}`,
    online: 'Online',
    hybrid: 'Hybrid',
    allDay: 'All day',
    sender: "Victor's Picks · Bay Area tech events, picked by Victor",
    noPaid: 'No paid placements.',
    prefs: 'Preferences',
    unsubscribe: 'Unsubscribe',
    web: 'View in browser',
    privacy: 'Privacy',
    switchLang: { zh: 'Switch to English', en: 'Switch to Chinese' },
  },
};

/** Seal alt text, one language only: [会去] / [GOING], [主办] / [HOST], [分享] / [TALK]. */
export const sealAlt = (seal: DigestSeal, locale: Locale) => `[${GOING_LABELS[seal][locale]}]`;

/** The footer's facet line for a variant, or null without facets (the email is then exactly as before F19). */
export function facetNote(l: Locale, f: Facets): string | null {
  if (!hasFacets(f)) return null;
  const c = COPY[l];
  const phrase = !f.evLang ? c.facets.online : f.onlineOnly ? c.onlineOf(c.facets[f.evLang]) : c.facets[f.evLang];
  return c.facetNote(phrase);
}

export const other = (l: Locale): Locale => (l === 'zh' ? 'en' : 'zh');
export const htmlLang = (l: Locale) => (l === 'zh' ? 'zh-Hans' : 'en');
