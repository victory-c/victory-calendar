# 实现指南 · Implementation Guide

2026-09-27 · Victor Chun

## 结论先行：推荐的技术栈与 MVP 工期估计

推荐栈一行：Next.js 16.3.6（App Router、`src/proxy.ts`、next-intl 4.14.7）+ Neon Postgres（Drizzle ORM 0.45.3）+ Better Auth 1.7.6（magic link 引导、passkey 常驻）+ Resend 6.30.0 Batch API + ical-generator 11.1.1 + AI SDK 7.0.118（经 Vercel AI Gateway 调 anthropic/claude-haiku-4.5）+ sharp 0.35.5 与 Vercel Blob 2.8 做封面管线。代码放在独立私有仓库 `victory-c/victor-picks`，部署为独立 Vercel Hobby 项目，挂在 Victor 自购域名的 `picks.<domain>` 子域，不并入 victorchun-site（后者按自己的节奏升到 16.3.7）。

MVP 定义为 M0 到 M3（Victor 独用到 newsletter 软上线，2027-01-17），含公开站、专属后台、手机快速添加、封面管线、候选收件箱 P0 和 newsletter，约 100–130 小时（估算），按每周 10–15 小时排 16 周。域名购买和 Resend 发信域名验证都在关键路径上，第一周就要办。

## 技术选型：每一层的选择、理由、替代方案与成本

每一层都选了 Vercel Marketplace 能一键注入、且在 Hobby 免费额度内的方案，付费点只有域名和订阅者超过约 90 人（或开启 Gmail 转发）后的 Resend Pro。

