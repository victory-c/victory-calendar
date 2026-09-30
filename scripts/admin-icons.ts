// PWA icons for /admin: the vermilion "V" seal from the wordmark, drawn as a path (no font).
// Usage: pnpm tsx scripts/admin-icons.ts  → public/admin/*.png (committed).
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { light, toHex } from '../src/lib/tokens';

const seal = toHex(light.seal);
const paper = toHex(light.paper);

function svg(size: number, maskable: boolean) {
  // Maskable icons keep the mark inside the central 80% safe zone and fill the canvas.
  const pad = maskable ? 0 : size * 0.08;
  const inner = size - pad * 2;
  const r = maskable ? 0 : inner * 0.16;
  const s = inner * (maskable ? 0.5 : 0.62);
  const cx = size / 2;
  const cy = size / 2 + s * 0.02;
  const w = s * 0.17;
  const d = `M ${cx - s * 0.42} ${cy - s * 0.4} L ${cx} ${cy + s * 0.42} L ${cx + s * 0.42} ${cy - s * 0.4}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <g transform="rotate(-3 ${size / 2} ${size / 2})">
      <rect x="${pad}" y="${pad}" width="${inner}" height="${inner}" rx="${r}" fill="${seal}"/>
      <path d="${d}" fill="none" stroke="${paper}" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"/>
    </g>
  </svg>`;
}

async function main() {
  mkdirSync('public/admin', { recursive: true });
  const out: [string, number, boolean, boolean][] = [
    ['icon-192.png', 192, false, false],
    ['icon-512.png', 512, false, false],
    ['icon-maskable-512.png', 512, true, false],
    ['apple-touch-icon.png', 180, true, true],
  ];
  for (const [name, size, maskable, opaque] of out) {
    let img = sharp(Buffer.from(svg(size, maskable)));
    if (opaque) img = img.flatten({ background: seal });
    await img.png().toFile(`public/admin/${name}`);
    console.log(`public/admin/${name}`);
  }
}

main();
