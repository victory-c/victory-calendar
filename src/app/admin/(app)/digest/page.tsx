import { createHash } from 'node:crypto';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { DigestEditor, type DigestEditorEvent, type SeedInfo } from '@/components/admin/DigestEditor';
import { type AudienceRow, DigestPreview, type DigestWarning, type PreviewRender } from '@/components/admin/DigestPreview';
import { Chip, Screen } from '@/components/admin/ui';
import { WeChatExport, type WeChatExportProps } from '@/components/admin/WeChatExport';
import { requireAdmin } from '@/lib/admin-session';
import type { digestIssues } from '@/lib/db/schema';
import { buildSnapshot, lumaCoverChoices } from '@/lib/digest/assemble';
import { audience, ensureIssue, getIssueByWeek, listIssues } from '@/lib/digest/issues';
import { MAX_HTML_BYTES, personalize, renderEmptyNotice, renderVariant } from '@/lib/digest/render';
import { dailyCapFromEnv } from '@/lib/digest/run';
import { seedCoverage, seedEmails } from '@/lib/digest/seeds';
import type { DigestSnapshot } from '@/lib/digest/types';
import { parseVariantKey, type Variant, variantKey } from '@/lib/digest/variant';
import { type LiveRow, liveState, wechatText } from '@/lib/digest/wechat';
import { coverage, LATE_LIMIT_MS, sendAfterFor, upcomingIssueWeek } from '@/lib/digest/week';
import { maskEmail } from '@/lib/email/send';
import { titles } from '@/lib/events/display';
import { publicEvents } from '@/lib/events/public-rows';
import type { PublicEvent } from '@/lib/events/types';
import { fmtRange, PT } from '@/lib/format/date';
import { publicOrigin } from '@/lib/host';
import { aiConfigured } from '@/lib/ingest/extract';
import { describeError } from '@/lib/log-safe';
import { digestMode, hasVerifiedSender, newsletterStatus } from '@/lib/newsletter/status';
import { readSetting, showAttendance } from '@/lib/settings';
import { normalizeEmail } from '@/lib/subscribers/service';
import { CATEGORIES, CATEGORY_SLUGS, isCategory, type Locale } from '@/lib/taxonomy';
import { renderPerEmail } from './audience';

export const metadata = { title: 'Digest' };
// "Send now" runs the digest after its Server Action responds (after()), inside this route's limit.
export const maxDuration = 300;

type Issue = typeof digestIssues.$inferSelect;
type Search = { w?: string | string[]; l?: string | string[]; c?: string | string[] };

const WEEK = /^\d{4}-W\d{2}$/;
/** Same shape and length as a real link token, matching no subscriber (see digest-actions.ts). */
const PREVIEW_TOKEN = `sub_${'0'.repeat(16)}.${'A'.repeat(43)}`;
/**
 * Distinct emails rendered for the audience list (a few ms each, repeated after every editor action).
 * Variants with the same email share one render, so this is rarely reached; past it, rows say so.
 */
const AUDIENCE_RENDER_LIMIT = 64;
const STATUS: Record<Issue['status'], string> = {
  draft: 'Draft · 草稿',
  scheduled: 'Scheduled · 已排期',
  sending: 'Sending · 发送中',
  sent: 'Sent · 已发送',
};

