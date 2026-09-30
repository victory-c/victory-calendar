'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  addCandidates, dismissRows, type InboxState, restoreRows, setCandidateGoing, snoozeRows, type StampGoing, syncInbox,
} from '@/app/admin/inbox-actions';
import { dayKey, fmtDayHeader, fmtRange } from '@/lib/format/date';
import { btn, Chip } from './ui';

// Guide「收件箱界面」, phone-first: one column grouped by day, a checkbox per row, a sticky
// 「添加 N 项」 bar while anything is selected (it covers the tab bar), a tap-to-cycle going stamp
// (— → 想去 → 会去), 稍后 and 忽略. Keyboard: J/K move, Space select, E add, X dismiss,
// H snooze to tomorrow, G cycle going, ⌘/Ctrl+Enter add the selection.

export type InboxItem = {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  location: string | null;
  links: string[];
  sourceKinds: string[];
  suggestComment: string | null;
  suggestGoing: boolean;
  cancelled: boolean;
  view: 'inbox' | 'added' | 'snoozed' | 'dismissed';
  snoozedUntil: string | null;
  event: { id: string; status: string; going: string } | null;
};

const SOURCE_LABEL: Record<string, string> = { gcal: 'Calendar', luma: 'Luma', partiful: 'Partiful', mail: 'Mail', skill: 'Skill' };
const STAMP: Record<StampGoing, string> = { none: '—', interested: '想去', going: '会去' };
const NEXT: Record<StampGoing, StampGoing> = { none: 'interested', interested: 'going', going: 'none' };
const STATUS_ZH: Record<string, string> = { draft: '草稿', published: '已发布', cancelled: '已取消', archived: '已归档' };

const stampOf = (e: InboxItem['event']): StampGoing =>
  !e ? 'none' : e.going === 'none' ? 'none' : e.going === 'interested' ? 'interested' : 'going';

const hostOf = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

