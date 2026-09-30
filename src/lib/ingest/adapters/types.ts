import type { ACCESS, FORMATS } from '../../db/schema';
import type { Platform, PlatformRef } from '../normalize';

/**
 * Facts read deterministically from an event page. The model never overrides these;
 * it only fills translations, the summary and the category (guide: 页面没有日期就留空，不编造).
 */
export type PageFacts = {
  platform: Platform;
  /** Every id this page is known by (Luma: URL slug and evt- id). All go into event_sources. */
  refs: PlatformRef[];
  /** `not_event`: a calendar/profile page; `private`: password or invite-only, nothing readable. */
  kind: 'event' | 'not_event' | 'private';
  title: string | null;
  /** Plain text, capped. Model context only: host copy is never stored (guide「版权处理」). */
  description: string | null;
  startAt: Date | null;
  endAt: Date | null;
  /** IANA zone from the page, or null when the page only gives UTC/offset times. */
  tz: string | null;
  format: (typeof FORMATS)[number] | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  neighborhood: string | null;
  /** The platform hides the address until you register (Luma guests-only, Partiful approximate). */
  addressHidden: boolean;
  hostName: string | null;
  hostUrl: string | null;
  /** Cover chain step 2 inputs: host and calendar avatars, category art. */
  hostImages: string[];
  /** Cover chain step 1: the official square cover, already rewritten to its largest useful size. */
  coverUrl: string | null;
  priceText: string | null;
  access: (typeof ACCESS)[number] | null;
  cancelled: boolean;
  /** Guide rule: street-only address, Apt/Unit/#, or an address hidden until you register. */
  privateVenue: boolean;
  /** Platform's own category slugs (Luma `cat-ai` → `ai`), a hint for the model. */
  platformCategories: string[];
};

export const emptyFacts = (platform: Platform, refs: PlatformRef[] = []): PageFacts => ({
  platform, refs, kind: 'event', title: null, description: null, startAt: null, endAt: null, tz: null,
  format: null, venueName: null, address: null, city: null, neighborhood: null, addressHidden: false,
  hostName: null, hostUrl: null, hostImages: [], coverUrl: null, priceText: null, access: null,
  cancelled: false, privateVenue: false, platformCategories: [],
});