const fmtPT = (d: Date) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} PT`;
const fmtWeek = (from: Date, to: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: PT, month: 'short', day: 'numeric' }).formatRange(from, new Date(to.getTime() - 1));
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isMissed = (i: Pick<Issue, 'status' | 'sendAfter'>, now: Date) =>
  i.status === 'scheduled' && i.sendAfter !== null && now.getTime() >= i.sendAfter.getTime() + LATE_LIMIT_MS;
const variantLabel = (v: Variant) => `${v.locale === 'zh' ? '中文' : 'EN'} · ${v.categories.map((c) => CATEGORIES[c][v.locale]).join(v.locale === 'zh' ? '、' : ', ')}`;
const eventTitle = (e: Pick<PublicEvent, 'titleEn' | 'titleZh'>) => {
  const t = titles(e, 'zh');
  return t.secondary ? `${t.primary} · ${t.secondary}` : t.primary;
};
const editorEvent = (e: PublicEvent): DigestEditorEvent & { tag: string } => ({
  id: e.id, title: eventTitle(e), when: fmtRange(e.startAt, e.endAt, 'zh', PT), tag: CATEGORIES[e.category].zh,
});

function previewVariant(sp: Search): Variant {
  const l = first(sp.l);
  const locale: Locale = l === 'en' ? 'en' : 'zh';
  const raw = sp.c === undefined ? [] : Array.isArray(sp.c) ? sp.c : [sp.c];
  const cats = raw.flatMap((c) => c.split(',')).filter(isCategory);
  return parseVariantKey(variantKey(locale, cats.length ? cats : CATEGORY_SLUGS)) as Variant;
}

type Live = { rows: LiveRow[]; show: boolean };

/**
 * A frozen issue's events as they are now and the attendance switch now, so its WeChat text follows
 * takedowns, cancellations, going visibility and the kill switch, as the /weekly archive does (D8).
 */
async function liveFor(snap: DigestSnapshot): Promise<Live> {
  const ids = [...new Set([...snap.events, ...snap.preview].map((e) => e?.id).filter((id): id is string => typeof id === 'string'))];
  const [rows, attendance] = await Promise.all([publicEvents({ ids }), showAttendance()]);
  return { rows, show: attendance === true }; // a malformed settings row hides attendance rather than showing it
}

/**
 * The WeChat text: Chinese, every category, the public origin of today (not the snapshot's) and the
 * subscribe link only while sign-ups are open. Independent of the preview's ?l=&c= choice. `live`
 * is set for a frozen snapshot (sending or sent issues); a draft's is assembled live already.
 */
function wechatFor(snap: DigestSnapshot | string, issue: Issue, live: Live | string | null, now: Date): WeChatExportProps {
  const introDrafted = issue.autoFields.includes('intro_zh');
  if (typeof snap === 'string') return { text: null, error: `assembly failed: ${snap}`, introDrafted };
  if (typeof live === 'string') return { text: null, error: `live events failed: ${live}`, introDrafted };
  try {
    const cur = live ? liveState(snap, live.rows, now, live.show) : { snap, cancelled: undefined };
    const t = wechatText(cur.snap, { origin: publicOrigin(), subscribe: newsletterStatus() === 'open', cancelled: cur.cancelled });
    return { text: t?.text ?? null, error: null, introDrafted };
  } catch (e) {
    return { text: null, error: describeError(e), introDrafted };
  }
}

/** Seed inboxes by domain only (the addresses never reach the page), and why sending is off. */
function seedInfo(): SeedInfo {
  const seeds = seedEmails();
  const verified = hasVerifiedSender();
  return {
    ...seedCoverage(seeds.emails),
    count: seeds.emails.length,
    ignored: seeds.invalid + seeds.extra,
    ready: verified && seeds.emails.length > 0,
    reason: !verified
      ? 'Needs the verified mail.<domain> sender (checklist 1) · 需要先验证发信域名'
      : seeds.emails.length === 0
        ? 'DIGEST_SEED_EMAILS is not set · 没有配置种子邮箱'
        : null,
  };
}

async function renderFor(snap: DigestSnapshot, v: Variant): Promise<PreviewRender> {
  try {
    const email = await renderVariant(snap, v);
    const r = email ?? (await renderEmptyNotice(snap, v));
    const mail = personalize(r, PREVIEW_TOKEN); // sizes count after personalisation
    return {
      ok: true, empty: !email, subject: mail.subject, preheader: r.preheader, html: mail.html, text: mail.text,
      bytes: Buffer.byteLength(mail.html, 'utf8'), picks: r.picks, going: r.going,
    };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

/**
 * Which issue to show: ?w= (an issue that already exists), else the upcoming one, or the week
 * after it once the upcoming one is sent. Opening the page creates the draft rows it shows.
 */
async function pickIssue(sp: Search, now: Date): Promise<Issue | null> {
  const upcoming = await ensureIssue(upcomingIssueWeek(now));
  const w = first(sp.w);
  if (w && WEEK.test(w)) return w === upcoming.isoWeek ? upcoming : ((await getIssueByWeek(w)) ?? null);
  if (upcoming.status === 'sent') return ensureIssue(coverage(upcoming.isoWeek).previewWeek);
  return upcoming;
}

async function Digest({ searchParams }: { searchParams: Promise<Search> }) {
  await requireAdmin();
  await connection();
  const sp = await searchParams;
  const now = new Date();
  const issue = await pickIssue(sp, now);
  if (!issue) {
    return (
      <p className="py-10 text-center text-muted">
        No issue for that week · 没有这一期 · <Link href="/admin/digest" className="underline">Back · 返回</Link>
      </p>
    );
  }

  const cov = coverage(issue.isoWeek);
  const frozen = (issue.snapshot as DigestSnapshot | null) ?? null;
  const [snap, live, weekEvents, nextEvents, toTemplate, lumaCovers, groups, recent] = await Promise.all([
    frozen ? Promise.resolve(frozen) : buildSnapshot(issue).catch((e: unknown) => describeError(e)),
    frozen ? liveFor(frozen).catch((e: unknown) => describeError(e)) : null,
    publicEvents({ from: cov.from, to: cov.to, statuses: ['published'] }),
    publicEvents({ from: cov.to, to: cov.previewTo, statuses: ['published'] }),
    readSetting('official_covers_to_template'),
    lumaCoverChoices(issue),
    audience(),
    listIssues(8),
  ]);
  const mode = digestMode();
  const allToTemplate = toTemplate.on;
  const variant = previewVariant(sp);
  const dailyCap = dailyCapFromEnv();
  const eligible = groups.reduce((n, g) => n + g.count, 0);
  const sendAfter = issue.sendAfter ?? sendAfterFor(issue.isoWeek);
  const tooLate = now.getTime() >= sendAfterFor(issue.isoWeek).getTime() + LATE_LIMIT_MS;
  const canSendNow =
    issue.status === 'sending' ||
    (issue.status === 'scheduled' && sendAfter.getTime() <= now.getTime() && !isMissed(issue, now));

  // Preview of the chosen variant, plus a subject/size line for each audience variant (one render
  // per distinct email, reusing the preview's when it is the same email).
  const ready = typeof snap === 'string' ? null : snap;
  const result: PreviewRender = ready ? await renderFor(ready, variant) : { ok: false, error: `assembly failed: ${snap}` };
  const sorted = [...groups].sort((a, b) => b.count - a.count || a.variant.key.localeCompare(b.variant.key));
  const rendered = ready
    ? await renderPerEmail(ready, sorted.map((g) => g.variant), (v) => renderFor(ready, v), { limit: AUDIENCE_RENDER_LIMIT, known: [[variant, result]] })
    : [];
  const audienceRows: AudienceRow[] = sorted.map((g, i) => {
    const r = rendered[i];
    const q = new URLSearchParams({ w: issue.isoWeek, l: g.variant.locale, c: g.variant.categories.join(',') });
    return {
      key: g.variant.key, label: variantLabel(g.variant), count: g.count, href: `/admin/digest?${q}`,
      subject: r?.ok ? r.subject : null, bytes: r?.ok ? r.bytes : null, empty: r?.ok ? r.empty : false,
      error: r && !r.ok ? r.error : null,
    };
  });

  // What to fix before scheduling.
  const warnings: DigestWarning[] = [];
  if (issue.status === 'draft') {
    if (!issue.introEn || !issue.introZh) warnings.push({ text: 'Both intros are needed to schedule · 排期需要中英文两段开场白' });
    if (issue.autoFields.length) warnings.push({ text: 'An AI-drafted intro is waiting for approval · 有 AI 起草的开场白还没确认' });
    if (tooLate) warnings.push({ text: 'Too late to schedule this week: the send window has passed · 这一期已经错过发送时间' });
  }
  if (ready) {
    if (ready.events.length === 0) {
      warnings.push({ text: "No published events this week: no digest goes out; subscribers get at most one 'nothing this week' notice a month · 本周没有已发布的活动：不发周报，订阅者每月最多收到一封「本周没有想推荐的」" });
    }
    // Preview rows show no note, so only the covered week counts.
    const gaps = ready.events.filter((e) => !e.noteEn || !e.noteZh);
    if (gaps.length) {
      warnings.push({
        text: `${gaps.length} event(s) miss a note in one language; the email shows the other · ${gaps.length} 条活动缺一种语言的点评，邮件会显示另一种语言`,
        events: gaps.map((e) => ({ id: e.id, title: eventTitle(e) })),
      });
    }
  }
  const noCover = weekEvents.filter((e) => !e.cover);
  if (noCover.length) {
    warnings.push({
      text: `${noCover.length} event(s) have no cover; the email uses the template · ${noCover.length} 条活动没有封面，邮件用模板封面`,
      events: noCover.map((e) => ({ id: e.id, title: eventTitle(e) })),
    });
  }
  // A variant that fails to render (or is close to Gmail's clipping limit) would leave its readers
  // without this week's email: say so before scheduling.
  const failing = audienceRows.filter((r) => r.error);
  if (failing.length || (!result.ok && ready)) {
    warnings.push({
      text: `${failing.length || 1} email version(s) fail to render; those subscribers would get nothing · ${failing.length || 1} 个邮件版本渲染失败，这些订阅者这周会收不到`,
    });
  }
  const heavy = audienceRows.filter((r) => r.bytes !== null && r.bytes > 0.85 * MAX_HTML_BYTES);
  if (heavy.length) {
    warnings.push({
      text: `${heavy.length} email version(s) are over 85% of the 90 KB limit; trim notes or events · ${heavy.length} 个邮件版本超过 90 KB 上限的 85%，请精简点评或活动`,
    });
  }
  if (eligible > dailyCap) {
    warnings.push({
      text: `${eligible} eligible but at most ${dailyCap} digests go out per UTC day; the rest go with the next runs (within 27 h) · ${eligible} 位订阅者，每天最多发 ${dailyCap} 封，其余顺延到之后的定时任务（27 小时内）`,
    });
  }

  const nextIds = new Set(nextEvents.map((e) => e.id));
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const version = createHash('sha256')
    .update(JSON.stringify([issue.status, issue.introEn, issue.introZh, issue.featuredIds, issue.keepCoverIds, issue.autoFields]))
    .digest('base64url')
    .slice(0, 16);
  const summary = recent.find((r) => r.id === issue.id);

  return (
    <div className="space-y-8">
      {mode === 'off' && (
        <p role="note" className="rounded-lg border border-seal px-3 py-2 text-sm text-seal-text">
          发信域名未验证：排期的周报不会真正发出 / No verified sender: scheduled issues won&apos;t actually send
        </p>
      )}
      {mode === 'dev' && (
        <p role="note" className="rounded-lg border border-rule px-3 py-2 text-sm text-muted">
          Local mode: digest runs are logged, not mailed · 本地模式：周报发送只写服务器日志
        </p>
      )}

      <section aria-label="Status · 状态" className="space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <Chip tone={issue.status === 'draft' ? 'muted' : 'seal'}>{STATUS[issue.status]}</Chip>
          {isMissed(issue, now) && <Chip tone="seal">Missed · 已错过</Chip>}
          <span className="font-mono text-sm">{issue.isoWeek}</span>
          <span className="text-sm text-muted">covers · 覆盖 {fmtWeek(cov.from, cov.to)}</span>
        </p>
        <p className="text-sm text-muted">
          {issue.status === 'draft'
            ? `Goes out ${fmtPT(sendAfter)} once scheduled · 排期后在这个时间发出`
            : issue.status === 'scheduled'
              ? `Sends ${fmtPT(sendAfter)} · 将在这个时间发出`
              : issue.status === 'sending'
                ? `Sending since ${fmtPT(sendAfter)} · 发送中`
                : `Sent ${issue.sentAt ? fmtPT(issue.sentAt) : ''} · 已发送`}
          {summary && issue.status !== 'draft' ? ` · sent ${summary.counts.sent} · failed ${summary.counts.failed} · claimed ${summary.counts.claimed}` : ''}
        </p>
      </section>

      {/* Keyed by issue: an action's message must not carry over to another week (?w=). */}
      <DigestEditor
        key={issue.id}
        issueId={issue.id}
        version={version}
        status={issue.status}
        previewWeek={cov.previewWeek}
        introEn={issue.introEn ?? ''}
        introZh={issue.introZh ?? ''}
        autoFields={issue.autoFields}
        featured={nextEvents.map((e) => ({ ...editorEvent(e), onSite: e.featured, checked: issue.featuredIds.includes(e.id) }))}
        staleFeatured={issue.featuredIds.filter((id) => !nextIds.has(id)).length}
        luma={lumaCovers.map((c) => ({ id: c.id, title: eventTitle(c), when: fmtRange(new Date(c.startAt), null, 'zh', PT), kept: c.kept }))}
        allToTemplate={allToTemplate}
        canSendNow={canSendNow}
        modeOff={mode === 'off'}
        aiReady={aiConfigured()}
        test={{ locale: variant.locale, categories: variant.categories.join(','), label: variantLabel(variant) }}
        adminEmail={adminEmail ? maskEmail(adminEmail) : null}
        seed={seedInfo()}
        weeklyLink={Boolean(ready && ready.events.length > 0)}
      />

      <WeChatExport {...wechatFor(snap, issue, live, now)} />

      <DigestPreview
        week={issue.isoWeek}
        locale={variant.locale}
        categories={variant.categories}
        result={result}
        maxBytes={MAX_HTML_BYTES}
        audience={audienceRows}
        eligible={eligible}
        dailyCap={dailyCap}
        warnings={warnings}
        frozen={Boolean(frozen)}
      />

      <section aria-labelledby="digest-recent">
        <h2 id="digest-recent" className="mb-1 font-mono text-xs uppercase text-muted">Recent issues · 往期</h2>
        <ul className="divide-y divide-rule border-y border-rule text-sm">
          {recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
              <Link href={`/admin/digest?w=${r.isoWeek}`} aria-current={r.id === issue.id ? 'page' : undefined} className="font-mono underline underline-offset-2 aria-[current=page]:no-underline">
                {r.isoWeek}
              </Link>
              <span className={isMissed(r, now) ? 'text-seal-text' : 'text-muted'}>
                {isMissed(r, now) ? 'Missed · 已错过' : STATUS[r.status]}
                {r.sendAfter ? ` · ${fmtPT(r.sendAfter)}` : ''}
                {r.status !== 'draft' ? ` · sent ${r.counts.sent} · failed ${r.counts.failed} · claimed ${r.counts.claimed}` : ''}
                {/* The public archive (D7: live from the moment an issue starts sending, if it has
                    events); a week with none has only the plain week page, as its emails link. */}
                {(r.status === 'sending' || r.status === 'sent') && (
                  <>
                    {' · '}
                    <a href={`/${r.archivable ? 'weekly' : 'week'}/${r.isoWeek}`} target="_blank" rel="noopener" className="underline underline-offset-2">
                      {r.archivable ? 'public page · 存档页 ↗' : 'week page · 本周页面 ↗'}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function DigestPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <Screen title="Digest · 周报" sub="Weekly email, sent Sunday 17:00 PT · 每周日 17:00（太平洋时间）发出">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <Digest searchParams={searchParams} />
      </Suspense>
    </Screen>
  );
}
