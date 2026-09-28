import type { Locale } from '@/lib/taxonomy';

/** 20 px vermilion "V" seal + name. The seal doubles as favicon and PWA icon. */
export function Wordmark({ locale, name }: { locale: Locale; name: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="grid size-5 -rotate-3 place-items-center rounded-[3px] bg-seal font-mono text-[0.75rem] font-bold text-paper">
        V
      </span>
      <span lang={locale === 'zh' ? 'zh-Hans' : 'en'} className="font-display text-[1.125rem] font-semibold wordmark">
        {name}
      </span>
    </span>
  );
}
