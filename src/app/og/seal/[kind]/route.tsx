import { ImageResponse } from 'next/og';
import { ogFonts } from '@/lib/og/fonts';
import { GOING_LABELS } from '@/lib/taxonomy';
import { light, toHex } from '@/lib/tokens';

// The "Victor 会去" seal as a hosted PNG for the weekly digest: /og/seal/going?l=zh. Email clients
// can't draw the site's CSS seal (no fonts, no transforms in Outlook), so the digest shows this
// 96×96 image at 48 px. One language per seal, never both (PRD §9b): zh stacks two characters like
// a name seal, en sets GOING / HOST / TALK in Geist Mono. Transparent around the seal, with a
// paper ring as on the site, so it sits on light and dark backgrounds alike. Deterministic from
// its URL, so cached for a year — unless the label's font couldn't be fetched, in which case the
// fallback rendering is only cached briefly and the next request tries again.

const SIZE = 96;
const FACE = 80; // the seal itself; the rest is the paper ring and room for the -3° turn
const KINDS = ['going', 'hosting', 'speaking'] as const;
type Kind = (typeof KINDS)[number];
const isKind = (k: string): k is Kind => (KINDS as readonly string[]).includes(k);

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isKind(kind)) return new Response('not found', { status: 404 });
  const zh = new URL(req.url).searchParams.get('l') === 'zh';
  const label = GOING_LABELS[kind][zh ? 'zh' : 'en'];
  const fonts = await ogFonts(zh ? { display: label } : { mono: label });
  const wanted = zh ? 'Noto Serif SC' : 'Geist Mono';
  const complete = fonts.some((f) => f.name === wanted);
  const seal = toHex(light.seal);
  const paper = toHex(light.paper);
  // en: fit n mono glyphs (≈0.6 em each, 0.08 em tracking) into 70% of the face (GoingBadge.tsx).
  const enSize = (0.7 * FACE) / (label.length * 0.6 + (label.length - 1) * 0.08);
  return new ImageResponse(
    (
      <div style={{ width: SIZE, height: SIZE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: FACE + 6, height: FACE + 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: paper, borderRadius: 7, transform: 'rotate(-3deg)',
          }}
        >
          <div
            style={{
              width: FACE, height: FACE, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: seal, color: paper, borderRadius: 5,
            }}
          >
            {zh ? (
              [...label].map((ch, i) => (
                <div key={i} style={{ display: 'flex', fontFamily: 'Noto Serif SC', fontWeight: 600, fontSize: FACE * 0.35, lineHeight: 1 }}>
                  {ch}
                </div>
              ))
            ) : (
              <div style={{ display: 'flex', fontFamily: 'Geist Mono', fontWeight: 500, fontSize: enSize, letterSpacing: enSize * 0.08, lineHeight: 1 }}>
                {label}
              </div>
            )}
          </div>
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
      // An empty list would leave Satori with no font at all; undefined uses next/og's bundled one.
      fonts: fonts.length ? fonts : undefined,
      headers: { 'cache-control': complete ? 'public, max-age=31536000, immutable' : 'public, max-age=300' },
    },
  );
}
