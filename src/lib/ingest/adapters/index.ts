import type { Platform, PlatformRef } from '../normalize';
import { genericFacts } from './generic';
import { lumaFacts } from './luma';
import { looksPrivate, parsePage } from './page';
import { partifulFacts } from './partiful';
import type { PageFacts } from './types';

export type { PageFacts } from './types';

export function platformOf(url: URL): Platform {
  const h = url.hostname;
  if (h === 'luma.com' || h === 'lu.ma') return 'luma';
  if (h === 'partiful.com') return 'partiful';
  if (/(^|\.)eventbrite\.[a-z.]+$/.test(h)) return 'eventbrite';
  if (h === 'meetup.com') return 'meetup';
  return 'other';
}

/** Page HTML → deterministic facts. `url` is the final URL after redirects. */
export function readFacts(html: string, url: URL, ref: PlatformRef | null): PageFacts {
  const page = parsePage(html);
  const platform = platformOf(url);
  const facts =
    platform === 'luma' ? lumaFacts(page, ref) : platform === 'partiful' ? partifulFacts(page, ref) : genericFacts(page, platform, ref);
  return { ...facts, privateVenue: facts.addressHidden || looksPrivate(facts.venueName, facts.address) };
}
