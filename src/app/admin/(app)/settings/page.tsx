import { Suspense } from 'react';
import { dropToken, saveDefaults, toggleSwitch } from '@/app/admin/actions';
import { ClearInboxButton } from '@/components/admin/ClearInboxButton';
import { NewTokenForm } from '@/components/admin/NewTokenForm';
import { btn, field, Screen } from '@/components/admin/ui';
import { requireAdmin } from '@/lib/admin-session';
import { listTokens } from '@/lib/api/tokens';
import { publicOrigin } from '@/lib/host';
import { configuredFeeds, FEED_KINDS, feedEnvName } from '@/lib/inbox/sync-ics';
import { readSetting } from '@/lib/settings';

export const metadata = { title: 'Settings' };

function Switch({ name, label, hint, on }: { name: 'show_attendance' | 'official_covers_to_template'; label: string; hint: string; on: boolean }) {
  return (
    <form action={toggleSwitch.bind(null, name, !on)} className="flex items-center justify-between gap-4 py-3">
      <div>
        <p>{label}</p>
        <p className="text-sm text-muted">{hint}</p>
      </div>
      <button role="switch" aria-checked={on} className={`${btn.small} min-w-16 ${on ? 'bg-ink text-paper' : ''}`}>
        {on ? 'On · 开' : 'Off · 关'}
      </button>
    </form>
  );
}

async function Settings() {
  await requireAdmin();
  const [attendance, toTemplate, coverDefault, goingDefault, tokens] = await Promise.all([
    readSetting('show_attendance'), readSetting('official_covers_to_template'), readSetting('cover_policy_default'),
    readSetting('going_visibility_default'), listTokens(),
  ]);
  const api = `${publicOrigin()}/api/ingest`;
  const feeds = new Set(configuredFeeds().map((f) => f.kind));
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-1 font-mono text-xs uppercase text-muted">Kill switches · 总开关（秒级生效）</h2>
        <div className="divide-y divide-rule border-y border-rule">
          <Switch name="show_attendance" label="Show going · 显示「我去不去」" hint="Off hides every seal, /going and going.ics · 关掉后所有印章、/going 与 going.ics 都不显示" on={attendance.on} />
          <Switch name="official_covers_to_template" label="All official covers → template · 官方封面全部换模板" hint="For takedown requests · 收到下架请求时用" on={toTemplate.on} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-mono text-xs uppercase text-muted">Defaults for new events · 新活动的默认值</h2>
        <form action={saveDefaults} className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="coverPolicy" className={field.label}>Cover · 封面</label>
            <select id="coverPolicy" name="coverPolicy" defaultValue={coverDefault.policy} className={field.input}>
              <option value="official">Official first · 官方封面优先</option>
              <option value="template">Template only · 只用模板</option>
            </select>
          </div>
          <div>
            <label htmlFor="goingVisibility" className={field.label}>Going visibility · 会去的可见性</label>
            <select id="goingVisibility" name="goingVisibility" defaultValue={goingDefault.v} className={field.input}>
              <option value="public">Public now · 现在公开</option>
              <option value="after_event">After the event · 活动后公开</option>
              <option value="hidden">Hidden · 不公开</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className={btn.secondary}>Save · 保存</button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 font-mono text-xs uppercase text-muted">API tokens · 令牌</h2>
        {tokens.length > 0 && (
          <ul className="mb-4 divide-y divide-rule border-y border-rule">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className={t.revokedAt ? 'text-muted line-through' : ''}>{t.name}</p>
                  <p className="text-sm text-muted">
                    {t.scopes.join(', ')} · last used {t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never'}
                  </p>
                </div>
                {!t.revokedAt && (
                  <form action={dropToken.bind(null, t.id)}>
                    <button className={btn.small}>Revoke · 吊销</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        <NewTokenForm />
      </section>

      <section className="space-y-3 text-sm">
        <h2 className="font-mono text-xs uppercase text-muted">iOS Shortcuts · 快捷指令</h2>
        <p>Make two shortcuts, “Add to Picks” (token with ingest) and “Add &amp; Publish” (token with ingest + publish) · 做两个快捷指令，各用一个令牌：</p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>快捷指令 App → 新建 → 右上角 ⓘ → 打开「在共享表单中显示」，类型只选 URL 和 Safari 网页。</li>
          <li>加「要求输入」：提示「点评（可跳过）」，类型文本。</li>
          <li>（只在 Add &amp; Publish 里）mode 固定写 publish；Add to Picks 写 draft。</li>
          <li>
            加「获取 URL 内容」：URL 填 <code className="break-all font-mono">{api}</code>，方法 POST，头部
            <code className="font-mono"> Authorization: Bearer 令牌</code>，请求体 JSON：url = 快捷指令输入，comment = 上一步的文本，mode，client = ios-shortcut。
          </li>
          <li>加「从输入中获取词典值」取 title_zh 和 admin_url，再加「显示通知」；点通知可以打开 admin_url。</li>
        </ol>
        <p className="text-muted">Returns 201 draft or published, 202 when the page can’t be read, 409 for a duplicate · 返回 201 已建草稿或已发布，202 读不到页面，409 重复。</p>
      </section>

      <section className="space-y-3 text-sm">
        <h2 className="font-mono text-xs uppercase text-muted">Inbox feeds · 收件箱的私密日历源</h2>
        <ul className="divide-y divide-rule border-y border-rule">
          {FEED_KINDS.map((k) => (
            <li key={k} className="flex items-center justify-between gap-3 py-2">
              <code className="font-mono text-xs">{feedEnvName(k)}</code>
              <span className={feeds.has(k) ? '' : 'text-muted'}>{feeds.has(k) ? 'Set · 已配置' : 'Not set · 未配置'}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted">
          These URLs are secrets: add them in Vercel → Settings → Environment Variables, never here · 这三个地址等同密码，只放 Vercel 环境变量：
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Google Calendar 网页版 → 设置 → 选日历 → 集成日历 → 「iCal 格式的私密地址」。同时把「活动设置 → 将邀请添加到我的日历」设为「来自所有人」。</li>
          <li>Luma → Settings → Calendar Syncing → Add iCal Subscription。</li>
          <li>Partiful（桌面版）→ Calendar sync → Copy Link。</li>
        </ol>
        <p className="text-muted">
          Google Calendar entries only show up when they carry a link · Google 日历里只有带链接的条目才会进收件箱，私人日程不会存。
        </p>
        <p>
          weekly-events skill：建一个名为 <code className="font-mono">weekly-events-skill</code>、权限 candidates 的令牌，先 GET{' '}
          <code className="break-all font-mono">{publicOrigin()}/api/index</code> 跳过已发布的，再 POST 到{' '}
          <code className="break-all font-mono">{api}</code>，body 为 <code className="font-mono">{'{"mode":"candidate","batch":[…]}'}</code>。
        </p>
        <ClearInboxButton />
      </section>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Screen title="Settings · 设置">
      <Suspense fallback={<p className="text-muted">…</p>}>
        <Settings />
      </Suspense>
    </Screen>
  );
}
