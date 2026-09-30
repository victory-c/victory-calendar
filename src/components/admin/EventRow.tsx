import Link from 'next/link';
import type { ReactNode } from 'react';
import { CoverImage } from '@/components/CoverImage';
import type { AdminEvent } from '@/lib/admin/events';
import { fmtRange } from '@/lib/format/date';
import { CATEGORIES, isCategory } from '@/lib/taxonomy';
import { Chip } from './ui';

/** One event in an admin list: thumbnail, title, time, chips, row actions. */
export function EventRow({ e, actions, chips }: { e: AdminEvent; actions?: ReactNode; chips?: ReactNode }) {
  const title = e.titleZh || e.titleEn || e.sourceUrl;
  return (
    <li className="flex gap-3 border-b border-rule py-3">
      <Link href={`/admin/e/${e.id}`} className="shrink-0" tabIndex={-1} aria-hidden>
        {isCategory(e.category) ? (
          <CoverImage
            cover={e.cover ? { ...e.cover, attribution: e.cover.attribution, license: e.cover.license, sourcePageUrl: e.cover.sourcePageUrl } : null}
            category={e.category}
            hostName={null}
            alt=""
            size={64}
            locale="zh"
          />
        ) : (
          <span className="block size-16 rounded-cover border border-dashed border-rule" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/admin/e/${e.id}`} className="line-clamp-2 font-medium text-ink">
          {title}
        </Link>
        <p className="mt-0.5 truncate text-sm text-muted">
          {e.startAt ? fmtRange(e.startAt, e.endAt, 'zh', e.tz) : '没有时间 · no date'}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {isCategory(e.category) && <Chip>{CATEGORIES[e.category].zh}</Chip>}
          {e.status === 'cancelled' && <Chip tone="seal">已取消</Chip>}
          {chips}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-col items-end gap-2">{actions}</div>}
    </li>
  );
}
