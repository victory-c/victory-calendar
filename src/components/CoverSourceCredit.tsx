import type { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { openverseCreditParts, viaHost } from '@/lib/covers/credit';
import type { PublicCover } from '@/lib/events/types';

// Credit under a cover from the cover selector's sources (M4 F11; guide「版权」). Official covers
// keep their own "Cover: host via platform" line on the event page.
//   - Openverse: the work linked to its page, the licence linked to its deed, and any crop/padding;
//   - Brave find: "Image via host", linked to the page it was found on;
//   - AI: says it is AI-generated.

type EventT = Awaited<ReturnType<typeof getTranslations<'Event'>>>;

/** A t.rich tag that wraps its text in an outbound link. */
function ext(href: string, rel = 'noopener noreferrer') {
  return function ExternalLink(c: ReactNode) {
    return (
      <a href={href} rel={rel} target="_blank" className="underline underline-offset-2">
        {c}
      </a>
    );
  };
}

const plain = (c: ReactNode) => c;

export function CoverSourceCredit({ cover, t }: { cover: Pick<PublicCover, 'kind' | 'attribution' | 'license' | 'sourcePageUrl'>; t: EventT }) {
  const line = (children: ReactNode) => <p className="mt-2 text-xs text-muted">{children}</p>;
  if (cover.kind === 'ai') return line(t('coverAi'));
  if (cover.kind === 'brave') {
    const host = viaHost(cover.sourcePageUrl);
    return host && cover.sourcePageUrl ? line(t.rich('coverVia', { host, page: ext(cover.sourcePageUrl) })) : null;
  }
  if (cover.kind !== 'openverse') return null;
  const parts = openverseCreditParts(cover.attribution, cover.license);
  if (!parts) return cover.attribution ? line(cover.attribution) : null;
  return line(
    <>
      {t.rich('coverOpenverse', {
        work: parts.work,
        license: parts.licenseLabel,
        page: cover.sourcePageUrl ? ext(cover.sourcePageUrl) : plain,
        deed: parts.licenseHref ? ext(parts.licenseHref, 'license noopener noreferrer') : plain,
      })}
      {parts.edit && ` · ${t(parts.edit === 'cropped' ? 'coverCropped' : 'coverPadded')}`}
    </>,
  );
}
