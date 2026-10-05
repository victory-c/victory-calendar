import type { Category, Locale } from '../taxonomy';

// The digest's shared contract. assemble.ts builds a DigestSnapshot from the database; it is
// frozen into digest_issues.snapshot when the issue starts sending; render.ts turns a snapshot plus
// a variant into the email; the admin editor previews the same thing. Everything in a snapshot is
// already public-safe (events_public + redactForPublic) and JSON-serialisable (dates as ISO).

export type DigestSeal = 'going' | 'hosting' | 'speaking';

export type DigestEvent = {
  id: string;
  slug: string;
  category: Category;
  startAt: string;
  endAt: string | null;
  tz: string;
  allDay: boolean;
  format: 'in_person' | 'online' | 'hybrid';
  titleEn: string;
  titleZh: string;
  noteEn: string | null;
  noteZh: string | null;
  /** Neighbourhood or city (display.ts place()); null for online-only. Never a street address. */
  place: string | null;
  priceText: string | null;
  access: 'open' | 'apply' | 'waitlist' | 'sold_out' | 'unknown';
  /** RSVP target: the official event page. */
  sourceUrl: string;
  /** "Luma", "Partiful", … for the RSVP label; null when unknown. */
  platform: string | null;
  /** Absolute https URL of a PNG/JPEG square, email-safe (96 px slot, 192 px image). */
  coverUrl: string;
  /** "Cover: Host via Luma" when an official cover is used; null for templates. */
  coverCredit: string | null;
  /** Public seal for the going section, already filtered by publicGoing() and the kill switch. */
  seal: DigestSeal | null;
  featured: boolean;
};

export type DigestSnapshot = {
  version: 1;
  issueId: string;
  isoWeek: string;
  /** Covered week [from, to) and the preview week, ISO instants. */
  from: string;
  to: string;
  previewWeek: string;
  sendAfter: string;
  /** Site origin at freeze time; every link in the email starts with it. */
  origin: string;
  introEn: string | null;
  introZh: string | null;
  /** settings.show_attendance at assembly; false = no going section, no seals, no going count. */
  showAttendance: boolean;
  /** Published (not cancelled) events starting in the covered week, by start time. */
  events: DigestEvent[];
  /** Featured events in the following week (digest_issues.featured_ids), by start time. */
  preview: DigestEvent[];
};

/** Links one rendered email needs; render.ts fills them with the placeholder token. */
export type DigestLinks = {
  prefs: string;
  unsubscribe: string;
  /** The same preferences page in the other language ("switch language"). */
  otherLanguage: string;
  /** "View in browser": the issue's archive (/weekly/yyyy-Www), or /week/yyyy-Www when the snapshot has no events. */
  web: string;
  /** /privacy in the email's language. */
  privacy: string;
};

export type RenderedEmail = {
  subject: string;
  /** Preheader shown after the subject in inboxes. */
  preheader: string;
  html: string;
  text: string;
  bytes: number;
  /** Counts the subject states, for the editor and jobs_log. */
  picks: number;
  going: number;
};

export type { Category, Locale };
