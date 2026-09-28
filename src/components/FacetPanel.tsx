import { getTranslations } from 'next-intl/server';
import { hasFacet, type Filters } from '@/lib/events/filters';
import type { Locale } from '@/lib/taxonomy';

const REGIONS = ['sf', 'east_bay', 'peninsula', 'south_bay', 'north_bay'] as const;

/** A plain GET form inside <details>: works without JavaScript, state stays in the URL. */
export async function FacetPanel({ locale, filters, action, keep }: { locale: Locale; filters: Filters; action: string; keep?: Record<string, string> }) {
  const t = await getTranslations({ locale, namespace: 'Facets' });
  const hidden = { ...(filters.cats.length ? { c: filters.cats.join(',') } : {}), ...keep };
  const select = 'h-11 w-full rounded-lg border border-rule bg-paper px-3 text-sm md:h-9';
  return (
    <details className="mt-3 rounded-card border border-rule" open={hasFacet(filters)}>
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between px-4 text-sm [&::-webkit-details-marker]:hidden">
        {t('title')}
        <span aria-hidden className="text-muted">+</span>
      </summary>
      <form method="get" action={action} className="grid gap-3 border-t border-rule p-4 sm:grid-cols-2 md:grid-cols-4">
        {Object.entries(hidden).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="text-xs text-muted">
          {t('lang')}
          <select name="lang" defaultValue={filters.lang ?? ''} className={`${select} mt-1 text-ink`}>
            <option value="">{t('langAny')}</option>
            <option value="zh">{t('langZh')}</option>
            <option value="bilingual">{t('langBilingual')}</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          {t('fmt')}
          <select name="fmt" defaultValue={filters.fmt ?? ''} className={`${select} mt-1 text-ink`}>
            <option value="">{t('fmtAny')}</option>
            <option value="in_person">{t('fmtInPerson')}</option>
            <option value="online">{t('fmtOnline')}</option>
          </select>
        </label>
        <label className="text-xs text-muted">
          {t('region')}
          <select name="r" defaultValue={filters.region ?? ''} className={`${select} mt-1 text-ink`}>
            <option value="">{t('regionAny')}</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {t(r)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex h-11 items-center gap-2 text-sm md:h-9">
            <input type="checkbox" name="free" value="1" defaultChecked={filters.free} className="size-4 accent-ink" />
            {t('free')}
          </label>
        </div>
        <div className="flex gap-2 sm:col-span-2 md:col-span-4">
          <button type="submit" className="h-11 rounded-full bg-ink px-5 text-sm text-paper md:h-9">
            {t('apply')}
          </button>
          <a href={`${action}${hidden.c ? `?c=${hidden.c}` : ''}`} className="inline-flex h-11 items-center rounded-full border border-rule px-5 text-sm md:h-9">
            {t('clear')}
          </a>
        </div>
      </form>
    </details>
  );
}
