import { GLYPHS } from '../covers/glyphs';
import { CATEGORIES, type Category, type Locale } from '../taxonomy';
import { categoryLight, light, type Oklch, toHex } from '../tokens';

// Satori markup for generated images. The template mirrors the CSS tile in CoverImage
// (globals.css .cover-tile*) so a card looks the same in the list, in OG cards and in email.

const mix = (a: Oklch, b: Oklch, t: number): Oklch => [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2]];

export const palette = (category: Category) => ({
  solid: toHex(categoryLight[category]),
  field: toHex(mix(categoryLight[category], light.paper, 0.14)),
  paper: toHex(light.paper),
  ink: toHex(light.ink),
  muted: toHex(light.muted),
  rule: toHex(light.rule),
  seal: toHex(light.seal),
});

/**
 * Cover chain step 3 (and step 2 with `avatars`): category colour field, a solid block from 18%,
 * the category glyph at ~44% of the edge, host name along the bottom. No date, no seal.
 * `avatars` are data URLs (fetched through safe-fetch by the caller, never by Satori).
 */
export function TemplateCard({ category, hostName, size, avatars = [] }: { category: Category; hostName: string | null; size: number; avatars?: string[] }) {
  const c = palette(category);
  const glyph = CATEGORIES[category].glyph;
  const outline = GLYPHS[glyph];
  const u = size / 100;
  const shown = avatars.slice(0, 3);
  // With host photos (cover chain step 2) the glyph shrinks into the upper half of the block and
  // the photos sit below it, so neither covers the other.
  const g = shown.length ? { size: 26, bottom: 44 } : { size: 44, bottom: 8 };
  return (
    <div style={{ width: size, height: size, display: 'flex', position: 'relative', background: c.field }}>
      <div style={{ position: 'absolute', left: 18 * u, top: 18 * u, right: 0, bottom: 0, background: c.solid, borderTopLeftRadius: 10 * u }} />
      <div
        style={{
          position: 'absolute', left: 18 * u, top: 18 * u, right: 0, bottom: g.bottom * u,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.paper,
        }}
      >
        {outline ? (
          <svg
            width={g.size * u}
            height={g.size * u}
            viewBox={`${outline.box[0]} ${-outline.box[3]} ${outline.box[2] - outline.box[0]} ${outline.box[3] - outline.box[1]}`}
          >
            <path d={outline.d} transform="scale(1,-1)" fill={c.paper} />
          </svg>
        ) : (
          <div style={{ fontFamily: 'Fraunces', fontWeight: 600, fontSize: (g.size + 2) * u, lineHeight: 1, letterSpacing: -1 * u }}>{glyph}</div>
        )}
      </div>
      {shown.length > 0 && (
        <div style={{ position: 'absolute', left: 18 * u, right: 0, bottom: 14 * u, display: 'flex', justifyContent: 'center' }}>
          {shown.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- Satori markup, not a page
            <img
              key={i}
              src={src}
              width={26 * u}
              height={26 * u}
              alt=""
              style={{ borderRadius: 13 * u, border: `${1 * u}px solid ${c.paper}`, marginLeft: i ? -6 * u : 0, objectFit: 'cover' }}
            />
          ))}
        </div>
      )}
      {hostName && (
        <div
          style={{
            position: 'absolute', left: 24 * u, right: 6 * u, bottom: 4.5 * u, display: 'flex',
            fontFamily: 'Geist Mono, Noto Serif SC', fontSize: 4.5 * u, lineHeight: 1.2, color: c.paper,
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}
        >
          {hostName}
        </div>
      )}
    </div>
  );
}

const SITE = { en: "Victor's Picks", zh: 'Victor 精选' } as const;

/**
 * 1200×630 share card: 630² cover on the left (official image or the template), paper panel on
 * the right with the title (max 3 lines), a Geist Mono date line, and the wordmark with its seal.
 */
export function OgCard({
  locale, title, dateLine, category, hostName, coverSrc, cancelled,
}: {
  locale: Locale; title: string; dateLine: string; category: Category; hostName: string | null;
  coverSrc: string | null; cancelled: boolean;
}) {
  const c = palette(category);
  const zh = locale === 'zh';
  const long = title.length > (zh ? 22 : 48);
  return (
    <div style={{ width: 1200, height: 630, display: 'flex', background: c.paper }}>
      <div style={{ width: 630, height: 630, display: 'flex', position: 'relative', background: c.field }}>
        {coverSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori markup, not a page
          <img src={coverSrc} width={630} height={630} alt="" style={{ objectFit: 'cover' }} />
        ) : (
          <TemplateCard category={category} hostName={hostName} size={630} />
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '56px 52px 44px 52px', borderLeft: `2px solid ${c.rule}` }}>
        <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontSize: 22, color: c.solid, letterSpacing: 1, textTransform: 'uppercase' }}>
          {cancelled ? (zh ? '已取消' : 'Cancelled') : zh ? CATEGORIES[category].zh : CATEGORIES[category].en}
        </div>
        <div
          style={{
            display: 'flex', marginTop: 20, fontFamily: 'Fraunces, Noto Serif SC', fontWeight: 600,
            fontSize: long ? 44 : 54, lineHeight: 1.18, color: c.ink, lineClamp: 3, overflow: 'hidden',
            textDecoration: cancelled ? 'line-through' : 'none',
          }}
        >
          {title}
        </div>
        <div style={{ display: 'flex', marginTop: 24, fontFamily: 'Geist Mono, Noto Serif SC', fontSize: zh ? 22 : 24, color: c.muted }}>{dateLine}</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 34, height: 34, borderRadius: 5, background: c.seal, color: c.paper, display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontFamily: 'Geist Mono', fontSize: 22, transform: 'rotate(-3deg)',
            }}
          >
            V
          </div>
          <div style={{ marginLeft: 14, fontFamily: 'Fraunces, Noto Serif SC', fontWeight: 600, fontSize: 28, color: c.ink }}>{SITE[locale]}</div>
        </div>
      </div>
    </div>
  );
}
