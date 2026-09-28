import { CATEGORIES, type Category, type Locale } from '@/lib/taxonomy';

/** Non-interactive category chip used inside cards. */
export function CategoryLabel({ category, locale }: { category: Category; locale: Locale }) {
  return (
    <span className={`chip-bg-${category} inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs leading-tight text-ink`}>
      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: `var(--color-cat-${category})` }} />
      {CATEGORIES[category][locale]}
    </span>
  );
}
