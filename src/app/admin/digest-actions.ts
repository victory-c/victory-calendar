'use server';

// /admin/digest mutations (M3 week 14). Server Functions bypass proxy.ts, so the one exported
// action calls requireAdmin() first. Like the event editor, every submit of the editor form saves
// the draft first and then runs the button that was pressed (`_op`):
//   save | draft:<en|zh> | approve:<en|zh> | schedule | unschedule | test | send_now
// Content is only editable while the issue is a draft (saveIssue refuses anything else).
import { eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { after } from 'next/server';
import type { ActionState } from '@/app/admin/actions';
import { retranslate } from '@/lib/admin/ai';
import { requireAdmin } from '@/lib/admin-session';
import { db } from '@/lib/db';
import { type digestIssues, jobsLog, subscribers } from '@/lib/db/schema';
import { buildSnapshot } from '@/lib/digest/assemble';
import { cleanIntro as cleanStored, getIssue, saveIssue, scheduleIssue, unscheduleIssue } from '@/lib/digest/issues';
import { personalize, renderEmptyNotice, renderVariant } from '@/lib/digest/render';
import { runDigest, type RunResult } from '@/lib/digest/run';
import type { DigestSnapshot } from '@/lib/digest/types';
import { parseVariantKey, type Variant, variantKey } from '@/lib/digest/variant';
import { LATE_LIMIT_MS } from '@/lib/digest/week';
import { maskEmail, sendEmail } from '@/lib/email/send';
import { PT } from '@/lib/format/date';
import { describeError } from '@/lib/log-safe';
import { digestMode } from '@/lib/newsletter/status';
import { limit } from '@/lib/ratelimit';
import { linksFor } from '@/lib/subscribers/links';
import { normalizeEmail } from '@/lib/subscribers/service';
import { linkToken } from '@/lib/subscribers/token';
import { CATEGORY_SLUGS, type Locale, parseCategories } from '@/lib/taxonomy';

type Issue = typeof digestIssues.$inferSelect;
type Lang = 'en' | 'zh';
type Fields = Pick<Issue, 'introEn' | 'introZh' | 'featuredIds' | 'keepCoverIds' | 'autoFields'>;

// Event ids (evt_… from ingest, seed_… in a seeded dev database); saveIssue checks them against the DB.
const EVENT_ID = /^[\w-]{1,64}$/;
const LANGS: readonly Lang[] = ['en', 'zh'];
/** auto_fields names, same convention as events.auto_fields (note_en, note_zh, …). */
const AUTO: Record<Lang, string> = { en: 'intro_en', zh: 'intro_zh' };
const INTRO_KEY = { en: 'introEn', zh: 'introZh' } as const;
/**
 * Well-formed but matching no subscriber, so a test email's links open the invalid-link page. Same
 * length as a real token, so sizes measured with it are the real sizes.
 */
const TEST_TOKEN = `sub_${'0'.repeat(16)}.${'A'.repeat(43)}`;
const SAVES_FIRST = new Set(['save', 'draft', 'approve', 'schedule', 'test']);
const EDIT_ONLY = new Set(['save', 'draft', 'approve']);

const LOCKED: ActionState = { ok: false, message: 'Locked: unschedule to edit · 已排期或已发送，撤回排期后才能修改' };
const SCHEDULE_ERR: Record<string, string> = {
  not_draft: 'Only a draft can be scheduled · 只有草稿可以排期',
  intro_missing: 'Write both intros first · 先写好中英文开场白',
  unapproved: 'Approve the AI-drafted intro first · 先确认 AI 起草的开场白',
  too_late: 'Too late for this week: the send window has passed · 这一期已经错过发送时间',
};

/**
 * Textareas post CRLF line breaks. Normalised exactly as saveIssue stores them (LF, trimmed, at most
 * 600 characters), so "did this intro change" compares like with like.
 */
const cleanIntro = (v: FormDataEntryValue | string | null | undefined) => (typeof v === 'string' ? cleanStored(v) : null);

/** Checkbox groups only count when their list was on screen (`<name>_present`), else keep the stored ids. */
function idList(fd: FormData, name: string, stored: string[]): string[] {
  if (!fd.has(`${name}_present`)) return stored;
  return [...new Set(fd.getAll(name).map(String).filter((v) => EVENT_ID.test(v)))].slice(0, 50);
}

const fields = (i: Issue): Fields => ({
  introEn: i.introEn, introZh: i.introZh, featuredIds: i.featuredIds, keepCoverIds: i.keepCoverIds, autoFields: i.autoFields,
});

/**
 * The form's values, with the editor's approval rule: changing an AI-drafted intro (including
 * clearing it) counts as approving it, so its auto_fields mark goes. Re-saving the same text doesn't.
 */
function fromForm(issue: Issue, fd: FormData): Fields {
  const introEn = fd.has('introEn') ? cleanIntro(fd.get('introEn')) : issue.introEn;
  const introZh = fd.has('introZh') ? cleanIntro(fd.get('introZh')) : issue.introZh;
  const edited = { intro_en: introEn !== issue.introEn, intro_zh: introZh !== issue.introZh } as Record<string, boolean>;
  return {
    introEn,
    introZh,
    featuredIds: idList(fd, 'featured', issue.featuredIds),
    keepCoverIds: idList(fd, 'keep', issue.keepCoverIds),
    autoFields: issue.autoFields.filter((f) => !edited[f]),
  };
}

/** Order-insensitive for the id lists (checkboxes post in screen order). */
const same = (a: Fields, b: Fields) => {
  const norm = (f: Fields) =>
    JSON.stringify([f.introEn, f.introZh, [...f.featuredIds].sort(), [...f.keepCoverIds].sort(), [...f.autoFields].sort()]);
  return norm(a) === norm(b);
};

const fmtPT = (d: Date) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} PT`;

export async function digestAction(issueId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  await requireAdmin();
  const op = String(fd.get('_op') ?? 'save');
  const [base, arg] = op.split(':') as [string, string | undefined];
  try {
    let issue = await getIssue(issueId);
    if (!issue) return { ok: false, message: 'Issue not found · 找不到这一期' };
    let message = 'No changes · 没有改动';
    if (SAVES_FIRST.has(base) && issue.status === 'draft') {
      const next = fromForm(issue, fd);
      if (!same(next, fields(issue))) {
        const saved = await saveIssue(issue.id, next);
        if (!saved) return LOCKED;
        issue = saved;
        message = 'Saved · 已保存';
      }
    } else if (EDIT_ONLY.has(base)) {
      return LOCKED;
    }

    switch (base) {
      case 'save':
        return { ok: true, message };
      case 'draft':
        return await draftOther(issue, arg);
      case 'approve':
        return await approve(issue, arg);
      case 'schedule':
        return await schedule(issue);
      case 'unschedule':
        return (await unscheduleIssue(issue.id))
          ? { ok: true, message: 'Back to draft · 已撤回排期，可以继续修改' }
          : { ok: false, message: 'Only a scheduled issue can be unscheduled · 只能撤回已排期、还没开始发送的周报' };
      case 'test':
        return await sendTest(issue, fd);
      case 'send_now':
        return sendNow(issue);
      default:
        return { ok: false, message: 'Unknown action · 未知操作' };
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // redirect()
    const text = e instanceof Error ? e.message : '';
    if (text === 'ai_unavailable') return { ok: false, message: 'AI is not set up yet: write both intros · AI 还没配置（checklist 8），请手写两种语言' };
    console.error(`[digest] admin action ${base} failed: ${describeError(e)}`);
    return { ok: false, message: `Something went wrong · 出错了（${describeError(e).slice(0, 120)}）` };
  } finally {
    refresh();
  }
}

/** "Draft the other language": the model writes `to` from the other intro, marked AI until approved. */
async function draftOther(issue: Issue, to: string | undefined): Promise<ActionState> {
  if (!LANGS.includes(to as Lang)) return { ok: false, message: 'Unknown language · 未知语言' };
  const lang = to as Lang;
  const source = lang === 'zh' ? issue.introEn : issue.introZh;
  if (!source) return { ok: false, message: 'Nothing to translate: write the other intro first · 另一种语言还是空的' };
  const out = cleanIntro(await retranslate('intro', source, lang));
  if (!out) return { ok: false, message: 'The model returned nothing · AI 没有给出内容，请手写' };
  const saved = await saveIssue(issue.id, {
    ...fields(issue),
    [INTRO_KEY[lang]]: out,
    autoFields: [...new Set([...issue.autoFields, AUTO[lang]])],
  });
  if (!saved) return LOCKED;
  return { ok: true, message: 'Drafted: check it, then approve · 已起草，检查后点「确认」' };
}

async function approve(issue: Issue, lang: string | undefined): Promise<ActionState> {
  if (!LANGS.includes(lang as Lang)) return { ok: false, message: 'Unknown language · 未知语言' };
  const mark = AUTO[lang as Lang];
  if (!issue.autoFields.includes(mark)) return { ok: true, message: 'Already approved · 已经确认过' };
  const saved = await saveIssue(issue.id, { ...fields(issue), autoFields: issue.autoFields.filter((f) => f !== mark) });
  if (!saved) return LOCKED;
  return { ok: true, message: 'Approved · 已确认' };
}

async function schedule(issue: Issue): Promise<ActionState> {
  const r = await scheduleIssue(issue.id);
  if (!r.ok) return { ok: false, message: SCHEDULE_ERR[r.error] ?? r.error };
  const parts = [`Scheduled for ${fmtPT(r.sendAfter)} · 已排期`];
  if (r.sendAfter.getTime() <= Date.now()) parts.push('already due: press Send now or wait for the next run · 已到发送时间，可点「立即发送」或等下一次定时任务');
  if (digestMode() === 'off') parts.push("no verified sender, so it won't actually send · 发信域名未验证，不会真正发出");
  return { ok: true, message: parts.join(' · ') };
}

/** The variant being previewed (hidden fields), defaulting to Chinese with every category. */
function testVariant(fd: FormData): Variant {
  const locale: Locale = fd.get('test_locale') === 'en' ? 'en' : 'zh';
  const cats = parseCategories(String(fd.get('test_cats') ?? ''));
  return parseVariantKey(variantKey(locale, cats.length ? cats : CATEGORY_SLUGS)) as Variant;
}

/**
 * Links in a test email: the admin's own subscriber row if there is one, else TEST_TOKEN. Without
 * RESEND_API_KEY sendEmail writes the text (links included) to the server log, so a real token is
 * never used then.
 */
async function testToken(email: string): Promise<string> {
  if (!process.env.RESEND_API_KEY) return TEST_TOKEN;
  const [row] = await db
    .select({ id: subscribers.id, tokenVersion: subscribers.tokenVersion })
    .from(subscribers)
    .where(eq(subscribers.email, email))
    .limit(1);
  if (!row) return TEST_TOKEN;
  try {
    return linkToken(row);
  } catch {
    return TEST_TOKEN; // no SUBSCRIBER_LINK_SECRET
  }
}

/**
 * Test send (spec item 30): to ADMIN_EMAIL only, never a typed-in address; the same render and
 * headers as the real send; subject prefixed; no digest_sends row; at most 10 a day.
 */
async function sendTest(issue: Issue, fd: FormData): Promise<ActionState> {
  const to = normalizeEmail(process.env.ADMIN_EMAIL);
  if (!to) return { ok: false, message: 'ADMIN_EMAIL is not set · 没有配置 ADMIN_EMAIL' };
  const variant = testVariant(fd);
  const snap = (issue.snapshot as DigestSnapshot | null) ?? (await buildSnapshot(issue));
  const email = (await renderVariant(snap, variant)) ?? (await renderEmptyNotice(snap, variant));
  // Counted only once the email rendered, so a render error doesn't use up the day's tests.
  if (!(await limit('digestTest', 'admin')).success) {
    return { ok: false, message: 'Daily test limit reached (10) · 今天的测试邮件已达 10 封上限' };
  }
  const token = await testToken(to);
  const mail = personalize(email, token);
  const links = linksFor(variant.locale, token, snap.origin);
  await sendEmail({
    to,
    subject: `${variant.locale === 'zh' ? '[测试] ' : '[Test] '}${mail.subject}`,
    html: mail.html,
    text: mail.text,
    headers: {
      'List-Unsubscribe': `<${links.oneClick}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      'X-Entity-Ref-ID': issue.id,
    },
    // Not kind=digest: the webhook must never mark a digest_sends row or suppress anyone over a test.
    tags: [{ name: 'kind', value: 'digest_test' }, { name: 'issue', value: issue.id }],
  });
  return process.env.RESEND_API_KEY
    ? { ok: true, message: `Test sent to ${maskEmail(to)} · 测试邮件已发出` }
    : { ok: true, message: 'No RESEND_API_KEY: written to the server log · 未配置 Resend，已写入服务器日志' };
}

