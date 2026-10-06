import 'server-only';
import { ImageResponse } from 'next/og';
import type { CSSProperties, ReactNode } from 'react';
import sharp from 'sharp';
import { coverImages } from '../digest/social-covers';
import {
  type ExportItem,
  type ExportModel,
  imageModel,
  itemsOf,
  LONG,
  LONG_TEXT_W,
  type LongBlock,
  type LongPart,
  XHS,
  XHS_SLOT,
  XHS_TEXT_W,
  xhsItemLines,
  type XhsPage,
} from '../digest/social';
import type { DigestSeal } from '../digest/types';
import { CATEGORIES, type Category, GOING_LABELS } from '../taxonomy';
import { light, toHex } from '../tokens';
import { palette, TemplateCard } from './cards';
import { type TextFonts, textFonts } from './fonts';

// Satori markup for the F17 images (decisions L1–L5): the WeChat long image (1080 wide, parts of
// at most 9,000 px) and the Xiaohongshu pages (1080×1440). Every block has the fixed height the
// plan in digest/social.ts gave it and clamps its text to the lines it was planned for, so the
// image is exactly as tall as planned. Text never sits on a cover; numbers are in Geist Mono;
// the WeChat image prints cover credits and the week page as plain text, the Xiaohongshu pages
// print no URL, host or credit at all (their covers are always template tiles).

type Fam = TextFonts['family'];
type Font = { size: number; lh: number };

const C = (() => {
  const p = palette('ai');
  return { paper: p.paper, ink: p.ink, muted: p.muted, rule: p.rule, seal: p.seal, sealText: toHex(light.sealText) };
})();
const solid = (c: Category) => palette(c).solid;

/**
 * One clamped text block, exactly `lines` lines tall. Children must be one string. No overflow
 * clipping: Satori's ellipsis may end a hair past the box, into the page margin.
 */
function Text({ children, font, lines = 1, family, color = C.ink, style }: { children: string; font: Font; lines?: number; family: string; color?: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: 'block', flexShrink: 0, height: lines * font.lh, fontFamily: family, fontSize: font.size, lineHeight: `${font.lh}px`,
        lineClamp: lines, color, ...style,
      }}
    >
      {children}
    </div>
  );
}

const Gap = ({ h }: { h: number }) => <div style={{ display: 'flex', flexShrink: 0, height: h }} />;

/** The "V" seal and the wordmark, as on the site and the share cards. */
function Brand({ f, size }: { f: Fam; size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <div
        style={{
          width: size * 1.2, height: size * 1.2, borderRadius: size * 0.15, background: C.seal, color: C.paper, display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontFamily: f.mono, fontSize: size * 0.75, transform: 'rotate(-3deg)',
        }}
      >
        V
      </div>
      <div style={{ display: 'flex', marginLeft: size * 0.4, fontFamily: f.serif, fontSize: size, color: C.ink }}>Victor 精选</div>
    </div>
  );
}

/** The going / hosting / speaking seal as a name stamp: two characters stacked (one language only). */
function SealStamp({ seal, f, size }: { seal: DigestSeal; f: Fam; size: number }) {
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        background: C.seal, color: C.paper, borderRadius: size * 0.09, transform: 'rotate(-3deg)',
      }}
    >
      {[...GOING_LABELS[seal].zh].map((ch, i) => (
        <div key={i} style={{ display: 'flex', fontFamily: f.serif, fontSize: size * 0.36, lineHeight: 1 }}>
          {ch}
        </div>
      ))}
    </div>
  );
}

function Cover({ src, category, size, dim }: { src: string | null; category: Category; size: number; dim: boolean }) {
  return (
    <div style={{ width: size, height: size, flexShrink: 0, display: 'flex', borderRadius: 8, overflow: 'hidden', opacity: dim ? 0.4 : 1 }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori markup, not a page
        <img src={src} width={size} height={size} alt="" style={{ objectFit: 'cover' }} />
      ) : (
        <TemplateCard category={category} hostName={null} size={size} />
      )}
    </div>
  );
}

