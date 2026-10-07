'use client';
import { type FormEvent, type MouseEvent, useActionState, useEffect, useRef, useState } from 'react';
import { type LookupState, subscriberAction } from '@/app/admin/subscriber-actions';
import { CATEGORIES } from '@/lib/taxonomy';
import { btn, Chip, field } from './ui';

type Detail = NonNullable<NonNullable<LookupState>['sub']>;

const STATUS: Record<Detail['status'], string> = {
  pending: 'Pending · 待确认',
  active: 'Active · 订阅中',
  paused: 'Paused · 暂停',
  unsubscribed: 'Unsubscribed · 已退订',
  suppressed: 'Suppressed · 已抑制',
};
/** F19 event-language preference (zh and en include bilingual events). */
const EV_LANG: Record<NonNullable<Detail['evLang']>, string> = {
  zh: 'Chinese or bilingual · 中文或双语',
  en: 'English or bilingual · 英文或双语',
  bilingual: 'Bilingual only · 仅双语',
};
const SEND: Record<Detail['sends'][number]['state'], string> = { sent: 'sent · 已发', failed: 'failed · 失败', pending: 'in flight · 发送中' };

const SUPPRESS_CONFIRM = 'Suppress permanently? They can never resubscribe with this address · 永久抑制？此邮箱以后不能再订阅';
const DELETE_CONFIRM =
  'Delete this subscriber and their send history? This cannot be undone; they could sign up again later · 删除这个订阅者和发送记录？无法恢复，之后对方可以重新订阅';
const DELETE_SUPPRESSED =
  'This address is on the do-not-send list (bounce, complaint or manual suppress). Deleting removes our block, but after a bounce or complaint Resend keeps its own: remove the address there too (Resend Dashboard → Suppressions), or a new sign-up is suppressed again. Type DELETE to confirm · 此邮箱在禁止发送名单上。删除只去掉我们这边的封锁；退信或投诉后 Resend 还有自己的抑制名单，要到 Resend 后台 → Suppressions 一并删除，否则重新订阅会再次被抑制。输入 DELETE 确认';

