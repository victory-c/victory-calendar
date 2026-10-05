import type { CSSProperties } from 'react';
import { CATEGORIES, CATEGORY_SLUGS, type Category, type Locale } from '@/lib/taxonomy';

/**
 * The seven category chips as native checkboxes named `c`, styled like CategoryChips (12% category
 * tint when on, ink text, 44 px on phones and 32 px on desktop). Native inputs keep the form usable
 * before hydration and let the action read `formData.getAll('c')`. A ticked chip also swaps its
 * colour dot for a check mark, so on and off differ without relying on colour.
 */
export function CategoryCheckboxes({
  locale,
  legend,
  hint,
  error,
  selected,
  disabled,
}: {
  locale: Locale;
  legend: string;
  hint?: string;
  /** Shown in place of the hint, in the error colour (the subscribe form's "pick at least one"). */
  error?: string;
  selected: readonly Category[];
  disabled?: boolean;
}) {
  const note = error || hint;
  return (
    <fieldset disabled={disabled} aria-describedby={note ? 'category-hint' : undefined}>
      <legend className="text-sm text-muted">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {CATEGORY_SLUGS.map((c) => (
          <label
            key={c}
            style={{ '--c': `var(--color-cat-${c})` } as CSSProperties}
            className="chip-toggle group/chip inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-rule px-4 text-sm text-ink transition-colors duration-150 has-[:checked]:border-transparent has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-seal md:h-8 md:px-3"
          >
            <input type="checkbox" name="c" value={c} defaultChecked={selected.includes(c)} className="sr-only" />
            {/* Off: the category dot. On: a check. Both take 12 px (the dot with its margins), so the chip keeps its width. */}
            <span aria-hidden className="mx-0.5 size-2 rounded-full group-has-[:checked]/chip:hidden" style={{ background: 'var(--c)' }} />
            <svg
              aria-hidden
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="hidden size-3 group-has-[:checked]/chip:block"
            >
              <path d="M2.5 6.5 5 9l4.5-5.5" />
            </svg>
            {CATEGORIES[c][locale]}
          </label>
        ))}
      </div>
      {note && (
        <p id="category-hint" className={`mt-2 ${error ? 'text-sm text-seal-text' : 'text-xs text-muted'}`}>
          {note}
        </p>
      )}
    </fieldset>
  );
}
