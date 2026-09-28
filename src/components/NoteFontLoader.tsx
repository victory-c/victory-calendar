'use client';
import { useEffect } from 'react';

/**
 * LXGW WenKai (curator notes only) must never block first paint (PRD §9b). Its slice index
 * is injected once the page is idle; notes render in the serif fallback until then.
 */
export function NoteFontLoader({ href }: { href: string }) {
  useEffect(() => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const add = () => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = href;
      document.head.appendChild(l);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(add, { timeout: 3000 });
    else setTimeout(add, 1500);
  }, [href]);
  return null;
}