const fmt = (iso: string | null) =>
  iso
    ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))} PT`
    : '—';

/**
 * /admin/subscribers lookup: one exact match at a time, posted through a Server Action so the
 * address never goes in a URL. The result card offers Suppress (hidden once suppressed) and Delete,
 * each behind a confirm; deleting a suppressed row asks for the word DELETE, and the server refuses
 * it without that acknowledgement, so a row suppressed after the lookup can't be deleted by accident.
 *
 * The query field is controlled: React resets a form after every action, and an uncontrolled field
 * would lose a mistyped address along with a correct one.
 */
export function SubscriberLookup() {
  const [state, action, pending] = useActionState<LookupState, FormData>(subscriberAction, null);
  const [q, setQ] = useState('');
  const sub = state?.sub ?? null;
  const status = useRef<HTMLParagraphElement>(null);
  const pressed = useRef<HTMLElement | null>(null);
  const wasPending = useRef(pending);
  const remember = (e: FormEvent<HTMLFormElement>) => {
    pressed.current = (e.nativeEvent as SubmitEvent).submitter;
  };
  // As in DigestEditor: the pressed button is disabled while pending (Suppress then disappears, and a
  // delete takes the whole card), which drops focus to <body>. Once the action settles, put it back
  // on that button, or on the status line when the button is gone. No deps: compare with the
  // previous commit.
  useEffect(() => {
    const settled = wasPending.current && !pending;
    wasPending.current = pending;
    if (!settled || (document.activeElement && document.activeElement !== document.body)) return;
    const b = pressed.current;
    (b?.isConnected && !(b as HTMLButtonElement).disabled ? b : status.current)?.focus();
  });
  return (
    <div className="space-y-3">
      <form action={action} onSubmit={remember} className="flex gap-2">
        <input type="hidden" name="_op" value="find" />
        <label htmlFor="subscriber-q" className="sr-only">Email, sub_… id or a link from our email · 邮箱、编号或邮件里的链接</label>
        <input
          id="subscriber-q"
          name="q"
          type="text"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="reader@example.com · sub_… · /prefs/…"
          className={`${field.input} mt-0 min-w-0 flex-1`}
        />
        <button className={btn.primary} disabled={pending}>Find · 查找</button>
      </form>
      <p className="text-xs text-muted">
        Exact match only, never a list; the query is posted, not put in the URL · 只做精确匹配、不列清单；查询不会出现在网址里
      </p>
      <p ref={status} role="status" aria-live="polite" tabIndex={-1} className={`text-sm ${state && !state.ok ? 'text-seal-text' : 'text-muted'}`}>
        {pending ? '…' : state?.message}
      </p>
      {sub && <Result sub={sub} action={action} onSubmit={remember} pending={pending} />}
    </div>
  );
}

function Result({ sub, action, onSubmit, pending }: {
  sub: Detail;
  action: (fd: FormData) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  pending: boolean;
}) {
  const suppressed = sub.status === 'suppressed';
  const ask = (text: string) => (e: MouseEvent<HTMLButtonElement>) => {
    if (!window.confirm(text)) e.preventDefault();
  };
  const askDelete = (e: MouseEvent<HTMLButtonElement>) => {
    if (!suppressed) return ask(DELETE_CONFIRM)(e);
    if (window.prompt(DELETE_SUPPRESSED)?.trim().toUpperCase() !== 'DELETE') e.preventDefault();
  };
  const row = (label: string, value: string) => (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  );
  return (
    <article aria-label="Subscriber · 订阅者" className="rounded-lg border border-rule p-3">
      <p className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all font-medium">{sub.email}</span>
        <Chip tone={suppressed || sub.status === 'unsubscribed' ? 'seal' : 'muted'}>{STATUS[sub.status]}</Chip>
      </p>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        {row('ID', sub.id)}
        {row('Language · 语言', sub.locale === 'zh' ? '中文' : 'English')}
        {row('Categories · 类别', sub.categories.map((c) => CATEGORIES[c].zh).join('、') || '—')}
        {row('Filters · 筛选', [sub.evLang && EV_LANG[sub.evLang], sub.onlineOnly && 'Online only · 只要线上'].filter(Boolean).join(' · ') || 'None · 无')}
        {row('Created · 创建', fmt(sub.createdAt))}
        {row('Consent · 同意', `${fmt(sub.consentAt)}${sub.consentSource ? ` · ${sub.consentSource}` : ''}`)}
        {row('Confirmed · 确认', fmt(sub.confirmedAt))}
        {row('Unsubscribed · 退订', fmt(sub.unsubscribedAt))}
        {row('Paused until · 暂停到', fmt(sub.pausedUntil))}
      </dl>
      <h3 className="mt-3 font-mono text-xs uppercase text-muted">Last sends · 最近发送</h3>
      {sub.sends.length === 0 ? (
        <p className="text-sm text-muted">None yet · 还没有</p>
      ) : (
        <ul className="text-sm">
          {sub.sends.map((s) => (
            <li key={`${s.isoWeek}-${s.claimedAt}`} className="flex flex-wrap gap-x-2">
              <span className="font-mono">{s.isoWeek}</span>
              <span className="text-muted">{s.kind === 'empty' ? 'empty notice · 空周通知' : 'digest · 周报'}</span>
              <span className={s.state === 'failed' ? 'text-seal-text' : ''}>
                {SEND[s.state]}
                {s.error ? ` (${s.error})` : ''}
              </span>
              <span className="text-muted">{fmt(s.sentAt ?? s.claimedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <form action={action} onSubmit={onSubmit} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="id" value={sub.id} />
        {suppressed && <input type="hidden" name="ack" value="suppressed" />}
        {!suppressed && (
          <button type="submit" name="_op" value="suppress" className={btn.danger} disabled={pending} onClick={ask(SUPPRESS_CONFIRM)}>
            Suppress · 永久抑制
          </button>
        )}
        <button type="submit" name="_op" value="delete" className={btn.danger} disabled={pending || sub.inFlight} onClick={askDelete}>
          Delete · 删除
        </button>
      </form>
      {sub.inFlight && <p className="mt-1 text-xs text-muted">An email is being sent to them; Delete waits until it finishes · 正在给他们发邮件，发完才能删除</p>}
    </article>
  );
}
