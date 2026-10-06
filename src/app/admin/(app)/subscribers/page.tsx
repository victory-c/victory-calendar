import { connection } from 'next/server';
import { Suspense } from 'react';
import { SubscriberLookup } from '@/components/admin/SubscriberLookup';
import { btn, Chip, Screen } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/admin-session';
import { PT } from '@/lib/format/date';
import { hasVerifiedSender, newsletterStatus, privacyContact } from '@/lib/newsletter/status';
import {
  categoryMatrix, facetMatrix, G3_CONFIRMED, gateStatus, type IssueGate, type LocaleCounts, ON_TIME_MS, optInRate, statusCounts,
  type SubscriberStatus,
} from '@/lib/subscribers/admin';
import { CATEGORIES, CATEGORY_SLUGS } from '@/lib/taxonomy';

export const metadata = { title: 'Subscribers' };

// Guide row「/admin/subscribers」: counts by status, language and category, the G3 gate, an exact
// lookup with manual suppress and delete, and the CSV export. Counts only on the page: no address
// is ever listed (the lookup shows the one row you asked for; the export needs the admin session).

const STATUS: Record<SubscriberStatus, string> = {
  pending: 'Pending · 待确认',
  active: 'Active · 订阅中',
  paused: 'Paused · 暂停',
  unsubscribed: 'Unsubscribed · 已退订',
  suppressed: 'Suppressed · 已抑制',
};
const H2 = 'mb-1 font-mono text-xs uppercase text-muted';
/** F19 event-language preference rows; zh and en include bilingual events. */
const EV_LANG = {
  any: 'Any language · 不限',
  zh: 'Chinese or bilingual · 中文或双语',
  en: 'English or bilingual · 英文或双语',
  bilingual: 'Bilingual only · 仅双语',
} as const;

