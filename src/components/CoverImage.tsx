import Image from 'next/image';
import type { SealKind } from '@/lib/events/going';
import type { PublicCover } from '@/lib/events/types';
import { GLYPHS } from '@/lib/covers/glyphs';
import { CATEGORIES, type Category, type Locale } from '@/lib/taxonomy';
import { GoingBadge } from './GoingBadge';

type Props = {
  cover: PublicCover | null;
  category: Category;
  hostName: string | null;
  alt: string;
  /** Rendered edge in px at this slot (drives `sizes` and the seal size). */
  size: number;
  seal?: SealKind | null;
  locale: Locale;
  sealSize?: 'sm' | 'md' | 'lg';
  priority?: boolean;
  className?: string;
};

/**
 * 1:1 cover with a fixed aspect box (no CLS). Without an image it renders the typographic
 * template (PRD §5b step 3): category colour field + big category glyph, no date, no seal.
 * The same tile is the error state, so a failed image never triggers a second request.
 */
export function CoverImage({ cover, category, hostName, alt, size, seal, locale, sealSize = 'md', priority, className }: Props) {
  return (
    <div className={`relative ${className ?? ''}`} style={{ width: size, maxWidth: '100%' }}>
      <div
        className="relative aspect-square w-full overflow-hidden rounded-cover"
        style={{ background: cover?.dominant ?? undefined }}
      >
        {cover && cover.kind !== 'template' ? (
          <Image
            src={size > 400 ? cover.url1600 : size > 200 ? cover.url800 : cover.url400}
            alt={alt}
            fill
            sizes={`${size}px`}
            priority={priority}
            className="object-cover"
          />
        ) : (
          <TemplateTile category={category} hostName={hostName} />
        )}
      </div>
      {seal && (
        <span className="seal-pos absolute -top-1.5 -left-1.5">
          <GoingBadge seal={seal} locale={locale} size={sealSize} />
        </span>
      )}
    </div>
  );
}

export function TemplateTile({ category, hostName }: { category: Category; hostName: string | null }) {
  const glyph = CATEGORIES[category].glyph;
  const outline = GLYPHS[glyph];
  return (
    <div className="cover-tile absolute inset-0" style={{ ['--c' as string]: `var(--color-cat-${category})` }} aria-hidden>
      <div className="cover-tile-block" />
      {outline ? (
        // CJK glyphs ship as outlines so the tile never waits for a font slice.
        <span className="cover-tile-glyph">
          <svg
            className="cover-tile-svg"
            viewBox={`${outline.box[0]} ${-outline.box[3]} ${outline.box[2] - outline.box[0]} ${outline.box[3] - outline.box[1]}`}
          >
            <path d={outline.d} transform="scale(1,-1)" fill="currentColor" />
          </svg>
        </span>
      ) : (
        <span className="cover-tile-glyph font-display">{glyph}</span>
      )}
      {hostName && <span className="cover-tile-host font-mono">{hostName}</span>}
    </div>
  );
}
