import type { SealKind } from '@/lib/events/going';
import { GOING_LABELS, type Locale } from '@/lib/taxonomy';

const SIZES = { sm: 40, md: 56, lg: 80 } as const;

/**
 * Square vermilion seal, paper-coloured engraving, one language only (never zh + en on the
 * same seal). zh: two characters stacked like a name seal, 70% of the face. en: Geist Mono 700.
 */
export function GoingBadge({ seal, locale, size = 'md' }: { seal: SealKind; locale: Locale; size?: keyof typeof SIZES }) {
  const px = SIZES[size];
  const label = GOING_LABELS[seal][locale];
  const zh = locale === 'zh';
  // en: fit n mono glyphs (≈0.6em each, 0.08em tracking) into 70% of the face.
  const enSize = (0.7 * px) / (label.length * 0.6 + (label.length - 1) * 0.08);
  return (
    <span
      role="img"
      aria-label={label}
      className="seal grid place-items-center bg-seal text-paper"
      style={{ width: px, height: px, borderRadius: Math.max(3, px * 0.06) }}
    >
      {zh ? (
        <span
          aria-hidden
          className="font-display font-semibold"
          style={{ writingMode: 'vertical-rl', fontSize: px * 0.35, lineHeight: 1, letterSpacing: 0 }}
        >
          {label}
        </span>
      ) : (
        <span aria-hidden className="font-mono font-bold uppercase" style={{ fontSize: enSize, letterSpacing: '0.08em', lineHeight: 1 }}>
          {label}
        </span>
      )}
    </span>
  );
}
