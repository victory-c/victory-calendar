import 'server-only';
import { ImageResponse } from 'next/og';
import type { Category } from '../taxonomy';
import { TemplateCard } from './cards';
import { ogFonts } from './fonts';

/** Template / host-composite cover as PNG bytes (cover chain steps 2–3). */
export async function renderTemplatePng(opts: { category: Category; hostName: string | null; size?: number; avatars?: string[] }) {
  const size = opts.size ?? 1600;
  const res = new ImageResponse(<TemplateCard category={opts.category} hostName={opts.hostName} size={size} avatars={opts.avatars} />, {
    width: size,
    height: size,
    fonts: await ogFonts({ display: 'AI', mono: opts.hostName ?? '' }),
  });
  return Buffer.from(await res.arrayBuffer());
}
