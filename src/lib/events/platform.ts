/** Human platform name from a source URL, for "RSVP on Luma" and cover credits. */
export function platformName(url: string) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (/(^|\.)(luma\.com|lu\.ma)$/.test(h)) return 'Luma';
    if (/(^|\.)partiful\.com$/.test(h)) return 'Partiful';
    if (/(^|\.)eventbrite\./.test(h)) return 'Eventbrite';
    if (/(^|\.)meetup\.com$/.test(h)) return 'Meetup';
    return h.replace(/^www\./, '');
  } catch {
    return null;
  }
}
