import type { Category } from '../taxonomy';

export type GoingStatus = 'none' | 'interested' | 'going' | 'hosting' | 'speaking';
export type GoingVisibility = 'public' | 'after_event' | 'hidden';

export type PublicCover = {
  kind: 'official' | 'host_composite' | 'template' | 'openverse' | 'ai' | 'brave' | 'upload' | 'url';
  url400: string;
  url800: string;
  url1600: string;
  thumbhash: string;
  dominant: string;
  letterboxed: boolean;
  attribution: string | null;
  license: string | null;
  sourcePageUrl: string | null;
};

/** Read model for public pages: only what events_public exposes, plus the cover. */
export type PublicEvent = {
  id: string;
  slug: string;
  status: 'published' | 'cancelled';
  titleEn: string;
  titleZh: string;
  summaryEn: string | null;
  summaryZh: string | null;
  noteEn: string | null;
  noteZh: string | null;
  category: Category;
  tags: string[];
  eventLanguage: 'en' | 'zh' | 'bilingual';
  startAt: Date;
  endAt: Date | null;
  tz: string;
  allDay: boolean;
  format: 'in_person' | 'online' | 'hybrid';
  venueName: string | null;
  city: string | null;
  neighborhood: string | null;
  region: 'sf' | 'east_bay' | 'peninsula' | 'south_bay' | 'north_bay' | 'online' | null;
  address: string | null;
  privateVenue: boolean;
  priceText: string | null;
  access: 'open' | 'apply' | 'waitlist' | 'sold_out' | 'unknown';
  hostName: string | null;
  hostUrl: string | null;
  sourceUrl: string;
  going: GoingStatus;
  goingVisibility: GoingVisibility;
  featured: boolean;
  sequence: number;
  cover: PublicCover | null;
  /** True for fixture rows shown before a database exists. */
  sample?: boolean;
};
