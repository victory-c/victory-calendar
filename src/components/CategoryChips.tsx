'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { usePathname } from '@/i18n/navigation';
import { CATEGORIES, CATEGORY_SLUGS, parseCategories, type Category, type Locale } from '@/lib/taxonomy';

/**
 * Multi-select category chips — real buttons with aria-pressed. State lives in ?c=, so the
 * same selection later generates the matching iCal and subscribe links.
 */
export function CategoryChips({ locale, label, allLabel }: { locale: Locale; label: string; allLabel: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = parseCategories(params?.get('c'));
  const [pending, start] = useTransition();

  function go(next: Category[]) {
    const q = new URLSearchParams(params?.toString());
    if (next.length) q.set('c', CATEGORY_SLUGS.filter((c) => next.includes(c)).join(','));
    else q.delete('c');
    const prefix = locale === 'zh' ? '/zh' : '';
    const path = `${prefix}${pathname === '/' ? '' : pathname}` || '/';
    start(() => router.replace(q.size ? `${path}?${q}` : path, { scroll: false }));
  }

  const toggle = (c: Category) => go(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);

  return (
    <div role="group" aria-label={label} aria-busy={pending} className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      <ChipButton pressed={selected.length === 0} onClick={() => go([])}>
        {allLabel}
      </ChipButton>
      {CATEGORY_SLUGS.map((c) => (
        <ChipButton key={c} pressed={selected.includes(c)} onClick={() => toggle(c)} category={c}>
          {CATEGORIES[c][locale]}
        </ChipButton>
      ))}
    </div>
  );
}

export function CategoryChipsFallback({ locale, allLabel }: { locale: Locale; allLabel: string }) {
  return (
    <div className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0" aria-hidden>
      <ChipButton pressed>{allLabel}</ChipButton>
      {CATEGORY_SLUGS.map((c) => (
        <ChipButton key={c} pressed={false} category={c}>
          {CATEGORIES[c][locale]}
        </ChipButton>
      ))}
    </div>
  );
}

function ChipButton({ pressed, onClick, category, children }: { pressed: boolean; onClick?: () => void; category?: Category; children: React.ReactNode }) {
  const on = pressed && category ? `chip-bg-${category} border-transparent` : pressed ? 'bg-ink text-paper border-ink' : 'border-rule';
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm transition-colors duration-150 md:h-8 md:px-3 ${on}`}
    >
      {category && <span aria-hidden className="size-2 rounded-full" style={{ background: `var(--color-cat-${category})` }} />}
      {children}
    </button>
  );
}