/**
 * "Send now" for a missed or late window: only a scheduled issue that is due (and not past the
 * 27 h limit) or one already sending. The run goes on after the response (page maxDuration 300);
 * claims make it safe next to a cron run.
 */
function sendNow(issue: Issue): ActionState {
  const now = Date.now();
  const due =
    issue.status === 'sending' ||
    (issue.status === 'scheduled' && issue.sendAfter !== null && issue.sendAfter.getTime() <= now && now < issue.sendAfter.getTime() + LATE_LIMIT_MS);
  if (!due) return { ok: false, message: 'Not due: only a scheduled issue past its send time, or one already sending · 还不能发：只有到点的已排期周报或正在发送的可以' };
  if (digestMode() === 'off') return { ok: false, message: "No verified sender: nothing would send · 发信域名未验证，不会真正发出" };
  after(runAndLog);
  return { ok: true, message: 'Sending in the background; refresh in a minute · 正在后台发送，一分钟后刷新查看' };
}

const NO_OP: readonly RunResult['skipped'][] = ['nothing_due', 'locked', 'no_verified_sender'];

/** Same jobs_log rule as the cron route: a row for any run that touched an issue or failed. Counts only. */
async function runAndLog() {
  const startedAt = new Date();
  try {
    const r = await runDigest();
    if (!r.ok || r.issue || r.closed?.length || r.tooLate?.length || !NO_OP.includes(r.skipped)) {
      await db.insert(jobsLog).values({ job: 'digest', startedAt, finishedAt: new Date(), ok: r.ok, detail: { trigger: 'admin', ...r } });
    }
  } catch (e) {
    console.error(`[digest] send now failed: ${describeError(e)}`);
    await db
      .insert(jobsLog)
      .values({ job: 'digest', startedAt, finishedAt: new Date(), ok: false, detail: { trigger: 'admin', error: e instanceof Error ? e.name : 'unknown' } })
      .catch(() => undefined);
  }
}
