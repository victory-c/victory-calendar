import { alertSubject } from '@/lib/alerts/render';
import { dayLabel } from '@/lib/digest/fields';
import { titles } from '@/lib/events/display';
import { PT } from '@/lib/format/date';
import type { DigestMode } from '@/lib/newsletter/status';
import type { LocaleCounts, NextAlert } from '@/lib/subscribers/admin';
import { GOING_LABELS } from '@/lib/taxonomy';
import { Chip } from './ui';

// /admin/subscribers, DESIGN-F20 G15: who has going alerts on, and what the next alert run would
// send if nothing changes before it (the pool read at the run's time), plus the last logged run.
// Counts, titles and codes only: no address, and the pool is the same public rows the email uses.

const H2 = 'mb-1 font-mono text-xs uppercase text-muted';
const fmtPT = (d: Date) =>
  `${new Intl.DateTimeFormat('en-US', { timeZone: PT, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)} PT`;

const MODE: Record<DigestMode, string | null> = {
  off: 'Sending is off: the run claims nothing and the opt-in checkboxes are hidden · 发信未开启：不领取、不发送，订阅勾选框也不显示',
  dev: 'Dev mode: batches are logged, nothing is sent · 开发模式：只写日志，不真正发信',
  live: null,
};
const SKIPPED: Record<string, string> = {
  off: 'sending off · 发信未开启',
  locked: 'another newsletter run was sending · 另一个发信任务在运行',
  digest_day: 'digest day · 周报日',
};

export function NextAlertCard({ on, next, mode }: { on: LocaleCounts; next: NextAlert; mode: DigestMode }) {
  const run = next.lastRun;
  return (
    <section aria-labelledby="subs-alerts" className="space-y-2 rounded-lg border border-rule p-3 text-sm">
      <h2 id="subs-alerts" className={H2}>Next going alert · 下一封会去提醒</h2>
      <p>
        Going alerts on · 开了会去提醒: <strong className="tabular-nums">{on.total}</strong>
        <span className="text-muted"> (EN {on.en} · 中文 {on.zh})</span>
      </p>
      {MODE[mode] && <p className="text-seal-text">{MODE[mode]}</p>}
      <p className="text-muted">
        Next run · 下次运行: {fmtPT(next.runAt)}
        <br />
        Takes marks made before · 收录此前的标记: {fmtPT(next.cutoff)}
      </p>
      {next.digestDay && (
        <p className="text-seal-text">
          A digest goes out that day, so no alert is sent; the next day&apos;s skips what the digest showed · 当天发周报，不发会去提醒；次日的提醒跳过周报里已有的活动
        </p>
      )}
      {next.events.length === 0 ? (
        <p className="text-muted">Nothing to alert · 没有要提醒的活动</p>
      ) : (
        <>
          <ul className="divide-y divide-rule">
            {next.events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
                {e.seal && <Chip tone="seal">{GOING_LABELS[e.seal].zh}</Chip>}
                <span className="min-w-0 flex-1">{titles(e, 'zh').primary}</span>
                <span className="text-muted">{dayLabel(new Date(e.startAt), 'zh')}</span>
              </li>
            ))}
          </ul>
          <p className="text-muted">
            Subject · 主题: {alertSubject(next.events, 'en')} / {alertSubject(next.events, 'zh')}
          </p>
          <p className="text-xs text-muted">
            Each reader gets only the events in their categories and filters, once each, at most one email a day · 每位读者只收到自己类别和筛选内的活动，同一活动只提醒一次，每天最多一封
          </p>
        </>
      )}
      <p className="text-muted">
        {run ? (
          <>
            Last logged run · 上次运行记录: {fmtPT(run.startedAt)}
            {run.day && ` (${run.day})`} · {run.ok === false ? 'failed · 失败' : 'ok'}
            {run.skipped && ` · skipped · 跳过：${SKIPPED[run.skipped] ?? run.skipped}`}
            {` · sent · 发出 ${run.sent + run.replayed} · claimed · 领取 ${run.claimed} · failed rows · 失败 ${run.failed}`}
            {run.reason && ` · ${run.reason}`}
            {run.partial && ' · unfinished, the next run continues · 未完成，下次继续'}
          </>
        ) : (
          'No run logged yet · 还没有运行记录'
        )}
      </p>
    </section>
  );
}