/** Number column: the pick's number (or 已取消) with its seal underneath. */
function NumberCol({ it, f, width, font, seal, gap }: { it: ExportItem; f: Fam; width: number; font: Font; seal: number; gap: number }) {
  return (
    <div style={{ width, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      {it.n === null ? (
        <Text font={{ size: Math.round(font.size * 0.55), lh: font.lh }} family={f.sans} color={C.sealText}>
          已取消
        </Text>
      ) : (
        <Text font={font} family={f.mono} color={solid(it.category)}>
          {String(it.n)}
        </Text>
      )}
      {it.seal && it.n !== null && (
        <>
          <Gap h={gap} />
          <SealStamp seal={it.seal} f={f} size={seal} />
        </>
      )}
    </div>
  );
}

const Rule = ({ inset }: { inset: number }) => (
  <div style={{ position: 'absolute', top: 0, left: inset, right: inset, height: 2, background: C.rule }} />
);

const Band = () => <div style={{ display: 'flex', flexShrink: 0, height: LONG.band, background: C.seal }} />;

// ---- WeChat long image ----------------------------------------------------------------------------

function LongItem({ b, f, cover }: { b: Extract<LongBlock, { kind: 'item' }>; f: Fam; cover: string | null }) {
  const I = LONG.item;
  const { item: it, lines: l } = b;
  const off = it.n === null;
  const blocks: ReactNode[] = [];
  const add = (node: ReactNode) => blocks.push(blocks.length ? [<Gap key={`g${blocks.length}`} h={I.gapY} />, node] : node);
  add(
    <Text key="t" font={I.title} lines={l.title} family={f.serif} color={off ? C.muted : C.ink} style={off ? { textDecoration: 'line-through' } : undefined}>
      {it.title}
    </Text>,
  );
  if (l.alt) add(<Text key="a" font={I.alt} family={f.sans} color={C.muted}>{it.alt!}</Text>);
  add(<Text key="m" font={I.meta} lines={l.meta} family={f.sans} color={C.ink}>{it.meta}</Text>);
  if (l.note) add(<Text key="n" font={I.note} lines={l.note} family={f.sans} color={C.ink}>{it.note!}</Text>);
  // Reserved for every cover the email credits (up to three lines, as planned: the licence must
  // show); left blank when the picture fell back to the template.
  if (l.credit) add(<Text key="c" font={I.credit} lines={l.credit} family={f.mono} color={C.muted}>{cover && it.credit ? it.credit : ' '}</Text>);
  return (
    <div style={{ display: 'flex', flexShrink: 0, height: b.height, position: 'relative', paddingTop: I.padY, paddingLeft: LONG.padX, paddingRight: LONG.padX }}>
      {b.rule && <Rule inset={LONG.padX} />}
      <Cover src={cover} category={it.category} size={I.cover} dim={off} />
      <div style={{ width: I.gap, flexShrink: 0 }} />
      <NumberCol it={it} f={f} width={I.num} font={I.number} seal={I.seal} gap={I.sealGap} />
      <div style={{ width: LONG_TEXT_W, display: 'flex', flexDirection: 'column' }}>{blocks}</div>
    </div>
  );
}

function LongBlockView({ b, m, part, f, covers }: { b: LongBlock; m: ExportModel; part: LongPart; f: Fam; covers: Map<string, string | null> }) {
  const box: CSSProperties = { display: 'flex', flexDirection: 'column', flexShrink: 0, height: b.height, width: LONG.width };
  const pad: CSSProperties = { paddingLeft: LONG.padX, paddingRight: LONG.padX };
  const counter = part.total > 1 ? `长图 ${part.index}/${part.total}` : null;
  switch (b.kind) {
    case 'masthead': {
      const g = LONG.gaps;
      return (
        <div style={box}>
          <Band />
          <div style={{ display: 'flex', flexDirection: 'column', paddingTop: LONG.top, ...pad }}>
            <div style={{ display: 'flex', height: LONG.brand, alignItems: 'center', justifyContent: 'space-between' }}>
              <Brand f={f} size={36} />
              {counter && <Text font={{ size: 26, lh: 36 }} family={f.mono} color={C.muted}>{counter}</Text>}
            </div>
            <Gap h={g.brand} />
            <Text font={LONG.weekOf} family={f.serif}>{m.weekOf}</Text>
            <Gap h={g.subject} />
            <Text font={LONG.subject} family={f.sans} color={C.sealText}>{m.subject}</Text>
            {b.intro.length > 0 && <Gap h={g.intro} />}
            {b.intro.map((p, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                {i > 0 && <Gap h={g.para} />}
                <Text font={LONG.intro} lines={p.lines} family={f.sans}>{p.text}</Text>
              </div>
            ))}
            <Gap h={g.zone} />
            <Text font={LONG.zone} family={f.sans} color={C.muted}>{m.zone}</Text>
          </div>
        </div>
      );
    }
    case 'header':
      return (
        <div style={box}>
          <Band />
          <div style={{ display: 'flex', height: LONG.compact, alignItems: 'center', justifyContent: 'space-between', ...pad }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Brand f={f} size={30} />
              <Text font={{ size: 26, lh: 36 }} family={f.sans} color={C.muted} style={{ marginLeft: 16 }}>{m.weekOf}</Text>
            </div>
            {counter && <Text font={{ size: 26, lh: 36 }} family={f.mono} color={C.muted}>{counter}</Text>}
          </div>
        </div>
      );
    case 'day':
      return (
        <div style={{ ...box, flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 20, ...pad }}>
          <div style={{ width: 10, height: 36, background: C.seal, marginRight: 16, marginBottom: 4 }} />
          <Text font={{ size: LONG.day.size, lh: 44 }} family={f.serif}>{b.cont ? `${b.label}（续）` : b.label}</Text>
        </div>
      );
    case 'item':
      return <LongItem b={b} f={f} cover={covers.get(b.item.eventId) ?? null} />;
    case 'preview': {
      const P = LONG.preview;
      return (
        <div style={{ ...box, ...pad }}>
          <div style={{ display: 'flex', height: P.head, alignItems: 'flex-end', paddingBottom: 20, position: 'relative' }}>
            <div style={{ width: 10, height: 36, background: C.muted, marginRight: 16, marginBottom: 4 }} />
            <Text font={{ size: LONG.day.size, lh: 44 }} family={f.serif}>下周预告</Text>
          </div>
          {m.preview.map((p, i) => (
            <Text key={i} font={P.line} family={f.sans} color={p.cancelled ? C.muted : C.ink}>
              {`· ${p.cancelled ? '[已取消] ' : ''}${p.title} · ${p.day}`}
            </Text>
          ))}
        </div>
      );
    }
    case 'footer': {
      const F = LONG.footer;
      return (
        <div style={{ ...box, ...pad, position: 'relative' }}>
          <div style={{ position: 'absolute', top: F.top / 2, left: LONG.padX, right: LONG.padX, height: 2, background: C.rule }} />
          <Gap h={F.top} />
          <Text font={F.label} family={f.sans} color={C.muted}>完整列表、报名和加入日历：</Text>
          <Text font={F.url} family={f.mono}>{m.weekUrl.replace(/^https?:\/\//, '')}</Text>
          <Gap h={F.gap} />
          <div style={{ display: 'flex', height: F.label.lh, alignItems: 'center', justifyContent: 'space-between' }}>
            <Text font={F.label} family={f.sans} color={C.muted}>{m.footer}</Text>
            <Brand f={f} size={24} />
          </div>
        </div>
      );
    }
  }
}

export function LongImage({ m, part, f, covers }: { m: ExportModel; part: LongPart; f: Fam; covers: Map<string, string | null> }) {
  return (
    <div style={{ width: LONG.width, height: part.height, display: 'flex', flexDirection: 'column', background: C.paper }}>
      {part.blocks.map((b, i) => (
        <LongBlockView key={i} b={b} m={m} part={part} f={f} covers={covers} />
      ))}
    </div>
  );
}

// ---- Xiaohongshu ------------------------------------------------------------------------------------

const page: CSSProperties = { width: XHS.width, height: XHS.height, display: 'flex', flexDirection: 'column', background: C.paper };

/** Intro paragraphs as one run: a space between them only after Latin text. */
const joinIntro = (lines: string[]) => lines.reduce((a, b) => (a ? `${a}${/[\u3000-\u9fff\uff00-\uffef]$/.test(a) ? '' : ' '}${b}` : b), '');

export function XhsCover({ m, p, f }: { m: ExportModel; p: Extract<XhsPage, { kind: 'cover' }>; f: Fam }) {
  const intro = joinIntro(m.intro);
  return (
    <div style={page}>
      <Band />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, padding: `64px ${XHS.padX}px 64px ${XHS.padX}px` }}>
        <div style={{ display: 'flex', height: 56, alignItems: 'center', justifyContent: 'space-between' }}>
          <Brand f={f} size={36} />
          <Text font={{ size: 26, lh: 36 }} family={f.mono} color={C.muted}>{`1/${p.total}`}</Text>
        </div>
        <Gap h={72} />
        <Text font={{ size: 40, lh: 56 }} family={f.sans} color={C.muted}>湾区科技活动 · 本周精选</Text>
        <Gap h={8} />
        <Text font={{ size: 132, lh: 150 }} family={f.serif}>{m.monday}</Text>
        <Text font={{ size: 64, lh: 84 }} family={f.serif}>{`这一周 · ${m.picks} 场精选`}</Text>
        {m.going > 0 && <Text font={{ size: 34, lh: 48 }} family={f.sans} color={C.sealText}>{`Victor 会去 ${m.going} 场`}</Text>}
        <Gap h={48} />
        <div style={{ display: 'flex', flexWrap: 'wrap', flexShrink: 0 }}>
          {p.categories.map(({ category, count }, i) => (
            <div key={category} style={{ display: 'flex', width: 476, height: 112, marginTop: i > 1 ? 12 : 0, alignItems: 'center' }}>
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden' }}>
                <TemplateCard category={category} hostName={null} size={92} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 20 }}>
                <Text font={{ size: 32, lh: 44 }} family={f.serif}>{CATEGORIES[category].zh}</Text>
                <Text font={{ size: 28, lh: 40 }} family={f.sans} color={C.muted}>{`${count} 场`}</Text>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexGrow: 1 }} />
        {intro && <Text font={{ size: 30, lh: 46 }} lines={3} family={f.sans}>{intro}</Text>}
        <Gap h={24} />
        <Text font={{ size: 24, lh: 36 }} family={f.sans} color={C.muted}>{`${m.zone} · ${m.footer}`}</Text>
      </div>
    </div>
  );
}

function XhsItem({ it, f, first }: { it: ExportItem; f: Fam; first: boolean }) {
  const l = xhsItemLines(it);
  const off = it.n === null;
  return (
    <div style={{ display: 'flex', flexShrink: 0, height: XHS_SLOT, alignItems: 'center', position: 'relative', paddingLeft: XHS.padX, paddingRight: XHS.padX }}>
      {!first && <Rule inset={XHS.padX} />}
      <Cover src={null} category={it.category} size={XHS.tile} dim={off} />
      <div style={{ width: XHS.gap, flexShrink: 0 }} />
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <NumberCol it={it} f={f} width={XHS.num} font={XHS.number} seal={XHS.seal} gap={XHS.gapY} />
        <div style={{ width: XHS_TEXT_W, display: 'flex', flexDirection: 'column' }}>
          <Text font={XHS.kicker} family={f.sans} color={solid(it.category)}>{`${it.dayLabel} · ${CATEGORIES[it.category].zh}`}</Text>
          <Gap h={XHS.gapY} />
          <Text font={XHS.title} lines={l.title} family={f.serif} color={off ? C.muted : C.ink} style={off ? { textDecoration: 'line-through' } : undefined}>
            {it.title}
          </Text>
          <Gap h={XHS.gapY} />
          <Text font={XHS.meta} lines={l.meta} family={f.sans} color={C.muted}>{it.xhsMeta}</Text>
          {l.note > 0 && <Gap h={XHS.gapY} />}
          {l.note > 0 && <Text font={XHS.note} lines={l.note} family={f.sans}>{it.note!}</Text>}
        </div>
      </div>
    </div>
  );
}

export function XhsItems({ m, p, f }: { m: ExportModel; p: Extract<XhsPage, { kind: 'items' }>; f: Fam }) {
  return (
    <div style={page}>
      <Band />
      <div style={{ display: 'flex', flexShrink: 0, height: XHS.head - LONG.band, alignItems: 'center', justifyContent: 'space-between', paddingLeft: XHS.padX, paddingRight: XHS.padX }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Brand f={f} size={30} />
          <Text font={{ size: 26, lh: 36 }} family={f.sans} color={C.muted} style={{ marginLeft: 16 }}>{m.weekOf}</Text>
        </div>
        <Text font={{ size: 26, lh: 36 }} family={f.mono} color={C.muted}>{`${p.index + 1}/${p.total}`}</Text>
      </div>
      {p.items.map((it, i) => (
        <XhsItem key={it.eventId} it={it} f={f} first={i === 0} />
      ))}
      <div style={{ display: 'flex', flexGrow: 1 }} />
      <div style={{ display: 'flex', flexShrink: 0, height: XHS.foot, alignItems: 'center', justifyContent: 'space-between', position: 'relative', paddingLeft: XHS.padX, paddingRight: XHS.padX }}>
        <Rule inset={XHS.padX} />
        <Text font={{ size: 22, lh: 32 }} family={f.sans} color={C.muted}>{`${m.zone} · ${m.footer}`}</Text>
        {p.more > 0 && <Text font={{ size: 30, lh: 40 }} family={f.serif} color={C.sealText}>{`还有 ${p.more} 场`}</Text>}
      </div>
    </div>
  );
}

// ---- rendering --------------------------------------------------------------------------------------

/** Every character the images of this model may draw, per font role (fonts are requested per week). */
export function imageText(model: ExportModel): { serif: string; sans: string; mono: string } {
  const m = imageModel(model);
  const items = itemsOf(m);
  const all = [
    m.site, m.weekOf, m.subject, m.zone, m.footer, ...m.intro, m.weekUrl,
    ...items.flatMap((it) => [it.dayLabel, it.title, it.alt ?? '', it.meta, it.note ?? '', it.credit ?? '', String(it.n ?? '')]),
    ...m.preview.flatMap((p) => [p.title, p.day]),
    ...Object.values(CATEGORIES).flatMap((c) => [c.zh, c.glyph]),
    ...Object.values(GOING_LABELS).map((g) => g.zh),
    'V 长图（续）已取消下周预告完整列表、报名和加入日历：湾区科技活动 · 本周精选这一周场还有会去[]/0123456789',
  ].join('');
  return { serif: all, sans: all, mono: all };
}

export type SocialTarget = { kind: 'wechat'; part: LongPart } | { kind: 'xhs'; page: XhsPage };

export type SocialImage =
  | { ok: true; body: Buffer; type: 'image/png' | 'image/jpeg'; width: number; height: number; degraded: boolean }
  | { ok: false; reason: 'fonts' };

/** Vercel answers at most 4.5 MB: a PNG over `max` is re-encoded as JPEG (q90, then q75). */
export async function fitBytes(png: Buffer, max = 4_000_000): Promise<{ body: Buffer; type: 'image/png' | 'image/jpeg' }> {
  if (png.byteLength <= max) return { body: png, type: 'image/png' };
  for (const quality of [90, 75]) {
    const jpeg = await sharp(png).flatten({ background: C.paper }).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.byteLength <= max || quality === 75) return { body: jpeg, type: 'image/jpeg' };
  }
  throw new Error('unreachable');
}

/**
 * One image of the export. Fonts first: if any chunk is missing the result is { ok: false } and
 * nothing is drawn (never an image with blank Chinese). Then the covers (WeChat only), then Satori.
 */
export async function renderSocial(model: ExportModel, target: SocialTarget, o: { allToTemplate: boolean; maxBytes?: number }): Promise<SocialImage> {
  const m = imageModel(model);
  const fonts = await textFonts(imageText(model));
  if (!fonts.complete) return { ok: false, reason: 'fonts' };
  const items =
    target.kind === 'wechat'
      ? target.part.blocks.flatMap((b) => (b.kind === 'item' ? [b.item] : []))
      : target.page.kind === 'items'
        ? target.page.items
        : [];
  const covers = await coverImages(items, { kind: target.kind, allToTemplate: o.allToTemplate });
  const width = target.kind === 'wechat' ? LONG.width : XHS.width;
  const height = target.kind === 'wechat' ? target.part.height : XHS.height;
  const element =
    target.kind === 'wechat' ? (
      <LongImage m={m} part={target.part} f={fonts.family} covers={covers.images} />
    ) : target.page.kind === 'cover' ? (
      <XhsCover m={m} p={target.page} f={fonts.family} />
    ) : (
      <XhsItems m={m} p={target.page} f={fonts.family} />
    );
  // An empty list would leave Satori with no font at all; undefined uses next/og's bundled one.
  const res = new ImageResponse(element, { width, height, fonts: fonts.fonts.length ? fonts.fonts : undefined });
  const png = Buffer.from(await res.arrayBuffer());
  const fit = await fitBytes(png, o.maxBytes);
  return { ok: true, ...fit, width, height, degraded: covers.degraded };
}
