import { light, toHex } from '@/lib/tokens';

// Admin PWA manifest (guide「PWA 外壳」). Linked only from the admin layout, so the public site
// is never offered as an install. share_target lets Android's share sheet open Add with the link.
export function GET() {
  const manifest = {
    name: "Victor's Picks · Admin",
    short_name: 'Picks',
    id: '/admin',
    start_url: '/admin/add',
    scope: '/admin/',
    display: 'standalone',
    background_color: toHex(light.paper),
    theme_color: toHex(light.paper),
    icons: [
      { src: '/admin/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/admin/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/admin/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    share_target: { action: '/admin/add', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' },
  });
}