export function InboxList({ items, hidden, autoSync }: { items: InboxItem[]; hidden: boolean; autoSync: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [publish, setPublish] = useState(false);
  const [source, setSource] = useState<string>('all');
  const [focus, setFocus] = useState(0);
  const [msg, setMsg] = useState<InboxState>(null);
  const [stamps, setStamps] = useState<Record<string, StampGoing>>({});
  const [pending, start] = useTransition();
  const synced = useRef(false);

  const run = useCallback((fn: () => Promise<InboxState | void>) => {
    start(async () => {
      const r = await fn();
      if (r) setMsg(r);
    });
  }, []);

  useEffect(() => {
    if (!autoSync || synced.current) return;
    synced.current = true;
    run(() => syncInbox(false));
  }, [autoSync, run]);

  const sources = useMemo(() => [...new Set(items.flatMap((i) => i.sourceKinds))], [items]);
  const shown = useMemo(() => (source === 'all' ? items : items.filter((i) => i.sourceKinds.includes(source))), [items, source]);
  const selectable = (i: InboxItem) => !i.event && i.links.length > 0 && !hidden;
  const chosen = shown.filter((i) => selected.has(i.id) && selectable(i)).map((i) => i.id);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const addSelected = () => {
    if (!chosen.length) return;
    const ids = chosen;
    run(async () => {
      const r = await addCandidates(ids, publish);
      setSelected(new Set());
      return r;
    });
  };
  const cycleGoing = (i: InboxItem) => {
    const next = NEXT[stamps[i.id] ?? stampOf(i.event)];
    setStamps((s) => ({ ...s, [i.id]: next }));
    run(() => setCandidateGoing(i.id, next));
  };

  // Keyboard triage on desktop (guide: E add, X dismiss, H snooze, G going, J/K move).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && (t as HTMLInputElement).type !== 'checkbox')) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        addSelected();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const cur = shown[focus];
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const n = Math.max(0, Math.min(shown.length - 1, focus + (k === 'j' ? 1 : -1)));
        setFocus(n);
        document.getElementById(`cand-${shown[n]?.id}`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (!cur) return;
      if (k === ' ' && selectable(cur)) {
        e.preventDefault();
        toggle(cur.id);
      } else if (k === 'e' && selectable(cur)) {
        run(() => addCandidates([cur.id], publish));
      } else if (k === 'x' && !hidden) {
        run(() => dismissRows([cur.id]));
      } else if (k === 'h' && !hidden) {
        run(() => snoozeRows([cur.id], 'tomorrow'));
      } else if (k === 'g' && cur.links.length > 0) {
        cycleGoing(cur);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const groups = useMemo(() => {
    const out: { key: string; date: Date; rows: InboxItem[] }[] = [];
    for (const i of shown) {
      const d = new Date(i.startAt);
      const key = dayKey(d);
      if (out.at(-1)?.key !== key) out.push({ key, date: d, rows: [] });
      out.at(-1)!.rows.push(i);
    }
    return out;
  }, [shown]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {sources.length > 1 &&
          ['all', ...sources].map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={source === s}
              onClick={() => setSource(s)}
              className="h-8 rounded-full border border-rule px-3 text-xs text-muted aria-pressed:border-ink aria-pressed:text-ink"
            >
              {s === 'all' ? 'All · 全部' : SOURCE_LABEL[s] ?? s}
            </button>
          ))}
        {!hidden && (
          <button type="button" className={`${btn.small} ml-auto`} disabled={pending} onClick={() => run(() => syncInbox(true))}>
            {pending ? '…' : 'Refresh · 刷新'}
          </button>
        )}
      </div>
      <p role="status" aria-live="polite" className={`mb-2 min-h-5 text-sm ${msg && !msg.ok ? 'text-seal-text' : 'text-muted'}`}>
        {msg?.message}
      </p>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-muted">
          {hidden ? 'Nothing snoozed or dismissed · 没有稍后或忽略的' : 'Inbox zero · 收件箱是空的。日历和 skill 推来的活动会出现在这里。'}
        </p>
      ) : (
        groups.map((g) => {
          const h = fmtDayHeader(g.date, 'zh');
          return (
            <section key={g.key} className="mb-4">
              <h2 className="sticky top-0 z-10 bg-paper/95 py-1 font-mono text-xs uppercase text-muted backdrop-blur">
                {h.date} {h.weekday}
              </h2>
              <ul>
                {g.rows.map((i) => {
                  const idx = shown.indexOf(i);
                  const stamp = stamps[i.id] ?? stampOf(i.event);
                  const canPick = selectable(i);
                  return (
                    <li
                      key={i.id}
                      id={`cand-${i.id}`}
                      onClick={() => setFocus(idx)}
                      className={`flex gap-3 border-b border-rule py-3 ${idx === focus ? 'bg-rule/20' : ''} ${i.event ? 'opacity-70' : ''}`}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${i.title}`}
                        className="mt-1 size-5 shrink-0 accent-ink"
                        checked={i.event ? true : selected.has(i.id)}
                        disabled={!canPick}
                        onChange={() => toggle(i.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`line-clamp-2 font-medium ${i.cancelled ? 'text-muted line-through' : 'text-ink'}`}>{i.title}</p>
                        <p className="mt-0.5 truncate text-sm text-muted">
                          {fmtRange(new Date(i.startAt), i.endAt ? new Date(i.endAt) : null, 'zh')}
                        </p>
                        {i.location && <p className="truncate text-sm text-muted">{i.location}</p>}
                        {i.suggestComment && <p className="mt-1 text-sm text-ink/80">“{i.suggestComment}”</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {i.sourceKinds.map((k) => (
                            <Chip key={k}>{SOURCE_LABEL[k] ?? k}</Chip>
                          ))}
                          {i.cancelled && <Chip tone="seal">已取消</Chip>}
                          {i.suggestGoing && !i.event && <Chip tone="ai">skill 建议会去</Chip>}
                          {i.event && (
                            <Link href={`/admin/e/${i.event.id}`} className="text-sm underline">
                              已添加 · {STATUS_ZH[i.event.status] ?? i.event.status}
                            </Link>
                          )}
                          {i.links[0] ? (
                            <a href={i.links[0]} target="_blank" rel="noreferrer noopener" className="truncate text-sm text-muted underline">
                              {hostOf(i.links[0])}
                            </a>
                          ) : (
                            <span className="text-sm text-muted">没有链接</span>
                          )}
                          {i.view === 'snoozed' && i.snoozedUntil && (
                            <span className="text-sm text-muted">稍后到 {fmtDayHeader(new Date(i.snoozedUntil), 'zh').date}</span>
                          )}
                          {i.view === 'dismissed' && <span className="text-sm text-muted">已忽略</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {i.links.length > 0 && !hidden && (
                          <button
                            type="button"
                            aria-label={`Going: ${stamp}`}
                            title="Tap to cycle · 点按切换：— → 想去 → 会去"
                            disabled={pending}
                            onClick={() => cycleGoing(i)}
                            className={`h-9 min-w-12 rounded-full border px-3 text-sm ${stamp === 'going' ? 'border-seal text-seal-text' : 'border-rule text-muted'}`}
                          >
                            {STAMP[stamp]}
                          </button>
                        )}
                        {hidden ? (
                          <button type="button" className={btn.small} disabled={pending} onClick={() => run(() => restoreRows([i.id]))}>
                            Restore · 恢复
                          </button>
                        ) : (
                          !i.event && (
                            <div className="flex gap-1.5">
                              <details className="relative">
                                <summary className={`${btn.small} cursor-pointer list-none`}>稍后</summary>
                                <div className="absolute right-0 z-20 mt-1 flex flex-col gap-1 rounded-lg border border-rule bg-paper p-1 shadow">
                                  <button type="button" className={btn.small} onClick={() => run(() => snoozeRows([i.id], 'tomorrow'))}>
                                    明天
                                  </button>
                                  <button type="button" className={btn.small} onClick={() => run(() => snoozeRows([i.id], 'next_week'))}>
                                    下周
                                  </button>
                                </div>
                              </details>
                              <button type="button" className={btn.small} disabled={pending} onClick={() => run(() => dismissRows([i.id]))}>
                                忽略
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {chosen.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-paper pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-5 accent-ink" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
              直接发布
            </label>
            <button type="button" className={btn.secondary} onClick={() => setSelected(new Set())}>
              取消
            </button>
            <button type="button" className={`${btn.primary} ml-auto`} disabled={pending} onClick={addSelected}>
              {pending ? '…' : `添加 ${chosen.length} 项`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