const fmtPT = (d: Date) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} PT`;
const pct = (n: number, of: number, digits = 1) => (of ? `${((100 * n) / of).toFixed(digits)}%` : '—');
const Met = ({ ok }: { ok: boolean }) => (ok ? <Chip tone="seal">Met · 达标</Chip> : <Chip>Not yet · 未达标</Chip>);

function CountTable({ caption, head, rows, total }: {
  caption: string;
  head: string;
  rows: { key: string; label: string; c: LocaleCounts }[];
  total: { label: string; c: LocaleCounts };
}) {
  const num = 'py-2 pl-2 text-right';
  return (
    <table className="w-full text-sm tabular-nums">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-rule text-muted">
          <th scope="col" className="py-2 text-left font-normal">{head}</th>
          <th scope="col" className={`${num} font-normal`}>EN</th>
          <th scope="col" className={`${num} font-normal`}>中文</th>
          <th scope="col" className={`${num} font-normal`}>Total · 合计</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-rule">
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row" className="py-2 text-left font-normal">{r.label}</th>
            <td className={num}>{r.c.en}</td>
            <td className={num}>{r.c.zh}</td>
            <td className={num}>{r.c.total}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-ink font-medium">
          <th scope="row" className="py-2 text-left">{total.label}</th>
          <td className={num}>{total.c.en}</td>
          <td className={num}>{total.c.zh}</td>
          <td className={num}>{total.c.total}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function IssueLine({ i }: { i: IssueGate }) {
  return (
    <li className="space-y-0.5 py-2">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{i.isoWeek}</span>
        <span>sent · 发出 {i.sent}</span>
        <Met ok={i.sent >= G3_CONFIRMED && i.onTime === true} />
      </p>
      <p className="text-muted">
        {i.onTime === null
          ? 'Still sending · 发送中'
          : i.onTime
            ? `On time · 准时（${i.sentAt ? fmtPT(i.sentAt) : ''}）`
            : `Late · 晚了（${i.sentAt ? fmtPT(i.sentAt) : 'not finished · 未完成'}）`}
      </p>
      <p className="text-muted">
        Hard bounces · 硬退信 {i.hardBounces} ({pct(i.hardBounces, i.delivered)}) · complaints · 投诉 {i.complaints} ({pct(i.complaints, i.delivered, 2)}) ·
        seed bounces · 种子退回 {i.seedBounces}
      </p>
    </li>
  );
}

async function Subscribers() {
  await requireAdmin();
  await connection();
  const now = new Date();
  const [counts, matrix, facets, gate, optIn] = await Promise.all([
    statusCounts(), categoryMatrix({ now }), facetMatrix({ now }), gateStatus({ now }), optInRate(),
  ]);
  const closed = newsletterStatus() === 'closed';
  // Names only, never values. On Vercel the form also waits for the sender and the /privacy contact.
  const missing =
    process.env.NEWSLETTER_OPEN === '0'
      ? ['NEWSLETTER_OPEN=0']
      : process.env.VERCEL
        ? [!hasVerifiedSender() && 'verified sender · 发信域名验证', !privacyContact() && 'PRIVACY_CONTACT_EMAIL · 隐私联系邮箱'].filter(
            (m): m is string => Boolean(m),
          )
        : [];

  return (
    <div className="space-y-8">
      {closed && (
        <p role="note" className="rounded-lg border border-seal px-3 py-2 text-sm text-seal-text">
          Sign-up form closed: the counts stay near 0 until it opens · 订阅表单关闭中，开放前数字基本都是 0
          {missing.length > 0 && ` · waiting for · 等待：${missing.join('、')}`}
        </p>
      )}

      <section aria-labelledby="subs-status">
        <h2 id="subs-status" className={H2}>By status · 按状态</h2>
        <CountTable
          caption="Subscribers by status and language · 各状态、语言的订阅者数"
          head="Status · 状态"
          rows={(Object.keys(STATUS) as SubscriberStatus[]).map((s) => ({ key: s, label: STATUS[s], c: counts.rows[s] }))}
          total={{ label: 'All rows · 全部', c: counts.total }}
        />
      </section>

      <section aria-labelledby="subs-categories">
        <h2 id="subs-categories" className={H2}>Sunday&apos;s readers by category · 本周日周报的收件人（按类别）</h2>
        <CountTable
          caption="Eligible subscribers by category and language · 符合条件的订阅者（类别 × 语言）"
          head="Category · 类别"
          rows={CATEGORY_SLUGS.map((c) => ({ key: c, label: `${CATEGORIES[c].en} · ${CATEGORIES[c].zh}`, c: matrix.rows[c] }))}
          total={{ label: 'People · 人数', c: matrix.people }}
        />
        <p className="mt-1 text-xs text-muted">
          Counted now with the digest&apos;s own rule, so People matches /admin/digest&apos;s eligible count. One subscriber counts in every
          category they picked, so the rows add up to more than People · 与 /admin/digest 的「符合条件」同一规则、同一时刻；多选会重复计数，各行相加大于人数
        </p>
      </section>

      <section aria-labelledby="subs-facets">
        <h2 id="subs-facets" className={H2}>Filters · 筛选</h2>
        <CountTable
          caption="Eligible subscribers by event-language and online filter, and language · 符合条件的订阅者（活动语言、线上筛选 × 语言）"
          head="Filter · 筛选"
          rows={[
            ...(Object.keys(EV_LANG) as (keyof typeof EV_LANG)[]).map((k) => ({ key: k, label: EV_LANG[k], c: facets.evLang[k] })),
            { key: 'online', label: 'Online only · 只要线上（含线上线下同步）', c: facets.onlineOnly },
          ]}
          total={{ label: 'People · 人数', c: facets.people }}
        />
        <p className="mt-1 text-xs text-muted">
          Same readers as above. Every reader is in one event-language row; online only is counted on top · 与上表同一批收件人；每人只在一个活动语言行里，「只要线上」另外计数
        </p>
      </section>

      <section aria-labelledby="subs-g3" className="space-y-2 rounded-lg border border-rule p-3 text-sm">
        <h2 id="subs-g3" className={H2}>G3 gate · G3 闸门</h2>
        <p className="flex flex-wrap items-center gap-2">
          <span>
            Confirmed now · 当前确认订阅者 <strong className="tabular-nums">{gate.confirmed}</strong> / {G3_CONFIRMED}
          </span>
          <Met ok={gate.confirmed >= G3_CONFIRMED} />
        </p>
        <p className="text-xs text-muted">Active + paused; unsubscribed and suppressed rows don&apos;t count · 订阅中 + 暂停，不含已退订和已抑制</p>
        <div>
          <p className="flex flex-wrap items-center gap-2">
            <span>Two issues in a row, on time, to ≥ {G3_CONFIRMED} · 连续 2 期准时发给 ≥{G3_CONFIRMED} 人</span>
            <Met ok={gate.twoInARow} />
          </p>
          {gate.issues.length === 2 && !gate.consecutive && (
            <p className="text-seal-text">
              Not back-to-back: nothing went out for the week(s) between {gate.issues[1].isoWeek} and {gate.issues[0].isoWeek} · 不连续：
              {gate.issues[1].isoWeek} 和 {gate.issues[0].isoWeek} 之间有周报没有发出
            </p>
          )}
          {gate.issues.length === 0 ? (
            <p className="text-muted">No issue has gone out yet · 还没有发出过周报</p>
          ) : (
            <ul className="divide-y divide-rule">
              {gate.issues.map((i) => <IssueLine key={i.id} i={i} />)}
            </ul>
          )}
          <p className="text-xs text-muted">
            On time = finished within {ON_TIME_MS / 3600_000} h of Sunday 17:00 PT. Bounce and complaint counts come from the Resend webhook, each
            delivery once; rates are of every email the issue delivered (empty notices included), targets &lt; 2% and &lt; 0.1%. Seed bounces
            (bounced, suppressed or failed seed copies) must be 0 · 准时 = 周日 17:00 后 3 小时内发完；退信率、投诉率按本期发出的全部邮件（含空周通知）计算，须 &lt; 2%、&lt; 0.1%；种子退回（退信、被抑制或发送失败）须为 0
          </p>
        </div>
        <p className="text-muted">
          Gmail one-click unsubscribe: check by hand. Subscribe a Gmail seed through the real form, use Gmail&apos;s Unsubscribe on a Sunday
          digest, then look it up below; it should show Unsubscribed · Gmail 一键退订需手动验证：用真实表单订阅 Gmail 种子邮箱，在周日周报里点 Gmail 的退订，再在下面查到它显示「已退订」
        </p>
      </section>

      <section aria-labelledby="subs-optin" className="text-sm">
        <h2 id="subs-optin" className={H2}>Double opt-in rate · 双重确认率（approx · 约）</h2>
        <p className="text-h2 font-display font-semibold tabular-nums">{optIn.rate === null ? '—' : `${Math.round(optIn.rate * 100)}%`}</p>
        <p className="text-muted">
          {optIn.confirmed} confirmed of {optIn.confirmed + optIn.purged + optIn.neverConfirmedOut} sign-ups with an outcome ({optIn.purged} expired
          unconfirmed, {optIn.neverConfirmedOut} left before confirming) · waiting · 待确认 {optIn.pending}, not counted
        </p>
        <p className="mt-1 text-xs text-muted">
          Approximate: expiry counts start in week 13, and deleted rows drop out of both sides · 近似值：过期删除的记录从第 13 周开始才有，已删除的行不再计入
        </p>
      </section>

      <section aria-labelledby="subs-lookup">
        <h2 id="subs-lookup" className={H2}>Find one subscriber · 查找订阅者</h2>
        <SubscriberLookup />
      </section>

      <section aria-labelledby="subs-export" className="space-y-2">
        <h2 id="subs-export" className={H2}>Export · 导出</h2>
        {/* A plain link: the route answers with a file, there is nothing to navigate to. */}
        <a href="/admin/subscribers/export" download className={btn.secondary}>
          Export CSV · 导出 CSV（含邮箱，仅管理员）
        </a>
        <p className="text-xs text-muted">
          Every status, suppressed and unsubscribed included, so a move to another tool never mails them again; no IP address or user agent ·
          包含所有状态（含已抑制、已退订，迁移时不会再给他们发信）；不含 IP 和浏览器信息
        </p>
      </section>
    </div>
  );
}

export default function SubscribersPage() {
  return (
    <Screen title="Subscribers · 订阅者" sub="Counts, one exact lookup, export · 统计、精确查找、导出">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <Subscribers />
      </Suspense>
    </Screen>
  );
}
