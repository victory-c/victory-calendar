'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** Visitor-local time for online events. Renders nothing on the server (tz unknown there). */
export function LocalTime({ iso, locale, label }: { iso: string; locale: 'en' | 'zh'; label: string }) {
  const text = useSyncExternalStore(
    subscribe,
    () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz === 'America/Los_Angeles') return '';
      return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit',
        hourCycle: locale === 'zh' ? 'h23' : 'h12', timeZoneName: 'short',
      }).format(new Date(iso));
    },
    () => '',
  );
  if (!text) return null;
  return (
    <p className="tnum font-mono text-sm text-muted">
      {label}: {text}
    </p>
  );
}
