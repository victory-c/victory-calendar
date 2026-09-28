import type { PublicEvent } from './types';

/**
 * Last line of defence before anything public (pages, ICS, RSS, JSON-LD, calendar links):
 * guide「Going 状态安全规则」— cycling group rides and start points are never published, so a
 * cycling event exposes its city only.
 */
export function redactForPublic(e: PublicEvent): PublicEvent {
  if (e.category !== 'cycling') return e;
  return { ...e, venueName: null, address: null, neighborhood: null };
}