| 层 | 选择 | 理由 | 备选 | 成本 |
|---|---|---|---|---|
| 托管 | Vercel Hobby 独立项目，Node 22，Fluid compute 上限 300 s | 与 victorchun-site 同平台，Marketplace 自动注入 Neon、Resend、Upstash 变量；自定义域名是 Resend 和大陆可达性的前提 [Functions 限制](https://vercel.com/docs/functions/limitations) | Cloudflare Pages + Workers | $0；商业化后 Pro $20/月；域名约 $12–20/年（估算） |
| 框架 | Next.js 16.3.6，2026-09-30 后升 16.3.7；Turbopack、React 19.2、TypeScript strict、pnpm | 16.2.x 在 GHSA-vcvr-r3jv-pc5j 影响范围内 [安全公告](https://nextjs.org/blog/nextjs-security-update-september-22-2026)；middleware.ts 已改名 proxy.ts [proxy 文档](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) | Astro | $0 |
| i18n | next-intl 4.14.7，locales en 与 zh，localePrefix as-needed | 官方文档覆盖 Next 16 的 proxy.ts 与 next/root-params [next-intl 文档](https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing) | 手写字典 | $0 |
| 数据库 | Neon Postgres Free + drizzle-orm 0.45.3 + drizzle-kit 0.31.11 + @neondatabase/serverless 1.1.0 | 0.5 GB、100 CU 小时，缩容到零但不暂停，每个 PR 一个预览分支 [Neon 定价](https://neon.com/pricing) | Supabase Free（1 周不活动即暂停）；Drizzle 1.0 rc | $0 |
| 后台鉴权 | Better Auth 1.7.6 magic-link + @better-auth/passkey，before hook 只放行 Victor 的邮箱 | passkey 让手机 PWA 常驻登录；单用户白名单不需付费 [passkey 插件](https://www.better-auth.com/docs/plugins/passkey) | Clerk（白名单需 Pro $25/月） | $0 |
| 邮件 | Resend 6.30.0 SDK，Batch API 每次 100 封；react-email 6.11（从 react-email 导入组件） | 逐封写 List-Unsubscribe 头；Broadcast 一次只带一个 segment 和一个 topic，做不到按人分语言乘类别 [Batch API](https://resend.com/docs/api-reference/emails/send-batch-emails) | Kit Free；Buttondown | Free 每天 100 封（收信也计数）；约 90 活跃订阅者或开启 Gmail 转发后 Pro $20/月 |
| 日历 feed | ical-generator 11.1.1 + @touch4it/ical-timezones | 能写 VTIMEZONE 与 REFRESH-INTERVAL，ics 包写不了 TZID [ical-generator](https://github.com/sebbo2002/ical-generator) | ics 3.12 | $0 |
| AI 抽取与翻译 | AI SDK 7.0.118 generateText + Output.object（zod 4.6.5），经 AI Gateway；默认 anthropic/claude-haiku-4.5，重译用 anthropic/claude-sonnet-4.6 | 一个 schema 同时填中文标题、摘要、类别与置信度 [结构化输出](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)；Gateway 对 token 不加价 [Gateway 定价](https://vercel.com/docs/ai-gateway/pricing) | 直连 Anthropic SDK | 约 $0.5–2/月（估算），需绑支付方式 |
| 链接元数据 | 自写 undici 加固抓取器 + cheerio + Luma、Partiful、Eventbrite、Meetup 适配器；通用路径用 metascraper 5.58.1 规则 | 四个平台的活动页都服务端渲染了 schema.org Event JSON-LD，已实测 [Luma 活动页](https://luma.com/g42o84ln) | open-graph-scraper 6.12；Luma API（需 Luma Plus） | $0 |
| 图片处理与存储 | sharp 0.35.5 + thumbhash 0.1.1 → @vercel/blob 2.8 → next/image 单一 remotePattern；next/og 出模板封面与 OG 图 | 复制而非热链；预切尺寸让 Image Optimization 留在 Hobby 每月 5k 次内 [Blob 定价](https://vercel.com/docs/vercel-blob/usage-and-pricing) | Cloudflare R2 | Hobby 内 $0（1 GB，每月 2k 次高级操作） |
| 兜底封面来源（P1，M4） | Openverse API（仅 cc0、by、by-sa）→ AI SDK generateImage（recraft/recraft-v4.1-flash $0.007，bfl/flux-pro-1.1 $0.04）→ Brave Image Search 只作人工候选 | Bing 图片搜索 2025-08-11 退役；Google Custom Search 不接新客户 [Brave Search API](https://brave.com/search/api/) | SerpAPI 每月 250 次免费 | 约 $0–2/月（估算） |
| 手机快速添加 | iOS 快捷指令（分享菜单 → POST /api/ingest）；Android 已安装 PWA 的 share_target；PWA 内粘贴 | iOS Safari 不支持 Web Share Target（BCD safari_ios: false） [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json) | 原生 iOS App | $0 |
| 候选收件箱同步 | P0：Google Calendar 私密 iCal + Luma、Partiful 个人 ICS（node-ical 0.27.2）+ weekly-events 推送；P1：Gmail 过滤转发 → Resend Inbound；P2：Google OAuth | 不碰 OAuth 同意屏，没有 Testing 状态 7 天 token 过期和受限 scope 的风险 [OAuth 2.0 文档](https://developers.google.com/identity/protocols/oauth2) | Apps Script 桥；Cloudflare Email Workers | $0 |
| 限流与防刷 | Upstash Redis Free + @upstash/ratelimit 2.2（兼做 cron 锁）；Vercel BotID Basic；蜜罐字段；1 条 Hobby WAF 规则 | 保护 Resend 每天 100 封的配额 [BotID](https://vercel.com/docs/botid) | Cloudflare Turnstile | $0 |
| 定时任务 | Vercel Cron（Hobby 每天一次，误差 ±59 分）+ after() + 幂等行 | Vercel 不重试 cron，必须幂等 [Cron 定价](https://vercel.com/docs/cron-jobs/usage-and-pricing) | GitHub Actions cron | $0 |
| 日期时区 | date-fns 4.4 + @date-fns/tz 1.5 + Intl.DateTimeFormat | Temporal 还没进稳定版 Safari | temporal-polyfill 1.0.5 | $0 |
| 样式与动效 | Tailwind CSS 4.3.3 @theme OKLCH token；公开站组件手写；shadcn 4.21 仅用于 /admin；motion 13.4 m + LazyMotion；React ViewTransition | 编辑感界面需要定制 EventCard 与 GoingBadge [Tailwind theme](https://tailwindcss.com/docs/theme) | schedule-x；FullCalendar | $0 |
| 字体 | Fraunces、Geist、Geist Mono；Noto Serif SC 600、Noto Sans SC 400、LXGW WenKai 400 用 cn-font-split 切片后自托管 | next/font/google 没有 chinese-simplified 子集 [讨论 #47309](https://github.com/vercel/next.js/discussions/47309)；Noto Sans SC 全量 17.8 MB [Google Fonts 元数据](https://fonts.google.com/metadata/fonts/Noto%20Sans%20SC) | Google Fonts CSS2 切片（大陆可达性未核实） | $0（OFL） |
| 合规 | 双语 /privacy；同意日志；默认关闭打开与点击追踪；邮件保持非商业（无广告、无赞助），不放邮寄地址 | CAN-SPAM 的邮寄地址要求只针对商业邮件，非商业周报不放地址；商业化时先补一个非住宅地址 | 商业化后用虚拟邮箱地址 | $0 |
| 测试与分析 | Vitest + Playwright + react-email 快照 + Lighthouse CI；Vercel Web Analytics Hobby + 数据库记录转化 | 未文档化的标记与链接格式最脆弱，需 fixture 测试 | Plausible | $0 |

## 系统架构

架构的核心是一条共用的 ingest 管线：手机快捷指令、后台 Add 页、候选收件箱、weekly-events skill 都只调 `POST /api/ingest`，它负责抓页面、AI 补全、写 Neon，并在 `after()` 里跑封面管线；发布后 Server Action 调 `updateTag('events')`（Route Handler 与 after() 里调 `revalidateTag('events', { expire: 0 })`）让公开站、RSS 与 ICS 在几秒内更新。

> 图见 Claude 文档中的交互式图表；下面是图的内容规格。

```text
标题：所有录入路径共用一条 ingest 管线，Neon 是唯一事实源。

泳道（从左到右）：A 输入端（Victor）；B 应用（Vercel 项目 victor-picks）；C 存储与外部服务；D 访客端。

节点：
- iphone [A] 「iOS 快捷指令」 body: 分享菜单 → POST /api/ingest; Bearer vp_ 令牌
- admin [A] 「后台 PWA /admin」 body: passkey 登录; Add、Drafts、Inbox、Settings
- skill [A] 「weekly-events skill」 body: 继续写 Notion; 末步推送候选
- gcal [A] 「私密 iCal 三条」 body: Google Calendar、Luma、Partiful
- gmail [A] 「Gmail 过滤转发 (P1)」 body: → Resend Inbound webhook
- ingest [B] 「/api/ingest」 body: 归一化、去重、加固抓取; AI SDK 结构化补全
- cover [B] 「封面管线 after()」 body: 官方 → 组合 → 模板; sharp + thumbhash
- inbox [B] 「候选收件箱」 body: node-ical 解析; 勾选 → ingest
- cron [B] 「Vercel Cron 每日」 body: sync 13:00 UTC; digest 01:00 与 02:00 UTC
- site [B] 「公开站 ISR」 body: 首页、详情、月历; cacheTag('events')
- feeds [B] 「ICS 与 RSS handlers」 body: s-maxage 900
- neon [C] 「Neon Postgres」 body: events、covers、subscribers; candidates、settings、digest_sends
- blob [C] 「Vercel Blob」 body: 封面 1600、800、400; OG 1200×630 双语
- upstash [C] 「Upstash Redis」 body: 限流; cron 锁
- gateway [C] 「Vercel AI Gateway」 body: claude-haiku-4.5; 图像生成兜底 (P1)
- resend [C] 「Resend」 body: Batch API 发信; webhooks 回写
- visitors [D] 「访客浏览器」 body: en 与 zh 页面
- calendars [D] 「Apple、Google、Outlook」 body: webcal 订阅
- mailbox [D] 「订阅者邮箱」 body: 周日 17:00–20:00 PT digest

边：
iphone -> ingest (分享链接)
admin -> ingest (粘贴链接、发布)
admin -> inbox (勾选)
admin -> neon (settings 总开关)
skill -> ingest (mode candidate)
gcal -> inbox (打开时或 cron 拉取)
gmail -> inbox (webhook)
inbox -> ingest (勾选发布)
ingest -> gateway (schema 补全)
ingest -> neon (写草稿)
ingest -> cover (after)
cover -> blob (put)
cover -> neon (covers 行)
cover -> site (revalidateTag expire 0)
ingest -> site (updateTag 或 revalidateTag)
site -> neon (读)
feeds -> neon (读)
blob -> site (next/image)
cron -> inbox (sync)
cron -> resend (digest 批量)
cron -> upstash (锁)
resend -> neon (bounce、complaint 回写)
site -> visitors
feeds -> calendars
resend -> mailbox
mailbox -> site (RSVP、偏好、退订链接)

布局提示：四个竖向泳道从左到右；ingest 放在 B 泳道正中，cover 在其下、inbox 在其上、site 与 feeds 在其右；C 泳道竖排 neon、blob、upstash、gateway、resend；D 泳道竖排 visitors、calendars、mailbox。
```

图里所有写入都汇聚到 ingest 管线和 Neon，访客侧只读缓存页面、ICS feed 和由 cron 触发的 Resend 邮件。

## 数据模型：数据库表结构（SQL）

一个 Neon 数据库、十四张业务表加 Better Auth 自动生成的表；`event_sources(platform, external_id)` 的唯一约束是全站去重键，`digest_sends(issue_id, subscriber_id)` 的主键加 claim 行保证周日重复触发也不会多发，`settings` 表承载总开关这类必须秒级生效的配置。

```sql
create type event_status as enum ('draft','published','cancelled','archived');
create type going_status as enum ('none','interested','going','hosting','speaking');
create type going_vis  as enum ('public','after_event','hidden');

create table covers (
  id text primary key,
  kind text not null check (kind in ('official','host_composite','template','openverse','ai','brave','upload','url')),
  url_1600 text not null, url_800 text not null, url_400 text not null,
  url_og_en text not null, url_og_zh text not null,          -- next/og 合成，两种语言各一张
  thumbhash text not null, dominant text not null, bytes int not null,
  letterboxed boolean not null default false,               -- 宽高比 >1.25 或 <0.8 的官方图铺在主色底上
  source_url text, source_page_url text, license text, attribution text,
  created_at timestamptz not null default now()
);

create table events (
  id text primary key, slug text not null unique,
  status event_status not null default 'draft',
  title_en text, title_zh text, summary_en text, summary_zh text, note_en text, note_zh text,
  auto_fields text[] not null default '{}',                 -- 仍是 AI 草稿、未经 Victor 确认的字段名
  category text check (category in ('ai','hackathon','vc','campus','conference','cycling','social')),
  category_confidence real, tags text[] not null default '{}',
  event_language text not null default 'en' check (event_language in ('en','zh','bilingual')),
  start_at timestamptz, end_at timestamptz,                  -- 202 最小草稿允许为空
  tz text not null default 'America/Los_Angeles', all_day boolean not null default false,
  format text not null default 'in_person' check (format in ('in_person','online','hybrid')),
  venue_name text, city text, neighborhood text,
  region text check (region in ('sf','east_bay','peninsula','south_bay','north_bay','online')),
  address text, address_public boolean not null default false,
  private_venue boolean not null default false,             -- 住宅或私密场地，见「隐私、合规与反滥用」一节
  price_text text,
  access text not null default 'unknown' check (access in ('open','apply','waitlist','sold_out','unknown')),
  host_name text, host_url text, source_url text not null,
  going going_status not null default 'interested',
  going_visibility going_vis not null default 'public',
  featured boolean not null default false,
  cover_id text references covers(id),
  cover_policy text not null default 'official' check (cover_policy in ('official','template')),
  sequence int not null default 0,                           -- 时间、地点或状态改动时 +1，写进 ICS SEQUENCE
  created_via text not null default 'admin'
    check (created_via in ('admin','shortcut','share_target','skill','inbox')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  published_at timestamptz,
  check (status <> 'published' or (start_at is not null and category is not null and cover_id is not null))
);
create index events_pub_start on events (status, start_at) where status = 'published';
create index events_category on events (category, start_at);
```

```sql
create table event_sources (
  event_id text not null references events(id) on delete cascade,
  platform text not null check (platform in ('luma','partiful','eventbrite','meetup','other')),
  external_id text not null,                                -- luma evt-…、partiful e/<id>、eventbrite 数字 id、meetup id
  url text not null, ical_uid text,
  primary key (event_id, platform, external_id),
  unique (platform, external_id)                            -- 去重键
);
create index event_sources_ical on event_sources (ical_uid);

create table subscribers (
  id text primary key, email text not null unique,
  status text not null default 'pending' check (status in ('pending','active','paused','unsubscribed','suppressed')),
  locale text not null default 'en' check (locale in ('en','zh')),
  categories text[] not null default '{}',                  -- 7 个 slug 的子集，变体键由此派生
  going_alerts boolean not null default false,              -- P1
  ev_lang_pref text[], online_only boolean,                 -- P1 facets
  token_version int not null default 1,                     -- 链接 token 由 HMAC 派生不落库；+1 即作废旧链接
  consent_at timestamptz, consent_ip inet, consent_ua text, consent_source text,
  confirmed_at timestamptz, paused_until timestamptz, unsubscribed_at timestamptz,
  created_at timestamptz not null default now()
);
create index subscribers_active on subscribers (status, locale) where status = 'active';

create table digest_issues (
  id text primary key, iso_week text not null unique,       -- 2026-W41
  intro_en text, intro_zh text, featured_ids text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent')),
  send_after timestamptz, sent_at timestamptz, created_at timestamptz not null default now()
);
create table digest_sends (
  issue_id text not null references digest_issues(id), subscriber_id text not null references subscribers(id),
  variant_key text not null,                                -- locale + 排序后的类别 slug
  claimed_at timestamptz not null default now(),            -- 先 claim 再发，防重发
  resend_id text, sent_at timestamptz,                      -- 发送成功后回填
  primary key (issue_id, subscriber_id)
);

create table settings (                                     -- 秒级生效的运行时配置
  key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);
-- 行：show_attendance {"on":true}、cover_policy_default {"policy":"official"}、going_visibility_default {"v":"public"}
```

```sql
create table candidates (
  id text primary key,
  provider_key text unique,                                 -- luma:evt-…、partiful:<id>，可空
  ical_uid text, fuzzy_key text not null,                   -- 归一化标题 + 15 分钟取整的开始时间 + 城市
  title text not null, start_at timestamptz not null, end_at timestamptz,
  location text, links text[] not null default '{}', snippet text check (char_length(snippet) <= 300),
  rsvp text,                                                -- ATTENDEE PARTSTAT（可得时）或 P2 OAuth
  event_status text,                                        -- VEVENT STATUS：CONFIRMED、CANCELLED
  kind text not null default 'event' check (kind in ('event','roundup')),   -- roundup 邮件折叠为一行
  source_kinds text[] not null default '{}',                -- gcal、luma、partiful、mail、skill 累加
  suggest_comment text, suggest_going boolean not null default false,
  state text not null default 'inbox' check (state in ('inbox','snoozed','dismissed','added')),
  snoozed_until timestamptz, dismissed_at timestamptz, event_id text references events(id),
  first_seen timestamptz not null default now(), last_seen timestamptz not null default now()
);
create unique index candidates_fuzzy on candidates (fuzzy_key) where provider_key is null;
create table candidate_sightings (
  candidate_id text not null references candidates(id) on delete cascade,
  source_kind text not null, source_ref text not null,      -- feed 的 UID、Resend email_id、skill 批次 id
  seen_at timestamptz not null default now(), primary key (candidate_id, source_kind, source_ref)
);

create table api_tokens (
  id text primary key, name text not null, token_hash text not null unique,   -- vp_ + 32 字节随机，SHA-256
  scopes text[] not null default '{ingest}',                -- ingest、candidates、publish
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table sync_state (
  source text primary key, last_run_at timestamptz, last_ok_at timestamptz, cursor text, error text
);
create table jobs_log (
  id bigserial primary key, job text not null, started_at timestamptz not null default now(),
  finished_at timestamptz, ok boolean, detail jsonb
);
create table google_connection (                            -- P2
  id text primary key default 'victor', refresh_token_enc bytea not null, scopes text[] not null,
  connected_at timestamptz not null default now(), last_sync_at timestamptz
);
```

### 约束与索引说明

Better Auth 的 user、session、account、verification、passkey 表用 `npx @better-auth/cli generate` 生成 Drizzle schema，不手写。`subscribers.email` 只用于发信，对外链接里的 token 是 `<id>.<base64url(HMAC-SHA256(SUBSCRIBER_LINK_SECRET, id + ':' + token_version))>`，发信时现算、校验时按 id 重算并 `timingSafeEqual` 比对，URL 里永不出现邮箱。`events.address` 只有 `address_public = true` 才进入渲染层，读模型用一个 `events_public` 视图剔掉 address、created_via 和 auto_fields；`settings.show_attendance` 在同一个带 `cacheTag('events')` 的查询里读取，所以总开关和发布共用一次失效。

## 双语实现：路由、界面文案、活动内容的翻译流程

英文站在根路径、中文站在 `/zh`，同一活动的两种语言共享同一个 slug，切换语言只是换前缀。/admin 和 /api 不在 locale 段里，后台标签双语但不做路由。

### 路由与 proxy

```ts
// src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing';
export const routing = defineRouting({
  locales: ['en', 'zh'], defaultLocale: 'en', localePrefix: 'as-needed',
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },           // 手动切换后记一年
});

// src/proxy.ts  Next 16 用 proxy.ts，middleware.ts 已弃用
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { routing } from './i18n/routing';
const intl = createMiddleware(routing);
export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/admin')) {                    // 乐观重定向；真正鉴权在每个 Server Action 里
    if (!getSessionCookie(req) && pathname !== '/admin/sign-in')
      return NextResponse.redirect(new URL('/admin/sign-in', req.url));
    return NextResponse.next();
  }
  return intl(req);
}
export const config = { matcher: ['/((?!api|ics|_next|_vercel|.*\\..*).*)'] };
```

`src/app/[locale]/layout.tsx` 用 `generateStaticParams` 遍历 `routing.locales`，`<html lang>` 写 `en` 或 `zh-Hans`。Next 16.3 起 `next/root-params` 默认可用，`src/i18n/request.ts` 里用 `await rootParams.locale()` 加 `hasLocale()` 取 locale，不再调 `setRequestLocale`；Route Handler 和 Server Action 拿不到 root params，必须显式传 locale [next-intl root params 说明](https://next-intl.dev/blog/nextjs-root-params)。首访按 Accept-Language 判断，zh* 进 `/zh`；LangSwitch 写 NEXT_LOCALE cookie 后以 cookie 为准。hreflang 用 `en`、`zh-Hans`、`x-default` 三个值，写在 metadata.alternates.languages 和 sitemap 的 alternates 里 [Google 本地化版本](https://developers.google.com/search/docs/specialty/international/localized-versions)。

### 活动内容的翻译流程

| 字段 | 来源 | 谁翻译 | 审核 |
|---|---|---|---|
| title_en、title_zh | 页面标题；专有名词和官方活动名在中文里保留英文，无需翻译时模型把 title_zh 置为与 title_en 相同并记入 auto_fields | claude-haiku-4.5 在 ingest 时生成缺失一侧 | 编辑器里每个字段一个「AI 草稿」chip，点一下即确认，或点「重译」走 sonnet-4.6 |
| summary_en、summary_zh | 不复制主办方文案，由模型用 Victor 的口吻写 2 句以内 | 同上 | 同上 |
| note_en、note_zh | Victor 用一种语言写的点评 | 模型译另一侧并保留语气；两种都写了就都保留 | 发布前至少一种语言非空 |
| 类别、facet 标签 | taxonomy 表的 zh 与 en 列 | 无需翻译 | 无 |
| UI 文案 | messages/en.json、messages/zh.json | 手写 | PR review |

未确认的字段名记在 `events.auto_fields`，只在 /admin/drafts 和编辑器里显示 AI chip，公开页从不出现任何「机器翻译」标记；手机上选 Publish now 视为一并确认当前译文，事后仍可重译，桌面发布前逐字段批准。卡片和邮件里另一语言的标题在归一化（去空格与标点、小写）后与主标题相同时不渲染，避免 AI Tinkerers SF 这类名字出现两遍。

### 日期时间

```ts
// src/lib/format/date.ts  存 UTC + IANA tz，渲染交给 Intl
export function fmtRange(start: Date, end: Date | null, locale: 'en' | 'zh', tz = 'America/Los_Angeles') {
  const tag = locale === 'zh' ? 'zh-CN' : 'en-US';
  const day = new Intl.DateTimeFormat(tag, { timeZone: tz, month: locale === 'zh' ? 'numeric' : 'short',
    day: 'numeric', weekday: 'short' });
  const time = new Intl.DateTimeFormat(tag, { timeZone: tz, hour: 'numeric', minute: '2-digit',
    hourCycle: locale === 'zh' ? 'h23' : 'h12' });
  const range = end ? time.formatRange(start, end) : time.format(start);
  const zone = locale === 'zh' ? '北美太平洋时间' : 'PT';
  return locale === 'zh' ? `${day.format(start)} ${range} ${zone}` : `${day.format(start)} · ${range} ${zone}`;
}
// zh → 10月7日周三 18:30–20:00 北美太平洋时间    en → Wed, Oct 7 · 6:30 – 8:00 PM PT
```

两份文档统一用 Intl 的实际输出（zh 的日与周几之间没有空格，en 的时间区间两侧有空格）。线上活动额外显示访客本地时间，中文页再加北京时间（PDT 期间 +15 小时，2026-11-01 进入 PST 后 +16 小时）。每个日期都包在 `<time datetime="2026-10-07T18:30-07:00">` 里，永不用纯数字日期。中文正文 `line-height 1.7`、`text-autospace: normal`，中英混排间距遵循 CLReq 不超过四分之一个汉字宽 [CLReq](https://www.w3.org/TR/clreq/)。

## 管理后台与活动录入

后台只服务 Victor 一个人：passkey 登录的可安装 PWA，最小输入是链接、名字、点评，其余字段由 `POST /api/ingest` 从页面和模型补全，发布即 `updateTag('events')`，约 2 秒上线。

### 鉴权（只有 Victor）

Better Auth 用 magic link（Resend 发送）完成首次登录，随后在 iPhone 和 Mac 上各注册一个 passkey；before hook 只放行 `ADMIN_EMAIL`，所以不需要 `disableSignUp`（首次登录本身就是注册，开了它 Victor 会被自己挡在门外），会话 30 天滚动 [magic link 插件](https://www.better-auth.com/docs/plugins/magic-link)。proxy.ts 只做乐观重定向，每个 Server Action 和 Route Handler 都再调 `auth.api.getSession({ headers: await headers() })`，因为 Server Function 会绕过 proxy。

```ts
// src/lib/auth.ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { nextCookies } from 'better-auth/next-js';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { db } from './db';
import { sendMagicLink } from './email/magic-link';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  hooks: { before: createAuthMiddleware(async (ctx) => {   // 白名单：其他邮箱连注册都不行
    const email = (ctx.body?.email as string | undefined)?.toLowerCase();
    if (email && email !== process.env.ADMIN_EMAIL) throw new APIError('FORBIDDEN', { message: 'not allowed' });
  }) },
  plugins: [
    magicLink({ disableSignUp: false, expiresIn: 300, sendMagicLink: ({ email, url }) => sendMagicLink(email, url) }),
    passkey({ rpID: process.env.PUBLIC_HOST!, rpName: 'Victor Picks', origin: `https://${process.env.PUBLIC_HOST}` }),
    nextCookies(),                                          // 必须放最后
  ],
});
```

个人令牌：`vp_` + 32 字节随机数，只存 SHA-256，scope 为 ingest、candidates、publish，Settings 里显示 last_used 并可吊销；令牌永远读不到订阅者表。`GET /api/index` 同样要求 Bearer 令牌（scope candidates 或 ingest），否则任何人都能枚举全部来源链接；`POST /api/covers/upload` 用 Blob 的 `handleUpload`，在 `onBeforeGenerateToken` 里调 `auth.api.getSession`，`allowedContentTypes` 限 image/*，`maximumSizeInBytes` 15 MB。

### 后台屏幕

| 路由 | 屏幕 | 关键动作 |
|---|---|---|
| /admin/add | 链接框（聚焦时提供剪贴板）、名字覆盖、点评（键盘麦克风听写）、Draft 或 Publish now | 2–4 秒后显示与公开站一致的 EventCard 预览 |
| /admin/drafts | 草稿列表，每个未确认字段一个 AI chip | 一键确认、进入编辑器 |
| /admin/live | 本周、即将、过去 | 行内 going 印章按钮、下架 |
| /admin/e/[id] | 编辑器：手机为 EN、中文、Details、Cover 四个 tab，桌面为 EN 与中文双栏 | 逐字段重译、设 going 与可见性、「私人场地」开关、发布校验 |
| /admin/inbox | 候选收件箱（见「Google Calendar 与 Gmail 接入」一节） | 勾选发布、标 going、忽略、稍后 |
| /admin/digest | 周报编辑器 | 写导语、批准译文、发测试、排期 |
| /admin/subscribers | 按 locale 乘类别的计数、搜索、CSV 导出 | 手动抑制 |
| /admin/settings | 令牌、三条 feed URL、默认封面策略、going 默认可见性、两个 kill switch（settings 表行，秒级生效） | 清空收件箱数据 |

PWA 外壳：manifest standalone，底部 tab 栏 Inbox、Add、Drafts、Live、More；Add、编辑器与收件箱多选态隐藏 tab 栏，只保留一条粘底操作栏，`padding-bottom: env(safe-area-inset-bottom)`，键盘弹出时随 visualViewport 上移；目标 44 px，Add 路由 JS 不超过 100 KB。

### 后台外观

/admin 复用 globals.css 的全部 token：components.json 的 baseColor 设 neutral 后，把 shadcn 的 --background、--foreground、--primary、--ring 映射到 --color-paper、--color-ink、--color-ink、--color-seal，shadcn 原语只出现在这里；预览卡直接渲染公开站的 EventCard，所以后台看到的就是访客看到的。

发布校验：名字、开始时间、source_url、类别、至少一种语言的点评、一张封面，缺一项就退回草稿并说明原因。mode=publish 时服务端先同步用 next/og 生成排版模板封面（约 0.5 秒）作为当前封面再发布，随后 after() 找到官方封面且 cover_policy=official 时自动替换，所以封面校验总能通过；未填点评则存为草稿并在通知里写明。状态机 draft → published → cancelled 或 archived，每次跃迁在 Server Action 里调 `updateTag('events')`（Route Handler 里用 `revalidateTag('events', { expire: 0 })`，单参数形式在 Next 16.3 已弃用，参数形状以 Next.js 16.3 文档为准），下架保留行和封面。

### 抽取步骤代码

```ts
// src/lib/ingest/extract.ts
import * as cheerio from 'cheerio';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import { safeFetch } from './safe-fetch';                 // 见「封面图获取」一节的 SSRF 规则

export const EventDraft = z.object({
  title_en: z.string(), title_zh: z.string(),
  summary_en: z.string().max(240), summary_zh: z.string().max(120),
  note_en: z.string().nullable(), note_zh: z.string().nullable(),
  start_at: z.string().nullable(), end_at: z.string().nullable(), tz: z.string(),   // 页面没有日期就留空，不编造
  venue_name: z.string().nullable(), city: z.string().nullable(),
  format: z.enum(['in_person', 'online', 'hybrid']),
  category: z.enum(['ai', 'hackathon', 'vc', 'campus', 'conference', 'cycling', 'social']).nullable(),
  category_confidence: z.number().min(0).max(1),
  event_language: z.enum(['en', 'zh', 'bilingual']),
  price_text: z.string().nullable(),
  access: z.enum(['open', 'apply', 'waitlist', 'sold_out', 'unknown']),
  private_venue: z.boolean(),                              // 只有街道地址没有场地名、含 Apt/Unit/#、Luma 地址报名后可见
});

export async function extract(url: string, comment: string) {
  const html = await safeFetch(url, { maxBytes: 4_000_000 });
  const $ = cheerio.load(html);
  const jsonld = $('script[type="application/ld+json"]').map((_, el) => $(el).text()).get()
    .flatMap((t) => { try { return [JSON.parse(t)]; } catch { return []; } }).flat();
  const event = jsonld.find((n: any) => /Event$/.test(String(n?.['@type'] ?? '')));
  const nextData = $('#__NEXT_DATA__').text();            // Luma、Partiful：原始 cover_url、timezone、hosts、location_visibility
  const og = Object.fromEntries($('meta[property^="og:"]').map((_, el) =>
    [[$(el).attr('property'), $(el).attr('content')]]).get());
  const { output } = await generateText({
    model: 'anthropic/claude-haiku-4.5',
    output: Output.object({ schema: EventDraft }),
    prompt: [
      '把活动页面数据整理成结构化字段。summary 用 Victor 的口吻写，不复述主办方文案。缺失的日期留 null。',
      'comment 是 Victor 的点评：原文保留，另一种语言翻译并保持语气。官方活动名无需翻译时 title_zh 与 title_en 相同。',
      `comment: ${comment}`, `jsonld: ${JSON.stringify(event ?? og)}`,
      `nextData(截断): ${nextData.slice(0, 6000)}`,
    ].join('\n'),
  });
  return { draft: output, jsonld: event, nextData, og };
}
```

完整 ingest 顺序：归一化 URL（去 utm，lu.ma 改 luma.com，luma.link 手动跟随最多 3 跳且每跳过 SSRF 校验）→ 提取平台 id（luma `evt-…`、`partiful.com/e/<id>`、eventbrite `-tickets-<digits>`、meetup `<group>/events/<id>`）→ 查 `event_sources`，无则按模糊键查 → 加固抓取 → 适配器（Luma 优先 `__NEXT_DATA__`，Partiful 取 `__NEXT_DATA__.event.timezone` 因为其 JSON-LD 只给 UTC）→ 模型补全 → 写草稿（publish 模式先同步生成模板封面）→ `after()` 跑官方封面并在已发布时 `revalidateTag('events', { expire: 0 })` → 2–4 秒返回。私有或不支持的页面返回 202 加 `needs_manual: true`，只存 url 和点评（start_at、category 允许为空），绝不丢。

### 手机快速添加（P0）

iPhone 走快捷指令，因为 iOS Safari 不支持 Web Share Target（WebKit bug 194593），Android 已安装的 PWA 走 manifest share_target（Chrome Android 76+），两者都打到同一个 API。快捷指令的「显示在共享表单中」让它接收 URL 和 Safari 网页，「获取 URL 内容」支持带自定义头的 POST JSON [Apple 快捷指令指南](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-another-app-apd163eb9f95/ios)。

| 步骤 | 动作 | 耗时目标 |
|---|---|---|
| 1 | Luma App、Safari、iMessage 里点分享 → 「Add to Picks」；微信里先「在 Safari 打开」再分享，或复制链接后在 PWA Add 页点「从剪贴板粘贴」 | 1–2 s |
| 2 | 「要求输入」：点评，可听写，可跳过 | 0–15 s |
| 3 | 「从菜单选取」：Draft 或 Publish now | 1 s |
| 4 | 「获取 URL 内容」POST /api/ingest，Bearer 令牌 | 服务端 2.5–5 s |
| 5 | 通知「已保存 · 标题 · 10月7日周三 18:30 · AI (0.91) · 封面：官方」，Open 进 /admin/e/[id] | 即时 |

目标：分享到草稿保存 p50 ≤ 6 s、p95 ≤ 10 s（无点评）；带听写点评 ≤ 25 s；Publish now 后 ≤ 10 s 可见。提供两个快捷指令（Add to Picks 用 ingest 令牌，Add & Publish 用单独的 publish 令牌）的 iCloud 链接。手机上只做：链接、点评、草稿或发布、going 切换、确认自动翻译、从链里挑封面；中英双栏润色、facet、精选、周报留给桌面。

### 快速添加与 skill 共用的 API 契约

`POST /api/ingest`，鉴权为 session cookie 或 `Authorization: Bearer vp_…`，每令牌每小时 60 次；`mode=publish` 需要令牌带 publish scope，否则 403。

```json
{ "url": "https://luma.com/g42o84ln", "comment": "黑客松，Cloudflare 场地，适合想练手 agent 的同学",
  "mode": "draft", "client": "ios-shortcut", "name": null }
```

| 响应 | 含义 | body |
|---|---|---|
| 201 | 已建草稿或已发布 | id、status、title_en、title_zh、start_at、tz、category、category_confidence、cover_status（pending、official、template、template_pending_official）、admin_url、public_url |
| 202 | 页面私有或不支持，已存最小草稿 | id、needs_manual: true |
| 403 | 令牌缺少所需 scope | error: 'scope' |
| 409 | 重复链接 | existing_id、admin_url |
| 401 | 令牌无效或已吊销 | 无 |
| 429 | 超限 | Retry-After 头 |

weekly-events skill 继续写 Notion，最后一步先 `GET /api/index`（已发布 id、外部 id、iCalUID，Bearer 令牌）跳过已发布活动，再用 `weekly-events-skill` 令牌 POST：

```json
{ "mode": "candidate", "batch": [ { "url": "https://luma.com/xyz", "title": "AI Tinkerers SF",
  "start_at": "2026-10-08T01:30:00Z", "end_at": "2026-10-08T04:00:00Z", "tz": "America/Los_Angeles",
  "comment": "筛选制 demo 夜，早申请", "suggest_going": true } ] }
```

幂等键与收件箱一致：平台 id → iCalUID → 模糊键；重复只累加 `source_kinds` 和 sightings。MCP 服务（add_event、list_drafts、publish、set_going、list_candidates，绑定令牌）和后台「Ask」框排在 P2。

## 封面图获取：官方封面、兜底链、存储与版权

封面链前三步全自动，在 `after()` 里 15 秒内完成，所以每个发布的活动都有一张看起来是设计过的封面；第 4–6 步是 P1（M4）加进封面选择器的一键选项，上传与粘贴 URL 从 P0 起可用，自动发布永远不会越过第 3 步。

| 步骤 | 来源 | 何时触发 | 失败处理 |
|---|---|---|---|
| 1 | 官方封面：Luma 取 `__NEXT_DATA__` 的 `event.cover_url` 或 JSON-LD `image[0]`，绝不取 og:image；Partiful 取 partiful.imgix.net 的 og:image 加 `?w=1600&h=1600&fit=crop`；Eventbrite 解开 `/_next/image?url=` 得到 img.evbuc.com；Meetup 取 JSON-LD image；通用取 JSON-LD image → og:image:secure_url → og:image → twitter:image | ingest 后立即 | 没有图或解码失败 → 第 2 步 |
| 2 | 主办方组合图：Luma `hosts[].avatar_url`、`calendar.avatar_url`、`categories[].social_image_url`，Partiful `hosts[].photo.url`，叠在按类别着色的 next/og 模板上 | 第 1 步失败 | 无头像 → 第 3 步 |
| 3 | 排版模板：不含日期也不含印章。1200² 画面 = 类别色场（12% 色相底加同色相实色大块）+ 占画面约 55% 的类别字（ai → AI、hackathon → 黑、vc → 投、campus → 校、conference → 会、cycling → 骑、social → 聚，Noto Serif SC 600 或 Fraunces）+ 底部主办方名一行（高约 6%）；中英标题与日期只出现在 1200×630 的 OG 版本 | 第 1、2 步失败，cover_policy = template，或 publish 模式的同步占位 | 确定性生成，不会失败；已发布时完成后 `revalidateTag('events', { expire: 0 })` |
| 4（P1） | Openverse：匿名 API，只收 cc0、by、by-sa，存 license、creator、attribution 并渲染在封面下 [Openverse 实测](https://api.openverse.org/v1/images/?q=hackathon&page_size=2) | Victor 在选择器里点 | 速率限制未核实，结果缓存 |
| 5（P1） | AI 抽象封面：AI SDK generateImage 经 Gateway，recraft/recraft-v4.1-flash 每张 $0.007，bfl/flux-pro-1.1 $0.04 [Gateway 模型价](https://ai-gateway.vercel.sh/v1/models)；固定提示：抽象、类别配色、无文字、无 logo、无人物 | Victor 点 | 失败提示重试 |
| 6（P1） | Brave Image Search：$5/1,000 次，每月 $5 免费额度，只显示缩略图让 Victor 挑，存来源页作 attribution，绝不自动应用 | Victor 点 | 无结果留在模板 |
| 7 | 相册上传（Blob 客户端直传，绕过 4.5 MB body 限制，鉴权见「管理后台与活动录入」一节）或粘贴图片 URL（走同一加固抓取） | Victor 点 | 解码失败报错 |

模板在 96 px 下只剩色场与一个大字，因此在列表和邮件缩略图里依然可辨，也不会和卡片左侧的时间列、封面上的印章重复。Luma 的 og:image 是 800×420 的社交卡，不是封面；真正的方形封面在 JSON-LD 的 1920² 裁切和 `__NEXT_DATA__` 的原始 `cover_url` 里，官方建议封面 1:1 且不小于 800² [Luma 封面说明](https://help.luma.com/p/event-cover-images)。Partiful 的 og:image 就是 1000×1000 的海报，imgix 参数可改尺寸，已实测 [Partiful 活动页](https://partiful.com/e/Fk5FC9HoQ1czq3Uspro6)。模板与 OG 的中文字形按标题逐字通过 Google Fonts `text=` 参数取子集（8 个字约 2.5 KB），以留在 Satori 500 KB 打包上限内 [ImageResponse 文档](https://nextjs.org/docs/app/api-reference/functions/image-response)。

### 存储与尺寸

永远复制、永远不热链：Luma 和 Partiful 的 CDN 今天能直接访问但不是承诺，而且 next/image 优化本来就会在服务端复制一份。sharp 处理顺序：嗅探魔数 → 拒绝 SVG，动图只取首帧 → 去元数据、自动纠向 → 宽高比在 0.8–1.25 之间的图居中裁成 1:1，横幅或竖图（Eventbrite、Meetup 常见 2:1）用 `fit: 'contain'` 铺在主色底上并标 `letterboxed`，选择器对这类封面提示「建议换模板」→ 1600² WebP q80 主图，再出 800²、400² → `stats().dominant` 作卡片底色 → thumbhash（约 25 字节）作占位 [ThumbHash](https://evanw.github.io/thumbhash/)。OG 图不裁切，由 next/og 合成：左侧 630² 方形封面，右侧纸色面板放当前语言标题（最多 3 行）、Geist Mono 日期行、底部「Victor 精选」字标与小印，两种语言各存一张。写入 Vercel Blob 用内容哈希路径加 `addRandomSuffix`，`cacheControlMaxAge` 一年，替换封面时写新路径再 `del()` 旧的。next/image 只允许 Blob 主机一个 remotePattern，`qualities: [75]`，`blurDataURL` 由 thumbhash 解成 8 px PNG data URL。每年约 200 个活动乘约 400 KB 约 80 MB，对 Hobby 的 1 GB 和每月 2k 次高级操作都很宽裕（估算）。

```ts
// src/lib/covers/store.ts
import sharp from 'sharp';
import { put } from '@vercel/blob';
import { rgbaToThumbHash } from 'thumbhash';
import { createHash } from 'node:crypto';
import { safeFetchBytes } from '../ingest/safe-fetch';

export async function storeCover(eventId: string, srcUrl: string) {
  const bytes = await safeFetchBytes(srcUrl, { maxBytes: 15_000_000, acceptPrefix: 'image/' });
  const meta = await sharp(bytes).metadata();
  if (!meta.format || meta.format === 'svg' || !meta.width || !meta.height) throw new Error('unsupported image');
  const ratio = meta.width / meta.height;
  const letterboxed = ratio > 1.25 || ratio < 0.8;        // 横幅或竖图不裁切，铺在主色底上
  const base = sharp(bytes, { animated: false }).rotate();
  const { dominant } = await base.clone().stats();
  const bg = { r: dominant.r, g: dominant.g, b: dominant.b };
  const sq = (px: number, q: number) => base.clone()
    .resize(px, px, letterboxed ? { fit: 'contain', background: bg } : { fit: 'cover' })
    .webp({ quality: q }).toBuffer();
  const [master, mid, small] = await Promise.all([sq(1600, 80), sq(800, 80), sq(400, 78)]);
  const tiny = await sharp(master).resize(100, 100, { fit: 'inside' }).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const thumbhash = Buffer.from(rgbaToThumbHash(tiny.info.width, tiny.info.height, tiny.data)).toString('base64');
  const hash = createHash('sha256').update(master).digest('hex').slice(0, 16);
  const up = (name: string, body: Buffer) =>
    put(`covers/${eventId}/${hash}-${name}`, body,
      { access: 'public', contentType: 'image/webp', addRandomSuffix: true, cacheControlMaxAge: 31_536_000 });
  const [b1600, b800, b400] = await Promise.all([up('1600.webp', master), up('800.webp', mid), up('400.webp', small)]);
  return { url_1600: b1600.url, url_800: b800.url, url_400: b400.url, thumbhash, letterboxed,
    dominant: `rgb(${bg.r} ${bg.g} ${bg.b})`, bytes: master.byteLength };
  // OG 由 covers/og.tsx 用 next/og 合成后另行 put（url_og_en、url_og_zh）
}
```

### SSRF 规则（唯一允许出网的抓取器）

只接受 https；自动 ingest 的主机白名单为 luma.com、lu.ma、luma.link、partiful.com、eventbrite.com、meetup.com、images.lumacdn.com、partiful.imgix.net、img.evbuc.com、secure-content.meetupstatic.com；其他主机先解析 A 与 AAAA，用 ipaddr.js 2.5 拒绝回环、0.0.0.0/8、RFC1918、169.254.0.0/16（含 IMDS）、fc00::/7、::1、多播和 metadata 主机名，再让 undici 的 connect 只连已校验的 IP，防 DNS 重绑定 [OWASP SSRF 备忘单](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)。重定向关闭、手动跟最多 3 跳且每跳重校验，超时 10 s，HTML 上限 4 MB、图片 15 MB，Content-Type 必须以 image/ 开头且 sharp 能解码，UA 用 Chrome 字串因为 Eventbrite 对 curl UA 返回 429。用一条 ESLint no-restricted-imports 规则禁止 ingest、covers、inbox 目录直接 import fetch 或 undici。

### 版权处理

事实可以自由转述，封面是第三方表达：Luma 条款禁止把其图片作为独立文件再发布 [Luma 条款](https://luma.com/terms)，Partiful 禁止复制与抓取 [Partiful 条款](https://partiful.com/terms)。策略：官方封面最大存 1600²，总是带官方页链接和「Cover: 主办方 via 平台」一行；邮件 digest 对 Luma 来源默认用模板封面，除非 Victor 明确保留；/privacy 上有下架邮箱和 24 小时移除承诺；从不存主办方文案；拿不准就用模板或 AI 封面。Openverse 图必须渲染 attribution，AI 封面不画真人和品牌。后台 Settings 有「把所有官方封面换成模板」一键开关（settings 表行，秒级生效）。

## Google Calendar 与 Gmail 接入：授权方式、同步、去重与候选收件箱

P0 用三条私密 ICS 地址加 skill 推送，不碰 Google OAuth；Gmail 一侧在 P1 用过滤器转发到 Resend Inbound；OAuth 留到 P2 只为拿 RSVP 状态。原因：gmail.readonly 和 gmail.metadata 都是受限 scope，且 gmail.metadata 不能用 q 参数按发件人筛 [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)；读日历事件是敏感 scope；External 项目停在 Testing 状态时 refresh token 7 天过期 [OAuth 2.0 文档](https://developers.google.com/identity/protocols/oauth2)；个人使用虽免审核，但依赖未验证的 In production 同意屏 [品牌验证豁免](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)，而 berkeley.edu 的 Workspace 管理员还可能封第三方应用。

| 方式 | 需要的授权 | Google 审核 | 实时性 | 复杂度 | 结论 |
|---|---|---|---|---|---|
| OAuth calendar.events.readonly | 同意屏，External 项目发布为 In production | 敏感 scope；个人使用可点「继续（不安全）」跳过 [未验证应用说明](https://support.google.com/cloud/answer/7454865) | 轮询 15 分钟起，push 需 7 天续订 | 中：token 加密存储、刷新、Disconnect | P2，只为 RSVP 状态 |
| OAuth gmail.readonly | 同上 | 受限 scope；公开应用需年度 CASA 评估 [受限 scope 验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) | 轮询 | 中高 | P2，可选 |
| Google Calendar 私密 iCal 地址 | 无，复制 Settings 里的 Secret address [私密地址帮助](https://support.google.com/calendar/answer/37648) | 无 | 我们的服务器直接拉，不受 Google 12–24 h 刷新影响 | 低：node-ical 解析 | P0 |
| Luma 与 Partiful 个人 ICS | 无，各自设置页复制链接 [Luma iCal](https://help.luma.com/p/ical-syncing) | 无 | 同上 | 低 | P0，Luma feed 含已报名、候补、待审 |
| Gmail 过滤器转发 → Resend Inbound | 一次点击验证转发地址 [Gmail 转发帮助](https://support.google.com/mail/answer/10957) | 无 | 事件驱动，约 2 分钟 | 中：webhook 验签、解析 .ics 与链接 | P1 |
| Apps Script 桥 | 脚本自己的授权，同账号免审 | 无 | 触发器最短 1 分钟 [Apps Script 配额](https://developers.google.com/apps-script/guides/services/quotas) | 中：代码在仓库外 | 备胎 |
| weekly-events skill 推送 | vp_ 令牌 | 无 | 每周或按需 | 低 | P0 |

### 已选路线的搭建步骤

1. Google Calendar 网页版：Settings → Settings for my calendars → 选日历 → Integrate calendar → 复制「Secret address in iCal format」，存为 `GCAL_SECRET_ICS_URL`；泄露时点 Reset 即作废。同时把 Settings → Event settings → 「Add invitations to my calendar」设为 From everyone，否则 Luma 发的邀请不会进日历 [邀请设置帮助](https://support.google.com/calendar/answer/13159188?hl=en&co=GENIE.Platform%3DDesktop)。
2. Luma：Settings → Calendar Syncing → Add iCal Subscription，复制 URL 存 `LUMA_PERSONAL_ICS_URL`；UID 里带 `evt-…` id。
3. Partiful：桌面版 Calendar sync → Copy Link，存 `PARTIFUL_ICS_URL` [Partiful 同步帮助](https://help.partiful.com/hc/en-us/articles/15525660-sync-to-google-calendar)。
4. vercel.json 加 `0 13 * * *` 调 `/api/cron/sync`，带 `CRON_SECRET`；打开 /admin/inbox 时也按需拉取，10 分钟冷却，Upstash 锁防并发。
5. P1：Resend 控制台开 Receiving，拿到 `<alias>@<id>.resend.app` 托管地址（不需 DNS）[Resend 收信](https://resend.com/docs/dashboard/receiving/introduction)；Gmail 建过滤器 `from:(luma.com OR luma-mail.com OR partiful.com OR eventbrite.com OR meetup.com)` 加各 roundup 发件人 → Forward it；Gmail 的验证邮件会被同一个 webhook 收到。`email.received` webhook 只有元数据，再 `GET /emails/receiving/{id}` 取正文，解析顺序 .ics 附件 → schema.org EventReservation → 链接。一封邮件提取到 ≥ 5 个平台链接时视为 roundup：只保留 luma.com、partiful.com、eventbrite.com、meetup.com 的链接，先跑去重，剩余链接合并成一行 `kind = roundup`「Newsletter · 发件人 · N 个新链接」，展开后逐条勾选，每封最多 50 条。收到的邮件同样计入 Resend Free 的每天 100 封配额。

```ts
// src/lib/inbox/sync-ics.ts
import ical from 'node-ical';
import { addDays } from 'date-fns';
import { upsertCandidate, providerKeyFrom, expandOccurrences, partstatFor } from './candidates';

const FEEDS = [
  { kind: 'gcal', url: process.env.GCAL_SECRET_ICS_URL! },
  { kind: 'luma', url: process.env.LUMA_PERSONAL_ICS_URL! },
  { kind: 'partiful', url: process.env.PARTIFUL_ICS_URL! },
] as const;

export async function syncIcsFeeds(now = new Date()) {
  const until = addDays(now, 14);
  for (const feed of FEEDS) {
    const data = await ical.async.fromURL(feed.url, { headers: { 'user-agent': 'victor-picks/1.0' } });
    for (const ev of Object.values(data)) {
      if (ev.type !== 'VEVENT' || !ev.start) continue;
      if (String(ev.status ?? '').toUpperCase() === 'CANCELLED') continue;
      // 循环活动用 node-ical 暴露的 rrule、recurrences、exdate 展开到窗口内；API 以其 README 为准
      const instances = ev.rrule ? expandOccurrences(ev, now, until) : [ev];
      for (const inst of instances) {
        if (inst.start > until || (inst.end ?? inst.start) < now) continue;
        const text = `${inst.description ?? ''} ${inst.url ?? ''} ${inst.location ?? ''}`;
        const links = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[)>"']+$/, ''));
        const uid = ev.rrule ? `${ev.uid}:${inst.start.toISOString()}` : String(ev.uid);
        await upsertCandidate({
          source_kind: feed.kind, source_ref: uid,
          provider_key: providerKeyFrom(links, uid),        // luma:evt-… 等，可能为 null
          ical_uid: uid, title: String(inst.summary ?? ''),
          start_at: inst.start, end_at: inst.end ?? null,
          location: inst.location ? String(inst.location).slice(0, 200) : null,
          links, snippet: String(inst.description ?? '').slice(0, 300),
          rsvp: partstatFor(inst.attendee, process.env.ADMIN_EMAIL!),   // ATTENDEE 的 PARTSTAT；拿不到就 null
          event_status: inst.status ? String(inst.status) : null,
        });
      }
    }
  }
}
```

node-ical 0.27.2 要求 Node 22 以上，`fromURL` 一步完成抓取与解析，循环事件按 DTSTART 的时区展开 [node-ical](https://github.com/jens-maus/node-ical)。VEVENT 的 STATUS 是活动自身状态，不是 Victor 的回复；回复状态只在 ATTENDEE 行的 PARTSTAT 参数里，Google 私密 feed 是否带该参数未核实，拿不到就为 null，P2 之前收件箱不显示 RSVP 灰字，只在 event_status = CANCELLED 时显示「已取消」。

### 去重键

顺序：平台 id（luma:evt-…、partiful:<id>、eventbrite:<digits>、meetup:<id>，luma.link 先解重定向）→ iCalUID 或 ICS UID → 模糊键（去 emoji 和标点的小写标题 + 取整到 15 分钟的开始时间 + 城市）。新的 sighting 只往同一 candidate 累加 `source_kinds`；命中 `event_sources` 时自动挂到 `event_id` 并显示「已添加」。

### 收件箱界面

每行：标题、日期时间、场地城市、来源 chip（Calendar、Luma、Partiful、Mail、Skill）、提取出的链接、「已添加」链接、Publish 勾选框、Going 控件、忽略与稍后；roundup 邮件折叠为一行，展开后勾选。桌面三栏：来源与日期筛选、按天分组的列表、预览；Going 是三态分段控件；快捷键 E 添加、X 忽略、H 稍后、G 循环 going、J 与 K 移动、⌘↩ 「添加所选」。手机单列：右滑添加、左滑忽略、长按稍后、粘底「添加 N 项」；行内 Going 是一个点按循环的印章按钮（— → 想去 → 会去），避免与横向滑动冲突。「添加所选」对每行并行跑 ingest 加封面管线，默认草稿，可切「直接发布」；标 going 与发布互相独立，日历上有不代表会去。

### 保留规则

只存来源引用、标题、起止、地点字串、提取链接、RSVP、event_status 和不超过 300 字的摘要，永不存邮件正文（Resend Free 那边保留 30 天，且只有过滤后的邮件会离开 Gmail）。候选永远不进公开页、feed 或 digest；忽略的行隐藏 90 天，行在 end_at 后 7 天过期；日志脱敏邮箱；Settings 有「清空收件箱数据」。如果 Victor 的日历在 berkeley.edu 账号，先测管理员策略，否则用个人 Google 账号连接。

## 日历订阅：按类别和语言的 iCal feed、Victor 会去 feed、一键加入日历

所有 feed 都是无状态的查询参数组合：网站类别 chip 选中什么，「订阅这几类」按钮就生成对应的 `/calendar.ics?c=…&lang=…`，不需要账号。

| 地址 | 内容 |
|---|---|
| /calendar.ics | 全部已发布活动，英文 |
| /calendar.ics?lang=zh | 同上，中文 SUMMARY、DESCRIPTION、X-WR-CALNAME |
| /calendar.ics?c=ai,hackathon&lang=zh | 任意 7 个 slug 子集，未知 slug 忽略；P1 加 &ev_lang=zh 和 &online=1 |
| /calendar/going.ics | going、hosting、speaking 且可见性 public 的活动（after_event 的结束后加入）；settings 总开关关闭时返回空 feed |
| /events/[slug].ics | 单个 VEVENT 下载；App Router 不接受带后缀的动态段，实际 handler 在 `src/app/ics/[slug]/route.ts`，next.config.ts 用 rewrites 把 `/events/:slug.ics` 指到 `/ics/:slug`，并加 `Content-Disposition: attachment` |

VEVENT 规则：UID `<event id>@picks.<domain>` 编辑后不变；DTSTART 与 DTEND 带 `TZID=America/Los_Angeles` 并附 VTIMEZONE；going 公开时 SUMMARY 前缀 `V→ `；DESCRIPTION 为该语言的点评加 `RSVP: <source_url>` 加活动页链接；LOCATION 只写场地名和城市，除非 address_public；CATEGORIES 写类别 slug；取消后 `STATUS:CANCELLED` 保留 14 天；开始结束时间、地点、状态（取消或恢复）任一改动 SEQUENCE 加一；`REFRESH-INTERVAL;VALUE=DURATION:PT1H` 与 `X-PUBLISHED-TTL:PT1H`。窗口为过去 1 天到未来 90 天。

```ts
// src/app/calendar.ics/route.ts   动态 handler，s-maxage 900
import ical from 'ical-generator';
import { getVtimezoneComponent } from '@touch4it/ical-timezones';
import { listPublished, isCategory, publicUrl } from '@/lib/db/events';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const lang = q.get('lang') === 'zh' ? 'zh' : 'en';
  const cats = (q.get('c') ?? '').split(',').filter(isCategory);
  const events = await listPublished({ cats, fromDays: -1, toDays: 90 });
  const label = cats.length ? cats.join(' ') : lang === 'zh' ? '全部' : 'All';
  const cal = ical({
    name: lang === 'zh' ? `Victor 精选 · ${label}` : `Victor's Picks · ${label}`,
    timezone: { name: 'America/Los_Angeles', generator: getVtimezoneComponent },
    ttl: 3600,                                              // 同时写出 REFRESH-INTERVAL 与 X-PUBLISHED-TTL
  });
  for (const e of events) {
    cal.createEvent({
      id: `${e.id}@${process.env.PUBLIC_HOST}`, sequence: e.sequence,
      start: e.start_at, end: e.end_at ?? undefined, timezone: 'America/Los_Angeles',
      summary: (e.goingPublic ? 'V→ ' : '') + (lang === 'zh' ? e.title_zh : e.title_en),
      description: `${lang === 'zh' ? e.note_zh : e.note_en}\nRSVP: ${e.source_url}\n${publicUrl(e, lang)}`,
      location: [e.venue_name, e.city].filter(Boolean).join(', '),
      url: publicUrl(e, lang), categories: [{ name: e.category }],
      status: e.status === 'cancelled' ? ('CANCELLED' as any) : ('CONFIRMED' as any),   // 用 ICalEventStatus 枚举替换 any
    });
  }
  return new Response(cal.toString(), { headers: {
    'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'public, s-maxage=900' } });
}
```

ical-generator 没有自带时区库，VTIMEZONE 必须通过 generator 注入 [ical-generator](https://github.com/sebbo2002/ical-generator)。

### 加入日历按钮

| 目标 | 链接形式 | 备注 |
|---|---|---|
| Apple 与其他 | `webcal://picks.<domain>/calendar.ics?c=…&lang=…` | webcal 只是 IANA 临时 scheme，但各客户端都认 |
| Google 订阅 | `https://calendar.google.com/calendar/r?cid=webcal://picks.<domain>/calendar.ics?…` | 社区文档化，非官方 [Simon Willison TIL](https://til.simonwillison.net/ics/google-calendar-ics-subscribe-link) |
| Google 单个活动 | `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…Z/…Z&ctz=America/Los_Angeles&details=…&location=…` | 无官方文档 [add-event-to-calendar-docs](https://interactiondesignfoundation.github.io/add-event-to-calendar-docs/services/google.html) |
| Outlook 单个活动 | `https://outlook.live.com/calendar/deeplink/compose?path=/calendar/action/compose&rru=addevent&startdt=…&enddt=…&subject=…&location=…` | 无官方文档 |
| 复制链接 | 纯文本 | 微信里发给别人 |

这些格式都没有官方文档，全部封装在 `src/lib/calendar-links.ts` 并用 Vitest 锁定快照。中文界面的按钮顺序是 Apple、Outlook、.ics、Google，因为 Google Calendar 在大陆不可达。页面上写明刷新预期：Apple 15 分钟到数小时、Outlook 3–12 小时、Google 12–24 小时甚至更久 [Luma iCal 同步说明](https://help.luma.com/p/ical-syncing)，所以取消和临时加场一律再发邮件；going.ics 本身也有 15 分钟 CDN 缓存。

## Newsletter 发送：双重确认、偏好中心、每周 digest、退订与送达率

订阅者表归自己，Resend 只当发信管道：每个（locale × 类别集合）变体用 react-email 渲染一次，再用 Batch API 每 100 人一次发出，逐封带 RFC 8058 头；Resend 的 Broadcast、Segment、Topic 有意不用。

### 订阅到退订的流程

| 步骤 | 实现 | 规则 |
|---|---|---|
| 表单 | 客户端组件 `<form action={subscribe}>`（不写 method 与 action 属性）→ Server Action 先 `checkBotId()`；7 个类别 chip、语言、可选 going 提醒 | 蜜罐字段、填写时间 ≥ 3 s、Upstash 每 IP 10 分钟 5 次、每邮箱每天 3 次、1 条 Hobby WAF 规则指向 /subscribe 与 /zh/subscribe 的 POST |
| 待确认 | subscribers.status = pending，记 consent_at、ip、ua、source、categories | 7 天未确认清除 |
| 确认邮件 | 双语，无任何推广内容（M3AAWG 的 confirmed opt-in） | 同一 From 地址 |
| 确认 | GET /confirm/[token] → active，记 confirmed_at | token 由 HMAC 派生（见「数据模型」一节），URL 里永不出现邮箱 |
| 偏好中心 | /prefs/[token]：语言、类别、going 提醒（P1）、活动语言与线上 facet（P1）、暂停 4 周、退订单类或全部 | 无需登录；改 token_version 即作废旧链接 |
| 一键退订 | 头 `List-Unsubscribe: <https://picks.<domain>/api/unsubscribe?t=…>` 与 `List-Unsubscribe-Post: List-Unsubscribe=One-Click`；POST 不需 cookie、返回 200、不重定向、立即改状态 [RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058) | Gmail 要求 48 小时内处理，我们即时 |
| 人工退订页 | GET /unsubscribe 按类别退订 | 正文可见链接 |

### digest 组装

vercel.json 写两条 digest cron `0 1 * * *` 与 `0 2 * * *`（UTC），都调 `/api/cron/digest`；`digest_issues.send_after` 由 @date-fns/tz 算成周日 17:00 America/Los_Angeles，门槛只有 `status = 'scheduled' and send_after <= now()`，不再判断「PT 是否周日」。PDT 期间 01:00 UTC 的运行落在 18:00–18:59 PT，必然通过；PST 期间（2026-11-01 起）01:00 UTC 落在 17:00–17:59 PT，若延迟到 17:00 之前未到，就由 02:00 UTC 那次（18:00–18:59 PST，19:00–19:59 PDT）补上，所以全年都在周日 17:00–20:00 PT 之间发出，第二次运行靠 claim 行幂等不重发。变体键 = locale + 排序后的类别 slug，最多 2 × 127 种；每变体渲染一次，再按 100 人切批调用 `/emails/batch`，每秒不超过 1 次调用（团队级限速 10 rps）[Resend 配额](https://resend.com/docs/knowledge-base/account-quotas-and-limits)。空变体（所选类别本周无活动）每月最多发一次「本周没有想推荐的」，否则跳过。

章节顺序：Victor 导语 2–4 行（一种语言手写，另一种模型起草并在 /admin/digest 批准）→ 我会去 → 每个订阅类别一节，按天分组，每项 96 px 方形封面、当前语言标题（另一语言归一化后不同才显示）、日期时间、城市、价格与准入 chip、1–2 行点评、RSVP 按钮 → 下周预告（仅精选）→ 页脚：发件人、「无付费植入」声明、语言切换、偏好中心、可见退订链接。主题行必须诚实，例如「本周 6 场精选 · Victor 会去 2 场」。HTML 控制在 90 KB 内，Gmail 超过 102 KB 会截断 [Litmus 说明](https://www.litmus.com/blog/how-to-keep-gmail-from-clipping-your-emails)。

```ts
// src/lib/digest/send.ts（节选）：先 claim 再发，key 由收件人集合派生
import { Resend } from 'resend';
import { createHash } from 'node:crypto';
import { linkToken } from '../subscribers/token';           // HMAC 派生的 <id>.<sig>
const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendVariant(issue: Issue, variant: Variant) {
  // 只取本期还没有 digest_sends 行的订阅者（not exists 子查询），每次最多 100 人
  for (;;) {
    const subs = await claimBatch(issue.id, variant.key, 100);   // 事务内插入 claim 行，resend_id 为 null
    if (subs.length === 0) break;
    const ids = subs.map((s) => s.id).sort();
    const key = `${issue.id}:${variant.key}:${createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 16)}`;
    const batch = subs.map((s) => {
      const t = linkToken(s);
      return {
        from: process.env.RESEND_FROM!, to: s.email, subject: variant.subject,
        html: variant.html.replaceAll('{{token}}', t),      // 每人不同的 prefs 与退订链接
        headers: {
          'List-Unsubscribe': `<https://${process.env.PUBLIC_HOST}/api/unsubscribe?t=${t}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [{ name: 'issue', value: issue.iso_week }],
      };
    });
    const { data, error } = await resend.batch.send(batch, { idempotencyKey: key });
    if (error) throw error;                                 // claim 行保留，重试段 10 分钟后重发同一组人
    await markSent(issue.id, subs, data);                   // 回填 resend_id 与 sent_at
    await new Promise((r) => setTimeout(r, 1000));
  }
}
```

重试规则：cron 第二次运行只处理 `resend_id is null and claimed_at < now() - interval '10 minutes'` 的 claim 行；因为 key 由同一组订阅者 id 派生，同一组人重发命中 Resend 的幂等缓存，名单变了则自然换 key，不会撞上 payload 不同的 409。Batch 每次最多 100 封、不支持附件，Idempotency-Key 24 小时内有效 [Batch API](https://resend.com/docs/api-reference/emails/send-batch-emails)；`batch.send` 的第二个参数形状以 resend 6.30 类型定义为准。

### DNS 与送达率

发信子域 `mail.<domain>`：按 Resend 生成的记录原样添加 DKIM 与 SPF（TXT 加 MX 或 CNAME），通常 15 分钟内验证、最长 72 小时 [添加域名](https://resend.com/docs/add-a-domain)；DMARC 先 `p=none`，连续 3 个月干净后改 quarantine。Gmail 对每天约 5,000 封以上的发件人要求 SPF 加 DKIM、DMARC、一键退订和 0.1% 以下的垃圾率，我们从第一天就照做 [Gmail 发件人 FAQ](https://support.google.com/a/answer/14229414)。Webhook `/api/webhooks/resend` 用 Svix 头验签，`email.bounced` 与 `email.complained` 把订阅者置为 suppressed，`contact.updated` 忽略。目标：退回率 < 2%、投诉 < 0.1%、每次发送退订 ≤ 0.5%。Free 的每天 100 封同时计入 Resend Inbound 收到的邮件，在未开启 Gmail 转发时约 90 活跃订阅者见顶；开启 F18 的同一周（M4）升级 Resend Pro $20/月。发前用 gmail.com、icloud.com、outlook.com、qq.com、163.com 五个种子地址各收一份。

## 页面与前端：路由清单、日历视图、筛选、SEO 与分享卡片

公开站默认视图是「本周」按天分组的列表，月历只在桌面出现，手机用 agenda；所有页面都是 Cache Components 加 `cacheTag('events')`，发布时一次失效同时刷新两种语言。

| 路径 | 页面 | 渲染方式 |
|---|---|---|
| / 与 /zh | 本周：按天分组、精选 rail、GoingStrip、类别 chip（?c=） | 缓存，tag events |
| /events/[slug] 与 /zh/events/[slug] | 活动详情：1:1 封面、双语标题、DateTime、城市、chip、CuratorNote、GoingBadge、RSVP、加入日历、attribution | 缓存，tag events |
| /calendar 与 /zh/calendar | 桌面月历、手机 agenda，?m=2026-10 | 缓存 |
| /week/[yyyy-Www] | 任一周列表，digest 与微信文本用的永久链接 | 缓存 |
| /going 与 /zh/going | 公开的 going、hosting、speaking 加「去过」归档 | 缓存；总开关关闭时 404 |
| /archive | 按月归档 | 缓存 |
| /weekly/[yyyy-Www] 与 /zh/weekly/… | 每期 digest 公开存档（DigestArchive） | 缓存 |
| /subscribe、/confirm/[token]、/prefs/[token]、/unsubscribe | 订阅流程（表单是 Server Action） | 动态 |
| /about、/privacy | 关于与隐私（双语） | 静态 |
| /feed.xml 与 /zh/feed.xml | RSS | 动态，s-maxage 900 |
| /calendar.ics、/calendar/going.ics、/ics/[slug]（rewrite 自 /events/[slug].ics） | ICS | 动态，s-maxage 900 |
| /sitemap.xml、/robots.txt | 本地化 sitemap，禁止 /admin 与 /api | 静态生成 |
| /api/og/[slug]?lang= | OG 图，302 到 Blob 里 ingest 时合成的 1200×630 | 动态 |

### 视图与筛选

CategoryChip 行是多选的真按钮，带 `aria-pressed`，状态写进 URL `?c=ai,hackathon`，同一组选择直接生成「订阅这几类」的 ICS 与邮件链接。FacetPanel（活动语言、形式、区域、价格）在列表视图折叠面板里，P0 只筛不订阅。CalendarGrid 手写：月格每天最多 3 个类别圆点，点一天滚到该天列表；WeekStrip 是顶部可横滑的 7 天条；单元格 ≥ 24 px、手机 44 px，键盘方向键可导航，周标签用 Intl 的 zh-CN 与 en-US。取消的活动保留卡片，标题划线加「已取消 / Cancelled」chip。

### SEO 与分享卡片

详情页输出 schema.org Event JSON-LD，只含事实字段（name、startDate 带偏移、endDate、location 的 Place 与城市、organizer 名、offers 的 price_text 解析结果、url 指向 source_url、image 指向 Blob 封面），不放主办方文案。`generateMetadata` 写 `alternates.canonical`、`alternates.languages` 的 en、zh-Hans、x-default，以及 `alternates.types` 的 RSS [generateMetadata 文档](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)；sitemap.ts 对每个活动和列表页写同样的 alternates。OG 图 1200×630 在 ingest 时随封面合成并存 Blob（左方图、右标题面板，两种语言各一张），`og:image` 直接指向 Blob URL，`twitter:card` 为 summary_large_image；微信分享用同一张图和 `og:description` 的中文摘要。`robots.txt` 禁止 /admin 和 /api，允许 *.ics。

## 设计系统：token、字体、组件、响应式、图片、性能、无障碍、邮件视觉

整体气质是「城市一周的编辑账本」：画廊白纸面上的安静排版，方形封面、等宽时间、Victor 的页边点评和一枚朱砂印章承担全部个性，与 victorchun-site 的暖纸加琥珀是姐妹关系而非复制。

### Token

| token | 值或角色 | 用途 |
|---|---|---|
| --color-paper | 浅 oklch(0.985 0.004 250)，深 oklch(0.16 0.01 260) | 页面与卡片底 |
| --color-ink | 浅 oklch(0.21 0.02 260)，深 oklch(0.92 0.008 90) | 正文与标题、主按钮底 |
| --color-muted | 浅 oklch(0.55 0.01 260)，深 oklch(0.68 0.01 260) | 次要文字、另一语言标题 |
| --color-rule | 浅 oklch(0.90 0.01 250)，深 oklch(0.28 0.01 260) | 发丝线、次级按钮描边 |
| --color-seal | 浅 oklch(0.63 0.19 32)，深 oklch(0.72 0.17 32) | 只属于 going 系统：印章填充、焦点环、点评左线 |
| --color-seal-text | 浅 oklch(0.48 0.19 32)，深 oklch(0.80 0.14 32) | 纸面上的朱砂文字，对比 ≥ 4.5:1 |
| --color-cat-* 实色 | ai 靛 275、hackathon 芥末黄 95、vc 苔绿 145、campus 赭 65、conference 石板 235、cycling 青 190、social 梅紫 330；L 0.55–0.62、C 0.12–0.15，逐个核对与 paper 的 3:1 | 日历圆点、模板封面色场；chip 底为 `color-mix(in oklch, var(--color-cat-x) 12%, var(--color-paper))`，chip 文字一律 ink |
| --seal-sm、--seal-md、--seal-lg | 40、56、80 px | 96–112 px 封面、128–144 px 封面与精选卡、详情页 hero 与 /going |
| 字号 rem | 3.5、2.5、1.75、1.25、1、0.875、0.75 | display 到 caption |
| 行高 | zh 正文 1.7，en 正文 1.5，标题 1.3 | 语言相关 |
| 字距 | 正文 0，zh display 0.02em | 加 text-autospace: normal |
| 间距、圆角 | 4 px 基数；6、12、20 px，卡片 12、封面 8、chip 全圆 | 组件 |
| 阴影 | 浅色发丝边框，深色柔和阴影 | 卡片 |

规则：朱砂只属于 going 系统，任何类别、按钮或链接不得使用 32° 色相；RsvpButton 为 ink 底 paper 字，次级按钮（加日历、分享）为 rule 描边 ink 字。

### 字体与 CJK 加载

```css
/* src/app/globals.css */
@import "tailwindcss";
@import "../../public/fonts/noto-serif-sc/result.css";   /* cn-font-split 输出，每个 @font-face 带 unicode-range */
@import "../../public/fonts/noto-sans-sc/result.css";
@import "../../public/fonts/lxgw-wenkai/result.css";
@font-face { font-family: "Noto Serif SC Fallback"; src: local("PingFang SC"), local("Songti SC");
  size-adjust: 100%; ascent-override: 90%; descent-override: 25%; }   /* 数值按实测校准，减少换字回流 */
@font-face { font-family: "Noto Sans SC Fallback"; src: local("PingFang SC"), local("Microsoft YaHei");
  size-adjust: 100%; ascent-override: 90%; descent-override: 25%; }
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
@theme {
  --color-paper: oklch(0.985 0.004 250); --color-ink: oklch(0.21 0.02 260);
  --color-muted: oklch(0.55 0.01 260);  --color-rule: oklch(0.90 0.01 250);
  --color-seal: oklch(0.63 0.19 32);    --color-seal-text: oklch(0.48 0.19 32);
  --color-cat-ai: oklch(0.55 0.15 275);  --color-cat-hackathon: oklch(0.62 0.13 95);
  --color-cat-vc: oklch(0.58 0.13 145);  --color-cat-campus: oklch(0.62 0.14 65);
  --color-cat-conference: oklch(0.55 0.12 235); --color-cat-cycling: oklch(0.58 0.12 190);
  --color-cat-social: oklch(0.58 0.14 330);
  --font-display: var(--font-fraunces), "Noto Serif SC", "Noto Serif SC Fallback", "Noto Serif CJK SC", serif;
  --font-sans: var(--font-geist-sans), "Noto Sans SC", "Noto Sans SC Fallback", "Hiragino Sans GB", sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
  --font-note: var(--font-fraunces), "LXGW WenKai", "Noto Serif SC Fallback", serif;
  --text-display: 3.5rem; --text-h1: 2.5rem; --text-h2: 1.75rem; --text-h3: 1.25rem;
  --leading-zh: 1.7; --leading-en: 1.5; --leading-heading: 1.3;
  --seal-sm: 40px; --seal-md: 56px; --seal-lg: 80px;
  --radius-card: 12px; --radius-cover: 8px; --radius-sheet: 20px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) {
  --color-paper: oklch(0.16 0.01 260); --color-ink: oklch(0.92 0.008 90); --color-muted: oklch(0.68 0.01 260);
  --color-rule: oklch(0.28 0.01 260); --color-seal: oklch(0.72 0.17 32); --color-seal-text: oklch(0.80 0.14 32); } }
:root[data-theme=dark] {
  --color-paper: oklch(0.16 0.01 260); --color-ink: oklch(0.92 0.008 90); --color-muted: oklch(0.68 0.01 260);
  --color-rule: oklch(0.28 0.01 260); --color-seal: oklch(0.72 0.17 32); --color-seal-text: oklch(0.80 0.14 32); }
html:lang(zh) { --leading-body: var(--leading-zh); } html:lang(en) { --leading-body: var(--leading-en); }
body { background: var(--color-paper); color: var(--color-ink); line-height: var(--leading-body); text-autospace: normal; }
h1, h2, h3 { line-height: var(--leading-heading); font-weight: 600; font-synthesis-weight: none; overflow-wrap: anywhere; }
.note { font-family: var(--font-note); font-synthesis: none; } .note:lang(en) { font-style: italic; }
.tnum { font-variant-numeric: tabular-nums; }
```

```ts
// src/app/fonts.ts   拉丁字体走 next/font 与 geist 包，CJK 走上面 @import 的切片 CSS
import { Fraunces } from 'next/font/google';
import { GeistSans } from 'geist/font/sans';               // 导入路径以 geist 包 README 为准
import { GeistMono } from 'geist/font/mono';
export const fraunces = Fraunces({ subsets: ['latin'], axes: ['opsz'], style: ['normal', 'italic'],
  variable: '--font-fraunces', display: 'swap' });
export const fontVars = `${fraunces.variable} ${GeistSans.variable} ${GeistMono.variable}`;
```

策略：首屏 CJK 只加载两个字重，Noto Serif SC 600（标题）与 Noto Sans SC 400（正文与 chip），层级用字号与颜色表达；LXGW WenKai 400 只在 CuratorNote 出现，`font-display: swap`，不阻塞首屏。三者用 cn-font-split 7.x 切成 unicode-range 的 woff2 放 /public/fonts [cn-font-split](https://github.com/KonghaYao/cn-font-split)，CLI 参数以其 README 为准；混排 span 只设 lang 与字体栈，不改 line-height；拉丁字体永远排在 CJK 之前；OG 图和邮件标题用 Google Fonts `text=` 逐字子集。字体预算：en 首屏 ≤ 120 KB，zh 首屏 ≤ 300 KB（估算，Lighthouse CI 实测后校准），CJK 分片不 preload；标题容器给固定 `min-height`，配合 fallback @font-face 的度量覆盖避免换字回流。主题跟随系统，公开站不提供切换按钮；data-theme 只供后台 More 页的三态开关（系统、浅、深）与测试使用。

### 组件

| 组件 | 职责 | 状态 |
|---|---|---|
| SiteHeader 与 Wordmark | 56 px 头部，字标 + LangSwitch + 订阅入口，手机不吸顶；字标 zh「Victor 精选」Noto Serif SC 600，en「Victor's Picks」Fraunces opsz 72，左侧 20 px 朱砂小印刻「V」，同一印作 favicon 与 PWA 图标 192、512 | default |
| DayHeader | 吸顶，Geist Mono 日期 + Noto Sans SC 500 周几，底 1 px rule | today、past |
| EventCard | 列表行：左列 TimeBadge（Geist Mono 1.25rem tabular 的 18:30，下方 0.75rem 时长或「全天」）、112 px 手机或 144 px 桌面的 1:1 封面、当前语言标题（1.25rem，最多 2 行截断）与灰色另一语言标题（相同则不显示）、Geist Mono 元信息行、CategoryChip、CuratorNote；DateBadge（07 / 周三）只用于没有日期分组的上下文：精选卡、周报邮件、搜索结果 | default、featured、cancelled（划线）、past |
| CoverImage | next/image，thumbhash 占位与 dominant 底色，固定 aspect-ratio 盒，GoingBadge 叠左上；error 态是纯 CSS 瓦片（类别色底加同一个类别字），不再请求第二张图 | loading、loaded、template、error |
| FeaturedRail | 手机横向滚动 rail，每卡 260 px 宽、封面 228 px 1:1、点评 2 行，rail 高约 420 px；桌面 2–3 列网格，封面最大 320 px | 2–3 张 |
| GoingStrip | 首页横向 rail，64 px 封面加 --seal-sm 印章，总开关关闭时不渲染 | 空时隐藏 |
| CalendarGrid 与 WeekStrip | 月格与 7 天横条，类别圆点，点日滚动 | today、selected、has-events、empty |
| CategoryChip 与 FacetPanel | 多选真按钮，aria-pressed，32 px 高、手机 44 px；facet 折叠面板 | off、on、disabled、count |
| GoingBadge | 方形朱砂印章，纸色字，印面只刻当前语言一个标签：zh 两个汉字（会去、主办、分享、去过）Noto Serif SC 600 占印面 70%，en Geist Mono 700 大写（GOING、HOST、TALK、WENT）字距 0.08em，绝不中英同印；默认状态“想去”不盖章，只显示灰字；旋转 −3°，占位固定 | 四种状态加 hidden；三档尺寸 40、56、80 px |
| CuratorNote | Fraunces Italic（en）或 WenKai 正体（zh，最小 1rem，WenKai 无粗体，强调只靠朱砂左线与落款），2 px 朱砂左线，「— Victor」落款 | 1–2 行截断、展开 |
| DateTime | Intl 输出，`<time datetime>`，线上活动加访客本地与北京时间 | single、range、all-day、relative |
| RsvpButton 与 AddToCalendarMenu | ink 底纸色字加外链图标；菜单 Apple、Outlook、.ics、Google，zh 顺序固定 | default、sold-out |
| CoverAttribution | 0.75rem muted，「Cover: 主办方 via 平台」或 Openverse 署名 | official、openverse、template（不显示） |
| SubscribeForm 与 PrefsForm | 类别 chip、语言、going 提醒、Server Action 提交、行内双语错误；PrefsForm 复用 chip，多暂停与退订段 | idle、submitting、pending-confirm、error、rate-limited |
| LangSwitch | 头部 `EN 丨 中` 药丸，保持当前路径，写 cookie | en、zh |
| DigestArchive | /weekly 网页版，与邮件同结构 | issue |
| EmptyState | 点评口吻的双语一句话，淡印章水印，附 ICS 与订阅链接 | no-events、filtered-out、cancelled-only |
| SiteFooter | 关于、隐私、RSS、ICS、语言 | default |

### 响应式与动效

断点 390 px 手机、768 px 平板、1024 px 桌面、1280 px 宽屏；手机单列、16 px 边距、无横向滚动，标题列约 246 px（390 − 32 边距 − 48 时间列 − 112 封面 − 24 间距，估算），月历在 1024 px 以下换 agenda，后台操作栏粘底且目标 44 px。动效：卡片到详情的封面 morph 与周切换用 React ViewTransition，Next 16 无需配置 [View Transitions 指南](https://nextjs.org/docs/app/guides/view-transitions)；chip 与收件箱滑动用 motion 的 m + LazyMotion(domAnimation)，初始约 4.6 kb [Motion 体积](https://motion.dev/docs/react-reduce-bundle-size)；时长 150–250 ms，印章进场 120 ms 从 1.15 缩到 1；`prefers-reduced-motion` 下全部 duration 置 0。

### 图片、性能、无障碍

封面变体 400、800、1600 方形 WebP 加双语 1200×630 OG，`sizes` 按槽位写（列表 `112px` 或 `144px`，精选 `(max-width: 768px) 228px, 320px`），首屏前两张封面 `preload`，每个封面都有显式 aspect-ratio 盒 [next/image 文档](https://nextjs.org/docs/app/api-reference/components/image)。预算：LCP ≤ 2.5 s、INP ≤ 200 ms、CLS ≤ 0.1，均按 p75 [Web Vitals](https://web.dev/articles/vitals)；首页 JS ≤ 120 KB gz。无障碍：文字对比 ≥ 4.5:1、chip 与印章 ≥ 3:1，两套主题都测；文字不压在图上，必要时加遮罩；焦点环 2 px 朱砂且与未聚焦态对比 ≥ 3:1；点击目标 ≥ 24 px、手机 44 px [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)；混排 span 带 lang 属性；表单标签与错误双语。Lighthouse a11y 目标 ≥ 95。

### 邮件模板

600 px 单栏，token 全部内联；zh 正文字体栈 `"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`，只有标题用 `"Songti SC", SimSun, serif`，en 用 Georgia 与系统 sans；zh 正文 16 px、line-height 1.7、段距 12 px，en 正文 16 px、line-height 1.5；web 字体只有约 24% 客户端支持 [caniemail @font-face](https://www.caniemail.com/features/css-at-font-face/)。96 px 方形封面缩略图带 alt；印章用站点托管的 48 px（@2x PNG，两种语言各一套）加文字兜底 [会去] / [GOING]；点评块保留左线；颜色用实色 bgcolor 块，`color-scheme` meta 支持深色，Gmail 与 Apple Mail 支持 prefers-color-scheme 约 42% [caniemail 深色](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/)；react-email 6 从 `react-email` 导入组件，`@react-email/components` 已弃用 [React Email 手动安装](https://react.email/docs/getting-started/manual-setup)。

## 隐私、合规与反滥用

合规基线是 CAN-SPAM 加 Gmail 与 Yahoo 的批量发件人规则，隐私基线是 CalOPPA 的隐私政策加最小化存储；「Victor 会去」是有名有姓的人提前公布行踪，所以有一条可自动执行的安全规则。

### 邮件合规

- 每封 digest 含真实发件人、诚实主题行、可见退订链接和 RFC 8058 头；退订即时生效，远快于 CAN-SPAM 的 10 个工作日 [FTC CAN-SPAM 指南](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)。
- 主题行不得误导，加州 B&P 17529.5 每封可罚 $1,000；不写「You're invited」这类诱导句。
- 双重确认（confirmed opt-in）是 M3AAWG 评为最佳的做法，同时防 list bombing [M3AAWG Sender BCP v4.0](https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-sender-best-common-practices-aug-27-2026.pdf)。
- 不放邮寄地址：CAN-SPAM 的地址要求只针对商业邮件，本周报无广告无赞助；若将来有赞助位，先补一个非住宅邮寄地址，面向大陆收件人的商业邮件主题需前置「广告」或「AD」，且 Vercel 要换 Pro。

### 隐私

- /privacy 双语，列出：身份与联系方式、收集的数据（邮箱、类别、语言、同意时间与 IP、可选姓名）、目的、处理方（Resend、Vercel、Neon、Upstash）、不出售不共享、保留期、删除与访问方式、DNT 与 GPC 立场、是否追踪打开点击、生效日期、变更通知方式 [CalOPPA 条文](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=8.&title=&part=&chapter=22.&article=)。
- 打开与点击追踪默认关闭；同意日志（时间、IP、UA、来源页、类别）满足 GDPR Art 7 的举证要求，虽然本站不面向欧盟 [GDPR Art 3](https://gdpr-info.eu/art-3-gdpr/)。
- 邮箱只用于发信，所有 URL 只带 HMAC 派生的 token；候选收件箱只存元数据和 300 字摘要，不存邮件正文；日志脱敏；Settings 一键清空。
- 对大陆读者优先提供 ICS 与微信群这类不收集数据的渠道，降低 PIPL 域外适用的暴露 [PIPL 原文](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)。

### Going 状态安全规则

- 新活动默认 interested，公开只显示描边印章，不传达到场时间。
- going 公开必须同时满足：活动公开且在 Luma、Partiful、Eventbrite、Meetup 之一有页面；形式为线上或线下非私人场地；类别不是 cycling；going_visibility = public。任一不满足，后台自动降为 after_event 并说明原因。
- 私人场地的判定，满足任一即算：Luma 页面 `__NEXT_DATA__` 的 location_visibility 非 public（地址报名后可见）、页面只有街道地址没有场地名、地址含 Apt、Unit 或 #、或 Victor 在编辑器勾选「私人场地」。重复性活动 = 同一 host_url 与同一 venue_name 4 周内出现 ≥ 2 次，由系统判定，这类活动只在结束后以「去过」出现。
- 公开页只显示城市或街区，街道地址在官方链接背后；Luma 自己也提供「仅报名者可见地址」的机制 [Luma 隐藏地址](https://help.luma.com/p/hiding-your-event-location)。
- 骑行团骑和起点永不发布。
- 总开关是 settings 表的 `show_attendance` 行：/admin/settings 的 Server Action 写入后调 `updateTag('events')` 并让 going.ics 失效，站点与 /going 5 秒内生效，going.ics 最长 15 分钟（CDN 缓存）；环境变量 `SHOW_ATTENDANCE=false` 只作部署期强制覆盖，改它需要重新部署。
- digest 文案写「打算去」，不写时间。

### 反滥用与安全

- 订阅 Server Action：BotID Basic、蜜罐、≥ 3 s 填写时间、Upstash 每 IP 10 分钟 5 次与每邮箱每天 3 次、1 条 Hobby WAF 规则指向 /subscribe 与 /zh/subscribe 的 POST [Upstash Ratelimit](https://upstash.com/docs/redis/sdks/ratelimit-ts/gettingstarted)。
- /api/ingest 与 /api/index：令牌每小时 60 次；抓取器 SSRF 白名单与 IP 校验（见「封面图获取」一节）；Resend 与 cron 端点分别验 Svix 签名与 `CRON_SECRET`。
- 内容策略：只存事实、链接和 Victor 自己的文字；不复制主办方文案与图片文件；Eventbrite 的条款禁止自动抓取，因此 Eventbrite 只在 Victor 手动贴链接时按单页读取 [Eventbrite 条款](https://www.eventbrite.com/help/en-us/articles/251210/eventbrite-terms-of-service/)。
- 大陆可达性：*.vercel.app 在 GreatFire 测试中 100% 被干扰，必须用自定义域名，且不承诺大陆可用 [GreatFire vercel.app](https://en.greatfire.org/vercel.app)。

## 部署、运维与成本

部署是一个 Vercel Hobby 项目加四个 Marketplace 集成，非商业运行时月成本在订阅者不到 90 人时约 $2–5、500 人约 $22–25、5,000 人约 $22–30（估算）；含 Vercel Pro 与 Image Optimization 超额时 5,000 人约 $42–60。

### 部署步骤

1. 买域名，把 `picks.<domain>` 指向 Vercel，`mail.<domain>` 留给 Resend。
2. GitHub 建私有仓库 `victory-c/victor-picks`，`vercel link` 建项目，Production 分支 main，每个 PR 自动出预览和 Neon 分支。
3. Marketplace 安装 Neon、Resend、Upstash（`vercel integration` 子命令以 `--help` 为准），Blob 在 Storage 页创建；这些集成自动注入环境变量。
4. Resend 添加 `mail.<domain>`，按生成的记录写 DKIM、SPF，再加 DMARC `p=none`。
5. 设 `vercel.json` 的三条 cron，Hobby 每条每天一次且误差 ±59 分。
6. 首次登录：设 `ADMIN_EMAIL`，用 magic link 进 /admin/sign-in，注册 iPhone 与 Mac 的 passkey，在 Settings 生成快捷指令令牌。

### 环境变量

| 变量 | 来源 | 用途 |
|---|---|---|
| DATABASE_URL、DATABASE_URL_UNPOOLED | Neon 集成 | Drizzle 连接，迁移用 unpooled |
| BETTER_AUTH_SECRET、BETTER_AUTH_URL、ADMIN_EMAIL | 手填 | 鉴权与白名单 |
| SUBSCRIBER_LINK_SECRET | 手填 | 偏好中心与退订链接的 HMAC；轮换 = 换密钥并重发 |
| RESEND_API_KEY、RESEND_WEBHOOK_SECRET、RESEND_FROM | Resend 集成与控制台 | 发信、验签 |
| BLOB_READ_WRITE_TOKEN | Blob 存储 | 封面上传 |
| UPSTASH_REDIS_REST_URL、UPSTASH_REDIS_REST_TOKEN | Upstash 集成 | 限流、锁 |
| AI_GATEWAY_API_KEY | 可选；Vercel 上用 OIDC 自动认证 | AI SDK |
| CRON_SECRET | 手填 | cron 端点 Bearer |
| GCAL_SECRET_ICS_URL、LUMA_PERSONAL_ICS_URL、PARTIFUL_ICS_URL | 三个服务的设置页 | 候选收件箱 |
| BRAVE_SEARCH_API_KEY | Brave 控制台（P1） | 图片候选（可选） |
| PUBLIC_HOST | 手填 | 域名 |
| SHOW_ATTENDANCE | 手填，可选 | 部署期强制隐藏出席，改动需重新部署；日常开关在 settings 表 |
| GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、TOKEN_ENC_KEY | P2 | OAuth 与 refresh token 加密 |

### 定时任务与监控

| cron | 时刻 | 任务 |
|---|---|---|
| 0 13 * * * | 13:00 UTC，即 06:00 PDT | /api/cron/sync：拉三条 ICS，过期候选清理，jobs_log |
| 0 1 * * * | 01:00 UTC，即周日 18:00 PDT 或 17:00 PST | /api/cron/digest：send_after ≤ now 且未发时发送 |
| 0 2 * * * | 02:00 UTC，即周日 19:00 PDT 或 18:00 PST | /api/cron/digest：同上，补发第一次未到时间或未完成的 claim 行 |

Vercel 不重试失败的 cron [Cron 定价](https://vercel.com/docs/cron-jobs/usage-and-pricing)，所以任务都靠 Upstash 锁和 claim 行幂等；`jobs_log` 记每次运行，后台 More 页显示最近 7 天状态，连续两次失败时用 Resend 给 Victor 发一封告警。每周 GitHub Actions 跑一次适配器 fixture 测试，标记格式漂移；DMARC 聚合报告发到专用别名；Vercel Web Analytics Hobby 看页面浏览，转化事件写数据库。

### 月成本

| 项目 | 0–90 订阅者 | 500 订阅者 | 5,000 订阅者 |
|---|---|---|---|
| 域名 | $1–2（年费摊销，估算） | 同 | 同 |
| Vercel | Hobby $0 | $0 | $0；商业化则 Pro $20 |
| Neon Postgres | $0 | $0 | $0，超 0.5 GB 后 $0.35/GB 月 |
| Resend 发信 | $0（每天 100 封内，收信也计数）；M4 开启 Gmail 转发起 Pro $20 | Pro $20 | Pro $20（每周约 5,000 封在 5 万封内） |
| Upstash Redis | $0 | $0 | $0 |
| 图片存储 Blob | $0（每年约 80 MB，估算） | $0 | $0 |
| Image Optimization | $0（预切尺寸，每月 5k 次内） | $0 | 可能超 5k 次，Hobby 超限返回 402，需 Pro 后每 1k 次 $0.05 起 [Image Optimization 定价](https://vercel.com/docs/image-optimization/limits-and-pricing) |
| AI 文本（抽取与翻译） | $0.5–2（估算） | 同 | 同 |
| AI 图像生成（P1） | $0–1（估算，recraft flash 每张 $0.007） | 同 | 同 |
| 图片搜索 Brave（P1） | $0（每月 $5 免费额度约 1,000 次） | $0 | $0–5 |
| 合计（非商业） | 约 $2–5 | 约 $22–25 | 约 $22–30 |
| 合计（含 Pro 与 Image Optimization 超额） | 不适用 | 约 $42–45 | 约 $42–60 |

## 分步实施计划：项目结构、起步命令、按周任务清单

按判定的六个里程碑排 16 周到 M3 软发布（M2 2026-12-13、M3 2027-01-17、M4 2027-02-14），每周 10–15 小时，12 月中旬期末周只留 cron 和文案类工作。

```text
victor-picks/
├── src/
│   ├── app/
│   │   ├── [locale]/            # 公开站：page、events/[slug]、calendar、week、going、archive、weekly、subscribe、about、privacy
│   │   ├── admin/               # PWA：add、drafts、live、e/[id]、inbox、digest、subscribers、settings、sign-in
│   │   ├── api/                 # ingest、index、unsubscribe、webhooks/resend、inbound、cron/*、auth/[...all]、covers/upload、og/[slug]
│   │   ├── calendar.ics/ calendar/going.ics/ ics/[slug]/   # Route Handlers；/events/:slug.ics 由 rewrite 指到 /ics/:slug
│   │   ├── feed.xml/ sitemap.ts robots.ts globals.css fonts.ts
│   ├── proxy.ts                 # next-intl + /admin 乐观重定向
│   ├── i18n/                    # routing.ts、navigation.ts、request.ts
│   ├── components/              # SiteHeader、DayHeader、EventCard、CoverImage、FeaturedRail、GoingStrip、CalendarGrid、WeekStrip、CategoryChip、FacetPanel、GoingBadge、CuratorNote、DateTime、RsvpButton、AddToCalendarMenu、CoverAttribution、SubscribeForm、PrefsForm、LangSwitch、DigestArchive、EmptyState、SiteFooter
│   ├── emails/                  # digest.tsx、confirm.tsx、magic-link.tsx（react-email）
│   └── lib/
│       ├── db/                  # schema.ts、index.ts、queries（'use cache' + cacheTag('events')）
│       ├── auth.ts tokens.ts subscribers/token.ts
│       ├── ingest/              # normalize.ts、safe-fetch.ts、adapters/{luma,partiful,eventbrite,meetup,generic}.ts、extract.ts、dedupe.ts
│       ├── covers/              # chain.ts、store.ts、template.tsx、og.tsx、openverse.ts、ai.ts、brave.ts
│       ├── inbox/               # sync-ics.ts、candidates.ts、parse-mail.ts
│       ├── digest/              # assemble.ts、render.ts、send.ts
│       ├── calendar-links.ts format/date.ts ratelimit.ts settings.ts
├── messages/ en.json zh.json
├── public/fonts/                # cn-font-split 输出
├── fixtures/                    # 各平台保存的 HTML，供适配器测试
├── drizzle/ tests/ e2e/ vercel.json next.config.ts drizzle.config.ts
```

```bash
pnpm dlx create-next-app@latest victor-picks --ts --app --src-dir --use-pnpm   # 选 Turbopack、Tailwind；flag 以 CLI --help 为准
cd victor-picks
pnpm add next-intl drizzle-orm @neondatabase/serverless better-auth @better-auth/passkey resend react-email \
  ical-generator @touch4it/ical-timezones ai zod @vercel/blob sharp thumbhash node-ical cheerio undici ipaddr.js \
  @upstash/redis @upstash/ratelimit botid date-fns @date-fns/tz motion geist metascraper
pnpm add -D drizzle-kit vitest @playwright/test @lhci/cli cn-font-split tsx
pnpm dlx @next/codemod@canary middleware-to-proxy .      # 若模板生成了 middleware.ts
vercel link && vercel env pull .env.local               # Marketplace 集成在控制台安装后再 pull
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
pnpm dlx @better-auth/cli generate                      # 生成 Better Auth 的 Drizzle 表
pnpm dlx cn-font-split -i fonts-src/NotoSerifSC-SemiBold.otf -o public/fonts/noto-serif-sc   # 参数以 README 为准
pnpm dlx playwright install --with-deps
```

### 按周清单

**M0 基础（到 2026-10-11）**
- [ ] 第 1 周（9/28–10/4）：买域名；建仓库与 Vercel 项目；Next 16.3.6 加 next-intl proxy.ts；Neon 加 Drizzle schema（含 settings 表）与迁移；写 tokens 与 globals.css
- [ ] 第 2 周（10/5–10/11）：Better Auth magic link 加 passkey 与白名单；Resend 域名 SPF、DKIM、DMARC；Upstash 与 Blob；cn-font-split 管线与 fallback 度量；victorchun-site 升到 16.3.7；门槛：iPhone Face ID 与 Mac Touch ID 登录 /admin，pnpm test 与 Playwright 冒烟在预览分支通过

**M1 公开站与 feed（到 2026-11-08）**
- [ ] 第 3 周：SiteHeader、DayHeader、EventCard、CoverImage、CategoryChip、GoingBadge、CuratorNote、DateTime、LangSwitch、EmptyState、SiteFooter
- [ ] 第 4 周：首页本周视图（FeaturedRail、GoingStrip）、详情页（RsvpButton、AddToCalendarMenu、CoverAttribution）、JSON-LD、hreflang、sitemap，两种语言
- [ ] 第 5 周：CalendarGrid 与 WeekStrip、FacetPanel、/going、/archive、RSS
- [ ] 第 6 周：三条 ICS handler 与 rewrite、加入日历按钮与快照测试、20 个手录活动；门槛：Lighthouse 性能 ≥ 90、a11y ≥ 95，ICS 在 Apple Calendar 与 Google 导入正确

**M2 后台、ingest、封面、快速添加（到 2026-12-13）**
- [ ] 第 7 周：safe-fetch 与 SSRF 测试；Luma、Partiful 适配器与 fixture；extract 的 AI schema
- [ ] 第 8 周：Eventbrite、Meetup、通用适配器；/api/ingest 全流程含 publish 模式同步模板封面、202 与 409；/api/index
- [ ] 第 9 周：封面链 1–3 步、store.ts、og.tsx；选择器的上传与粘贴 URL
- [ ] 第 10 周：后台 PWA 外壳、Add、Drafts、Live、编辑器、Settings 令牌与总开关；iOS 快捷指令两枚与 Android share_target；20 个真实活动从手机添加并计时
- [ ] 第 11 周（12/7–12/13）：收件箱 P0（三条 ICS、skill 推送、去重、忽略与稍后）；weekly-events skill 加末步 POST；门槛：分享到草稿 p50 ≤ 6 s，全部适配器测试绿，每个发布活动都有封面，总开关验证

**M3 Newsletter 与软发布（到 2027-01-17）**
- [ ] 第 12 周（12/14–12/20，期末）：只做 cron 端点骨架与 UI 文案
- [ ] 第 13 周：订阅表单 Server Action 加 BotID、双重确认、/confirm、/prefs、HMAC token、RFC 8058 端点、Resend webhook
- [ ] 第 14 周：react-email digest 模板与快照、digest 组装与变体分组、claim 式 Batch 发送、两条周日 cron
- [ ] 第 15 周：/privacy 双语、五个种子邮箱测试、微信文本导出
- [ ] 第 16 周（1/11–1/17）：向朋友、ACE@Berkeley、微信群软发布；门槛：连续两个周日准时发出，≥ 50 确认订阅者，种子 0 退回，Gmail 一键退订验证

**M4 收件箱 P1 与中文渠道（到 2027-02-14）**
- [ ] Gmail 过滤器转发 → Resend Inbound → 解析（含 roundup 折叠）并升级 Resend Pro；封面选择器的 Openverse、AI 生成、Brave 建议；微信长图与小红书导出；going 提醒；活动语言与线上偏好；每月订阅者 CSV 导出到 Blob；发布帖

**M5 加固与 P2（到 2027-03-31）**
- [ ] Google OAuth 连接（如需 RSVP）；MCP 与 Ask 工具；Luma 镜像日历（仅在买 Luma Plus 时）；商业化则升 Pro；更新 PROGRESS.md 与决策备忘

## 参考来源：调研时实际打开过的文档

以下是本 tab 引用的来源，全部在 2026-09-27 前后实际打开核对。

- [Next.js proxy.js 文件约定](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Next.js 2026-09-22 安全公告](https://nextjs.org/blog/nextjs-security-update-september-22-2026)
- [next-intl App Router 带 i18n 路由的设置](https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing)
- [next-intl 博客：Next.js 16.3 的 next/root-params](https://next-intl.dev/blog/nextjs-root-params)
- [Google Search Central：本地化版本与 hreflang](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Next.js generateMetadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Next.js Image 组件](https://nextjs.org/docs/app/api-reference/components/image)
- [Next.js ImageResponse](https://nextjs.org/docs/app/api-reference/functions/image-response)
- [Next.js View Transitions 指南](https://nextjs.org/docs/app/guides/view-transitions)
- [Neon 定价](https://neon.com/pricing)
- [Better Auth passkey 插件](https://www.better-auth.com/docs/plugins/passkey)
- [Better Auth magic link 插件](https://www.better-auth.com/docs/plugins/magic-link)
- [Resend Batch 发送 API](https://resend.com/docs/api-reference/emails/send-batch-emails)
- [Resend 账户配额与限制](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Resend 添加与验证域名](https://resend.com/docs/add-a-domain)
- [Resend 收信（Inbound）](https://resend.com/docs/dashboard/receiving/introduction)
- [React Email 手动安装](https://react.email/docs/getting-started/manual-setup)
- [ical-generator](https://github.com/sebbo2002/ical-generator)
- [Luma 帮助：iCal 同步](https://help.luma.com/p/ical-syncing)
- [Luma 帮助：活动封面图](https://help.luma.com/p/event-cover-images)
- [Luma 帮助：隐藏活动地址](https://help.luma.com/p/hiding-your-event-location)
- [Luma 使用条款](https://luma.com/terms)
- [Luma 活动页实测（Startup Speedrun Hackathon）](https://luma.com/g42o84ln)
- [Partiful 活动页实测](https://partiful.com/e/Fk5FC9HoQ1czq3Uspro6)
- [Partiful 服务条款](https://partiful.com/terms)
- [Partiful 帮助：同步到 Google Calendar](https://help.partiful.com/hc/en-us/articles/15525660-sync-to-google-calendar)
- [Eventbrite 服务条款](https://www.eventbrite.com/help/en-us/articles/251210/eventbrite-terms-of-service/)
- [AI SDK：生成结构化数据](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [Vercel AI Gateway 定价](https://vercel.com/docs/ai-gateway/pricing)
- [AI Gateway 模型列表与价格](https://ai-gateway.vercel.sh/v1/models)
- [Vercel Blob 用量与定价](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [Vercel Image Optimization 限制与定价](https://vercel.com/docs/image-optimization/limits-and-pricing)
- [Vercel Functions 限制](https://vercel.com/docs/functions/limitations)
- [Vercel Cron Jobs 用量与定价](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel BotID](https://vercel.com/docs/botid)
- [Upstash Ratelimit 入门](https://upstash.com/docs/redis/sdks/ratelimit-ts/gettingstarted)
- [OWASP SSRF 防护备忘单](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Openverse API 图片查询实测](https://api.openverse.org/v1/images/?q=hackathon&page_size=2)
- [Brave Search API](https://brave.com/search/api/)
- [ThumbHash](https://evanw.github.io/thumbhash/)
- [MDN browser-compat-data（share_target）](https://unpkg.com/@mdn/browser-compat-data/data.json)
- [Apple 快捷指令：从其他 App 运行快捷指令](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-another-app-apd163eb9f95/ios)
- [Google：使用 OAuth 2.0 访问 Google API](https://developers.google.com/identity/protocols/oauth2)
- [Google Cloud 帮助：未验证的应用](https://support.google.com/cloud/answer/7454865)
- [Google：品牌验证与豁免](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google：受限 scope 验证](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Google Calendar 帮助：私密 iCal 地址](https://support.google.com/calendar/answer/37648)
- [Google Calendar 帮助：管理邀请](https://support.google.com/calendar/answer/13159188?hl=en&co=GENIE.Platform%3DDesktop)
- [Gmail 帮助：自动转发](https://support.google.com/mail/answer/10957)
- [Apps Script 服务配额](https://developers.google.com/apps-script/guides/services/quotas)
- [node-ical](https://github.com/jens-maus/node-ical)
- [Google Calendar ICS 订阅链接（Simon Willison TIL）](https://til.simonwillison.net/ics/google-calendar-ics-subscribe-link)
- [add-event-to-calendar-docs：Google](https://interactiondesignfoundation.github.io/add-event-to-calendar-docs/services/google.html)
- [FTC CAN-SPAM 合规指南](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [Gmail 发件人指南 FAQ](https://support.google.com/a/answer/14229414)
- [RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058)
- [M3AAWG Sender Best Common Practices v4.0](https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-sender-best-common-practices-aug-27-2026.pdf)
- [加州 CalOPPA（B&P 22575–22579）](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=8.&title=&part=&chapter=22.&article=)
- [GDPR Art 3](https://gdpr-info.eu/art-3-gdpr/)
- [中华人民共和国个人信息保护法](https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm)
- [GreatFire：vercel.app](https://en.greatfire.org/vercel.app)
- [Tailwind CSS 主题变量](https://tailwindcss.com/docs/theme)
- [cn-font-split](https://github.com/KonghaYao/cn-font-split)
- [Google Fonts 元数据：Noto Sans SC](https://fonts.google.com/metadata/fonts/Noto%20Sans%20SC)
- [next/font/google 的 unicode-range 讨论 #47309](https://github.com/vercel/next.js/discussions/47309)
- [W3C 中文排版需求 CLReq](https://www.w3.org/TR/clreq/)
- [Motion：减小打包体积](https://motion.dev/docs/react-reduce-bundle-size)
- [web.dev Web Vitals](https://web.dev/articles/vitals)
- [WCAG 2.2 理解 SC 2.5.8 目标尺寸](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Can I email：@font-face](https://www.caniemail.com/features/css-at-font-face/)
- [Can I email：prefers-color-scheme](https://www.caniemail.com/features/css-at-media-prefers-color-scheme/)
- [Litmus：Gmail 截断](https://www.litmus.com/blog/how-to-keep-gmail-from-clipping-your-emails)
