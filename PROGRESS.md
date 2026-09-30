# PROGRESS · Victor's Picks · Victor 精选

Cross-session state. Read at session start, update before ending. Sources of truth: `PRD.md` and `IMPLEMENTATION_GUIDE.md`; on conflict the guide wins and the conflict is logged below.

## 你需要亲手做的外部步骤（checklist）

Secrets, tokens and private iCal URLs go only into `.env.local` or Vercel env. Never paste them into chat, code or docs.

| # | 步骤 | 何时需要 | 状态 |
|---|---|---|---|
| 1 | 买域名，决定 `picks.<domain>`（站点）和 `mail.<domain>`（Resend 发信）。买好后告诉我域名，我改 `PUBLIC_HOST` 并在 Vercel 绑定 | M3 newsletter 首发前（Resend 发信的前置） | ⏸ 2026-09-30 决定暂不买，继续用 `victor-picks.vercel.app` |
| 2 | Vercel 控制台 → 项目 → Integrations/Marketplace：安装 **Neon**、**Resend**、**Upstash Redis**；Storage 页创建 **Blob** store 并连到项目。装完我跑 `vercel env pull` | M0 第 2 周 | ⬜ 未装时站点用种子数据 |
| 3 | Resend：添加 `mail.<domain>`，把它生成的 DKIM、SPF 记录加到 DNS，再加 DMARC `v=DMARC1; p=none; rua=mailto:<你的别名>` | 域名买好后（M3 前） | ⏸ 随第 1 项推迟 |
| 4 | Google Calendar（**berkeley.edu 账号**）：设置 → 选日历 → Integrate calendar → 看有没有「Secret address in iCal format」。Workspace 管理员可能隐藏了它：**没有就改用个人 Gmail 日历**并告诉我。有的话复制到 Vercel env `GCAL_SECRET_ICS_URL` | M2 第 11 周 | ⬜ |
| 5 | Google Calendar：Settings → Event settings → 「Add invitations to my calendar」设为 **From everyone**，否则 Luma 邀请不会进日历 | 同上 | ⬜ |
| 6 | Luma：Settings → Calendar Syncing → Add iCal Subscription，复制 URL 到 Vercel env `LUMA_PERSONAL_ICS_URL` | M2 第 11 周 | ⬜ |
| 7 | Partiful：桌面版 Calendar sync → Copy Link，存到 Vercel env `PARTIFUL_ICS_URL` | M2 第 11 周 | ⬜ |
| 8 | Vercel AI Gateway：团队设置里绑定支付方式（约 $0.5–2/月） | M2 第 7 周 | ⬜ |
| 9 | 在 Vercel env 设 `ADMIN_EMAIL`（后台唯一允许登录的邮箱）、`BETTER_AUTH_SECRET`、`CRON_SECRET`、`SUBSCRIBER_LINK_SECRET`（各用 `openssl rand -base64 32` 生成） | M0 第 2 周 | ⬜ |
| 10 | 首次登录 /admin/sign-in：用 magic link 登录，然后在 iPhone（Face ID）和 Mac（Touch ID）各注册一个 passkey（G0 门槛） | M0 第 2 周部署后 | ⬜ |
| 11 | 安装两个 iOS 快捷指令（Add to Picks、Add & Publish），我会给 iCloud 链接和令牌生成步骤 | M2 第 10 周 | ⬜ |
| 12 | 批准把 `m0-foundations` 和 `m1-public-site` 合并进 `main` | G1 验证前 | ✅ 2026-09-28 已合并（#1、#2，以及修正 #3），生产站 `https://victor-picks.vercel.app` 公开可访问 |
| 13 | G1 实测：iPhone「设置 → 日历 → 账户 → 添加已订阅的日历」填 `webcal://victor-picks.vercel.app/calendar.ics?lang=zh`，Google Calendar 用「通过网址添加」填同一地址的 https 版；看活动时间是否是本地时间、改期后是否更新 | 第 12 项之后 | ✅ 2026-09-30 你已订阅，没有问题 |
| 14 | 给我 20 场你真的想推荐的活动（链接 + 一句点评即可），替换示例数据。M2 的后台做好后也可以自己录 | M1 第 6 周 | ⬜ |

## 当前状态

- 分支：M0（#1）、M1（#2）和生产验证后的修正（#3）都已于 2026-09-28 合并进 `main`，生产站已部署并抽查通过
- 生产站：`https://victor-picks.vercel.app`（公开，种子模式，顶部有「示例数据」横幅）
- 里程碑：M0 代码完成，G0 差 passkey 真机登录（checklist 2、9、10）和 DKIM/DMARC（随域名推迟到 M3 前）；**M1 完成，G1 于 2026-09-30 全部通过**，可以进 M2
- M2：第 7–8 周（ingest 管线，#6）已合并；第 9 周封面管线在分支 `m2-covers`，PR 待你审；下一步第 10 周后台 PWA
- 域名：2026-09-30 决定暂不买，继续用 `*.vercel.app`。影响见「待确认」里的域名一条

- Vercel 项目：`victor-picks`（victory-c-8190s-projects），已连 GitHub，推送分支自动出预览
- 分支固定预览地址：`https://victor-picks-git-m0-foundations-victory-c-8190s-projects.vercel.app`（受 Vercel Authentication 保护：登录 Vercel 即可看；给别人看需要临时分享链接，23 小时有效）
- 预览目前是种子模式（Vercel 上还没有数据库），页面顶部有「示例数据」横幅

## 周记录

### M0 第 1 周（9/28–10/4）

做了什么
- Next.js 16.3.6 App Router 脚手架（Turbopack、TypeScript strict、Tailwind 4、pnpm）；`cacheComponents: true`。
- next-intl 4.14.7：`as-needed` 前缀、`/zh` 路由、Accept-Language 首访跳转、`NEXT_LOCALE` cookie 一年；`src/proxy.ts` 同时做 /admin 乐观重定向；`src/i18n/request.ts` 用 `next/root-params`。
- Drizzle schema：13 张业务表 + 3 个 enum + `events_public` 视图（剔除 `created_via`、`auto_fields`，地址只在 `address_public` 时出现）；首个迁移 `drizzle/0000_init.sql`；`scripts/migrate.ts` 应用迁移并写入 settings 默认行（`show_attendance` 等）。
- 数据库连接：Neon 主机走 `@neondatabase/serverless` HTTP，本地走 node-postgres；本地库 `victor_picks` 已迁移。
- 设计 token：`src/lib/tokens.ts` + `globals.css`（纸、墨、灰、线、朱砂、7 类别色，明暗两套）；对比度测试全过（最低的是 hackathon 芥末黄 3.48:1，muted 4.65:1）。
- 日期格式 `src/lib/format/date.ts`：zh「10月7日周三 18:30–20:00 北美太平洋时间」、en「Wed, Oct 7 · 6:30 – 8:00 PM PT」、北京时间、`<time datetime>` 偏移。
- 三条 cron 写进 `vercel.json`，端点先是带 `CRON_SECRET` 校验的空壳。
- 测试：Vitest（日期、token 对比度、schema 约束用 PGlite 跑真迁移），Playwright 冒烟（/、/zh、html lang、zh 首访跳转、无横向滚动、/admin 重定向），GitHub Actions CI。

- Vercel：建项目 `victor-picks` 并连 GitHub；`vercel.json` 固定 `framework: nextjs`；`pnpm-workspace.yaml` 显式批准构建脚本（pnpm 12 在 CI 里遇到未批准的脚本会直接失败）；`engines.node` 固定 `22.x`。
- 首个预览部署 READY。

检查结果：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过（Vitest 23 个用例，Playwright 冒烟 10 个用例：手机与桌面各 5 个）。

### M0 第 2 周（10/5–10/11，提前完成）

做了什么
- Better Auth 1.7.6：magic link（5 分钟有效）+ passkey 插件 + 白名单 before hook（非 `ADMIN_EMAIL` 连注册都 403）；30 天滚动会话；`/api/auth/[...all]`；`/admin` 是独立根布局，`/admin/sign-in` 登录页，`/admin` 首页可添加 passkey 与退出；proxy 改用 `getSessionCookie`；Server Component 用 `requireAdmin()` 再验一次。
- Better Auth 表用官方 CLI 生成（`auth` 包，见文档冲突 8），迁移 `drizzle/0001_auth.sql`。
- 邮件：`sendEmail()` 包一层 Resend；没有 `RESEND_API_KEY` 时写进服务器日志（邮箱脱敏）。没有验证域名前默认发件人是 Resend 的 `onboarding@resend.dev`，它只能发给 Resend 账号本人的邮箱：所以 `ADMIN_EMAIL` 请设成你注册 Resend 用的邮箱。
- 限流：`src/lib/ratelimit.ts`，有 Upstash 就用滑动窗口，没有就用进程内固定窗口；阈值按指南（订阅每 IP 10 分钟 5 次、每邮箱每天 3 次、令牌每小时 60 次）。
- CJK 字体：`pnpm fonts:cjk` 下载官方 OFL 源文件 → fontTools 按 GB 2312 子集化（8,247 字）→ cn-font-split 切片 → `public/fonts/cjk.css`（Noto Serif SC 600 + Noto Sans SC 400，gzip 40 KB）和 `cjk-note.css`（霞鹜文楷，gzip 20 KB）。只在 zh 页面和 /admin 链接；切片文件带内容哈希、一年 immutable 缓存。回退字体的 ascent/descent 用 Noto 实测值（116% / 28.8%，衬线 115.1% / 28.6%）。
- 日期：Node 22 与 Node 26 的 ICU 空格不同（`PM` 前一个是窄不换行空格），统一成 en「6:30 – 8:00 PM」（细空格 + 不换行空格）、zh「18:30–20:00」。
- Vercel 预览构建：固定 Next.js 框架、Node 22、pnpm 构建脚本白名单。

用 20 条种子活动跑起来的首页
- 20 条示例活动的日期相对「今天（太平洋时间）」计算，预览永远有当周内容；主办方是虚构的，页面顶部有「示例数据」横幅。`pnpm db:seed` 可把同样 20 条写进数据库。
- 公开读模型 `PublicEvent`、缓存查询 `getUpcoming()`（`'use cache'` + `cacheTag('events')`）、`publicGoing()` 把 PRD §7 的会去规则写成纯函数（12 个用例覆盖：平台、私人场地、重复活动、骑行、去过、总开关、已取消）。
- 组件：SiteHeader + Wordmark（朱砂小印 V）、LangSwitch、CategoryChips（真按钮 + aria-pressed，状态写进 `?c=`）、GoingStrip、FeaturedRail（手机 260 px 横滑、桌面三列）、DayHeader（吸顶）、EventCard（时间列 | 1:1 封面 | 标题，点评跨两列）、CoverImage（无图或模板封面时用纯 CSS 的类别色 + 大字瓦片，不发图片请求）、GoingBadge（中文两字竖排、英文等宽大写，−3°，120 ms 盖章）、CuratorNote、DateTime、EmptyState、SiteFooter。

检查结果：`pnpm typecheck && pnpm lint && pnpm test && pnpm build` 全部通过（Vitest 45 个用例）；Playwright 16 个用例全过（手机与桌面：两种语言首页、首访跳转、无横向滚动、语言切换保留路径与筛选、类别芯片筛选、/admin 重定向，以及桌面上 magic link → 添加 passkey → 退出 → passkey 登录的完整流程，用 Chromium 虚拟认证器）；GitHub Actions CI 绿。

下一步
- 等你看预览后的设计意见，优先改设计。
- M1 第 4 周起：活动详情页、JSON-LD、hreflang、sitemap；然后月历、/going、RSS、三条 ICS。

阻塞
- G0 的真机 Face ID / Touch ID、DKIM/DMARC 需要 checklist 第 1、2、3、9、10 项。

### M1 第 3–6 周（提前完成代码部分）

做了什么
- 第 3 周的组件在 M0 末已完成；本阶段补 DayList（按天分组共用）、WeekStrip、CalendarGrid、FacetPanel、PageShell、AddToCalendarMenu、LocalTime、NoteFontLoader。
- 活动详情页 `/events/[slug]` 与 `/zh/events/[slug]`：1:1 封面加 80 px 印章、双语标题、日期（线上活动加访客本地时间与北京时间）、地点、芯片、完整点评、「去 Luma 报名」按钮、加入日历菜单（`<details>`，零 JS，zh 顺序 Apple、Outlook、Google）、封面署名、schema.org Event JSON-LD（只含事实）、hreflang 三项；未知 slug 返回 404。
- ICS（原第 6 周，提前做）：`/calendar.ics?c=…&lang=…`、`/calendar/going.ics`、`/events/[slug].ics`（zh 为 `/zh/events/[slug].ics`）。VTIMEZONE、`REFRESH-INTERVAL`/`X-PUBLISHED-TTL` PT1H、稳定 UID、SEQUENCE、公开会去加 `V→ ` 前缀、取消写 `STATUS:CANCELLED`、s-maxage 900。
- RSS `/feed.xml` 与 `/zh/feed.xml`；`sitemap.xml`（每条带 en、zh-Hans、x-default）；`robots.txt`（禁 /admin、/api，允许 *.ics）。
- `/calendar?m=YYYY-MM`：桌面月格（类别圆点，点一天跳到当天列表，周首日 en 周日、zh 周一，周标签来自 Intl），1024 px 以下只显示议程；`/going`（公开会去与「去过」档案，总开关关闭时 404）；`/archive?m=`；`/week/2026-W41`（不存在的 ISO 周 404）；`/about`。
- 类别芯片之外的 facet（活动语言、线上线下、区域、只看免费）是一个 GET 表单，禁用 JS 也能用。
- 性能（见 G1）：Latin 字体改用 next/font 的 latin 子集，只预加载首屏需要的；CJK 正文字体先找系统字体（苹方、安卓 Noto Sans CJK），`font-display: optional`；霞鹜文楷空闲时再加载；切片改 16 KB；模板封面的六个汉字改成 SVG 轮廓（不再等字体）；流式占位高于一屏，页脚不再跳动（CLS 0）。
- 去掉 date-fns 与 @date-fns/tz：Cache Components 在预渲染时拒绝无参数的 `new Date()`，而 `TZDate` 内部会调用它；改用 Intl 算时区偏移（有夏令时切换的测试）。

部署中发现并修掉的三个问题
- **ICS 时间在 Vercel 上会错 7–8 小时**：ical-generator 遇到普通 `Date` 加 TZID 时，用的是服务器本地时钟；我的 Mac 是太平洋时间所以本地看不出，CI（UTC）抓到了。改用 `TZDate` 传入时区，并让 Vitest 与 Playwright 的服务器都以 `TZ=UTC` 运行，防止再被本地时区掩盖。
- **Vercel 构建因缺 `BETTER_AUTH_SECRET` 失败**：Better Auth 在生产模式下没有密钥会直接报错。改成首次使用时才构建（请求时），构建不再需要运行时密钥；后台真正使用前仍需你设置（checklist 9）。
- **Vercel 拒收函数包**：之前为了读时区文件，把 pnpm 符号链接目录里的文件打进了函数。改为 `pnpm tz:vendor` 生成 `src/lib/vtimezones.ts`（17 个常用时区的 VTIMEZONE），运行时不读文件。

检查结果：typecheck、lint 通过；Vitest 67 个用例通过（含 ICS 经 node-ical 回读、跨 11 月夏令时切换）；Playwright 40 个通过、2 个跳过（passkey 流程需要数据库，CI 里跳过）；构建通过。

下一步
- G1 还差：中文详情页 Lighthouse 0.88（目标 0.90），以及真机订阅 ICS（需要 checklist 12、13）。
- 中文详情页的改进方向：按页面文字给标题预加载对应切片，或把 `cjk.css` 改成非阻塞加载（会让标题先显示宋体再换字）。这个取舍想先听你的意见。
- G1 通过后进 M2：safe-fetch、Luma/Partiful 适配器、`/api/ingest`。

阻塞
- checklist 12（合并进 main）与 13（真机订阅），G1 才能验完。

### M1 合并后（2026-09-28）：生产站验证与修正（#3，已合并）

用 5 个独立检查代理对生产站做了一轮验证（路由与双语、日历订阅、RSS 与 SEO、后台与隐私安全、性能与缓存），每条发现再由一个反驳代理独立复现。结果：21 条确认（无高危）、4 条被驳回、6 条仅供参考。确认的问题全部在本分支修掉：

- **多日活动丢了结束时间**（详情页与 RSS）：现在显示「Fri, Oct 2 · 9:00 AM – Sat, Oct 3 · 7:00 PM PT」「10月2日周五 9:00 – 10月3日周六 19:00 北美太平洋时间」。
- **站上没有任何订阅按钮**（PRD F05 的 M1 范围，我之前漏了）：首页和月历加「订阅这几类 / 订阅日历」菜单（跟随类别芯片），/going 加「订阅 Victor 会去」。菜单里有 Apple（webcal）、Google、Outlook 和可复制的订阅地址，zh 顺序为 Apple、Outlook、Google；附刷新时间说明。
- **页头「订阅」链到还没做的 /subscribe（404）**：先去掉，M3 做 newsletter 时加回。
- **打开别人分享的 /zh 链接会把语言锁成中文一年**：现在只有语言切换会写 cookie（经 `/_locale`，带防开放重定向）；**繁体中文优先、英文兜底的浏览器**以前留在英文，现在按「首选语言 zh* → /zh」。
- **预渲染页面上的语言切换链接指向对方首页**：现在服务器端就指向同一页。
- **404**：`/api`、`/.env`、`/fr` 这类路径以前会渲染英文首页（200），现在一律 404；没有匹配路由的地址显示服务器渲染的双语 404（`app/global-not-found.tsx`，需要 Next 的实验开关 `experimental.globalNotFound`）。
- **月历与归档的 canonical 指向当月**：`?m=` 现在写进 canonical 和 hreflang。
- **分享卡片信息太少**：每页都有 og:title、og:description、og:url、og:site_name、og:locale 和 Twitter 卡；首页标题带站名；已取消活动的标题前加「[已取消] / [Cancelled]」。OG 图随 M2 的封面管线来。
- **ICS 细节**：DTSTAMP 改为 UTC（带 Z），文件以 CRLF 结尾（RFC 5545）。
- **骑行活动的起点被公开**（指南「骑行团骑和起点永不发布」）：读模型出口统一去掉骑行活动的场地、地址、街区，只留城市；页面、ICS、JSON-LD、加日历链接都生效。
- **sitemap 漏了 /archive**：已加。
- **安全响应头**：全站加 `X-Content-Type-Options: nosniff`、`Referrer-Policy`、`X-Frame-Options: DENY` 与 `frame-ancestors 'none'`、`Permissions-Policy`。
- **缺失的字体切片 404 也被缓存一年**：一年 immutable 头只给 8 位十六进制哈希命名的 woff2。
- **伪造的后台会话 cookie 会进错误页**：现在按未登录处理，跳回登录页。
- **字标链接的无障碍名称与可见文字不一致**：去掉多余的 aria-label。
- 生产检查代理在仓库里留下了一个下载的 HTML 文件（`cm.html`），已删除。

没有修、只记录的
- **路由内的 404**（未知活动 slug、不存在的 ISO 周）状态码是 404 且带 noindex，但 HTML 是空壳，本地化的「页面不存在」由客户端补渲染。这是 Next 16.3 Cache Components 对 `notFound()` 的现行行为；我试过不依赖语言的 not-found 组件，结果一样。关掉 JS 的访客在这些地址看到空白页。
- **首页 JS 157 KB（gzip）**，高于 PRD 与指南的 120 KB。其中 React 与 Next 运行时两块就约 117 KB，按指南「估算后校准」的精神记为新预算（见文档冲突 13）。
- **实验室 LCP**：生产站中位数 2.4–2.7 s，略高于 2.5 s；PRD 的目标是真实用户 p75，性能分都在 0.96 以上。

检查结果：typecheck、lint 通过；Vitest 79 个用例通过；Playwright 64 个通过、2 个跳过（passkey 需要数据库，已在本地数据库上单独跑通）；构建通过。

在 PR #3 的预览上复查（6 个复查代理 + 反驳代理）：21 条都确认修好，回归检查全部通过；另外抓到 3 个问题，也已在本分支修掉：
- **新的开放重定向（安全）**：语言切换 `/_locale` 只检查了原始 `to` 参数，`/.//evil.com` 这类带 `.` 路径段的地址规范化后变成 `//evil.com`，会跳到站外。现在校验规范化之后的路径，并在 proxy 里再确认一次目标仍是本站。
- **/calendar 与 /week 缺描述**：加了 description 与 og:description。
- **手机上「加入日历」菜单超出屏幕右边**（M1 就有的问题）：手机上改为在按钮下方整行展开，平板以上仍是下拉。

运维备注：复查时多个代理同时高频请求预览，触发了 Vercel 的安全验证页（403 challenge，约 10 分钟后自动解除）。这是平台对短时间大量无头浏览器请求的防护，不是站点问题；日历 App 的正常抓取频率不会触发。

### M2 第 7–8 周（2026-09-30，提前完成）：ingest 管线

做了什么
- **安全抓取 `src/lib/ingest/safe-fetch.ts`**（唯一允许出网的抓取器，lint 禁止 ingest、covers、inbox 目录直接用 fetch 或 undici）：只接受 https 和默认端口，URL 里不能带账号密码；每个主机名都解析 A 与 AAAA，用 ipaddr.js 只放行公网单播地址（挡住回环、RFC1918、169.254 元数据、fc00::/7、多播、IPv4 映射、NAT64、6to4）；socket 只连已检查过的地址（自定义 lookup，防 DNS 重绑定）；重定向手动跟随最多 3 跳，每跳重新校验；10 秒超时，HTML 4 MB、图片 15 MB 上限；Chrome UA。
- **链接归一化 `normalize.ts`**：去 utm 等追踪参数，lu.ma 改 luma.com，Luma、Partiful、Meetup 的查询串整个去掉（顺带去掉 Luma 的邀请令牌 `tk`，不会出现在公开的 source_url 里）；提取平台 id（Luma slug 与 `evt-`、Partiful、Eventbrite、Meetup）。
- **适配器 `adapters/`**：Luma 先读 `__NEXT_DATA__`（原始 `cover_url`、IANA 时区、主办方、地址可见性、票务），再用 JSON-LD 兜底，绝不取 og:image；Partiful 的时区取 `__NEXT_DATA__`（JSON-LD 只有 UTC），封面取 imgix 海报改成 1600²；Eventbrite、Meetup 和其他网站走通用 JSON-LD（Eventbrite 解开 `/_next/image` 包装），没有 JSON-LD 时用 og 标签。私人场地按指南规则判定。
- **AI 补全 `extract.ts`**：AI SDK 7 的 `Output.object` 经 AI Gateway 调 `anthropic/claude-haiku-4.5`。页面上读到的事实永远优先，模型只写摘要、翻译标题和点评、选类别，页面缺的事实才由模型补；模型补的字段记进 `auto_fields`（后台显示 AI 标记）。没有 Gateway 或调用失败时退回「只用事实」的草稿，不会丢链接。
- **`POST /api/ingest`**：session cookie 或 `Bearer vp_…` 令牌；每令牌每小时 60 次；返回 201 / 202（读不了的页面存最小草稿，`needs_manual`）/ 401 / 403（缺 scope）/ 409（重复，按 URL、Luma 别名、短链、`evt-` id 都能认出）/ 429。publish 模式先过发布校验（名字、时间、类别、点评），缺项就存草稿并在 `not_published` 里说明；通过时同步建模板封面再发布，并 `revalidateTag('events', { expire: 0 })`。`mode=candidate` 暂回 400，随第 11 周收件箱实现。
- **`GET /api/index`**：只接受带 candidates 或 ingest scope 的令牌，列出已发布活动的外部 id，给 weekly-events skill 去重。
- **令牌**：`vp_` + 32 字节随机数，只存 SHA-256；记录 last_used；可吊销。后台 Settings 做好前用 `pnpm api-token create "<名字>" ingest[,publish]` 创建（明文只显示一次）、`pnpm api-token list`、`pnpm api-token revoke <id>`。
- fixture：仓库是公开的，所以 `fixtures/` 里是保留真实页面结构、但名字、id、文案都换成虚构内容的精简版。

检查结果：typecheck、lint 通过；Vitest 178 个用例通过（新增：SSRF 49 个、适配器 25 个、AI 补全 7 个、ingest 流程 10 个、接口 7 个）；构建通过。另外在真实网络上验证：`lu.ma/g42o84ln` 跳转到 luma.com 并正确读出时间、时区、场地、主办方、封面（封面图 336 KB 能下载）；解析到 `::1` 的域名被挡；本地开发服务器上 `/api/ingest` 实测 201（约 0.5–1.8 秒，未开 AI）、409、202、401 都符合契约，测试数据已清理。

审查后的修正（Codex 审查 #6：FIX_REQUIRED / MEDIUM，两条都核实属实）
- **链接里的敏感信息会被存下并公开**：带账号密码的链接（`https://user:pass@…`）以前会在抓取失败后作为最小草稿原样存进 `source_url`；带 `token`、`invite_code`、`sig` 这类参数的通用链接也会原样保存，之后出现在活动页、RSS、ICS 和 `/api/index`。现在带账号密码的链接直接返回 400、什么都不存；token、密钥、签名、会话、邀请码、邮箱这类参数在保存和抓取前一律去掉；Eventbrite 链接的查询串整个去掉；从页面读到的主办方链接也经过同样的清洗。另外修了一个相关的边角：重定向目标解析失败时不再报 500，而是沿用原链接。
- **去重查询没有索引**：`events.source_url` 和 `event_sources.url` 加了索引（迁移 `drizzle/0002_ingest_dedupe_indexes.sql`），活动多了以后每次录入不再全表扫描。
- 新增测试 8 个（凭据链接被拒且不入库、敏感参数被去掉、主办方链接清洗、两个索引存在）。

下一步
- 第 9 周：封面链 1–3 步（官方封面经 safe-fetch 下载 → sharp 处理 → Blob；主办方组合图；排版模板）、`after()` 里替换官方封面、OG 图、上传与粘贴 URL。
- 第 10 周：后台 PWA（Add、Drafts、Live、编辑器、Settings 令牌与总开关）和两个 iOS 快捷指令。

阻塞
- 生产上用 `/api/ingest` 需要 Vercel 上有数据库和密钥（checklist 2、9）；封面存储需要 Blob（checklist 2）；AI 补全需要 Gateway 绑定支付（checklist 8），没绑之前按「只用事实」工作。

### M2 第 9 周（2026-09-30，提前完成）：封面管线

做了什么
- **封面链 `src/lib/covers/chain.ts`**：ingest 返回后在 `after()` 里跑，依次尝试：① 官方封面（经 safe-fetch 下载）→ ② 主办方组合图（最多 3 个头像叠在类别色模板上）→ ③ 排版模板（不会失败）。自动运行只会替换模板封面，不会覆盖你手动选的封面；换封面时删掉旧的 Blob 文件和旧行。`cover_policy = template` 和 Settings 里的「官方封面全换模板」开关都生效。已发布的活动换完封面后 `revalidateTag('events', { expire: 0 })`。
- **图片处理 `process.ts`**（sharp 0.35.5）：嗅探格式、拒绝 SVG 和短边小于 200 px 的图、动图只取首帧、按 EXIF 纠正方向并去掉元数据；宽高比 0.8–1.25 居中裁成方形，横幅和竖图铺在主色底上（标 `letterboxed`）；输出 1600²、800²、400² 三种 WebP，外加主色和约 25 字节的 thumbhash。
- **存储 `blob.ts`**：写入 Vercel Blob，路径带内容哈希加随机后缀，缓存一年。**没有 `BLOB_READ_WRITE_TOKEN` 时第 1、2 步直接跳过，活动停在模板封面**（生产站现在就是这样，等 checklist 2）。
- **模板图与分享卡片**（next/og）：`/og/template/[类别]?h=主办方&s=尺寸` 按需渲染模板封面（和站内 CSS 瓦片同一版式，缓存一年）；`/og/[en|zh]/[slug]` 按需渲染 1200×630 分享卡片（左边方形封面，右边类别、标题最多 3 行、日期、字标与小印），活动页的 og:image 与 Twitter 卡都指向它，URL 带内容指纹，改了标题、时间或封面就换新地址。字体按文字取 Google Fonts 子集（Fraunces、Noto Serif SC、Geist Mono）。
- **手动选封面**（后台编辑器第 10 周接上）：`coverFromUrl`（粘贴图片链接，经 safe-fetch）、`coverFromUpload`（手机相册直传 Blob 后处理，再删掉原图）、`coverToTemplate`（换回模板）；`POST /api/covers/upload` 只给已登录的你签发上传令牌，限 image/*、15 MB、10 分钟有效。
- **站内显示**：next/image 只允许 Blob 主机的 `/covers/**`，质量固定 75；封面加载前用 thumbhash 模糊占位。

检查结果：typecheck、lint 通过；Vitest 189 个通过（新增封面处理与封面链 11 个）；构建通过；Playwright 按 CI 方式（不带本地数据库）69 个通过、3 个跳过。另外实测：真实 Luma 官方封面（1920² PNG）处理成三种尺寸正常；用真实 Luma 头像渲染的组合图、四种模板图和中英文分享卡片都看过效果；未知 slug 与语言返回 404。

下一步
- 第 10 周：后台 PWA（Add、Drafts、Live、编辑器含封面选择器、Settings 令牌与总开关）和两个 iOS 快捷指令。

阻塞
- 官方封面和组合图要存进 Blob，需要 checklist 2（在 Vercel Storage 页创建 Blob store 并连到项目）。在那之前所有活动都用模板封面，分享卡片照常生成。

## 门槛

| 门槛 | 条目 | 结果 |
|---|---|---|
| G0 | iPhone Face ID 与 Mac Touch ID 登录 /admin | ⏳ 代码路径已验证：本地用 Chromium 虚拟认证器跑通 magic link → 注册 passkey → 退出 → passkey 登录。真机需要 Vercel 上有数据库和 env（checklist 2、9），然后你在两台设备上各做一次（checklist 10） |
| G0 | DMARC、DKIM 验证通过 | ⏸ 推迟：域名暂不买（checklist 1、3），改为 M3 newsletter 首发前必须补齐 |
| G0 | pnpm test 与 Playwright 冒烟在预览分支通过 | ✅ `m0-foundations` 的 GitHub Actions：typecheck、lint、Vitest、build、Playwright 全绿；该分支的 Vercel 预览构建 READY |

G0 结论：本地能验证的全部通过，剩下两条只差外部步骤。M1 的工作不碰鉴权和发信，所以我在等外部步骤的同时继续 M1，G0 这两条补验后再记结果。

| G1 | Lighthouse 性能 ≥ 90（移动端，3 次取中位数） | ✅ 生产站真实网络（2026-09-28）：`/` 0.98、`/zh` 0.97、`/zh/events/chinese-founders-mixer` 0.97、`/calendar` 0.96。之前本地的 0.88 是 localhost 模拟的假象 |
| G1 | Lighthouse 无障碍 ≥ 95 | ✅ 四个页面都是 100；CLS 约 0 |
| G1 | ICS 在 Apple Calendar 与 Google 导入正确 | ✅ 2026-09-30 你在 iPhone 与 Google Calendar 真机订阅，没有问题。此前生产站自动检查也全部通过：46 个文件（6 条订阅 + 40 个单场）CRLF、75 字节折行、VTIMEZONE、每场 DTSTART 与页面时间一致、node-ical 回读一致；用 iOS、macOS、Google、Outlook 的 User-Agent 匿名抓取都是 200 |

G1 结论：2026-09-30 全部通过，进入 M2。

Lighthouse 说明：本机测量时 Chrome 找得到苹方，所以中文正文不下载切片；在没有苹方的 Linux CI 上分数会更低，因此 `pnpm lhci` 目前只在本地跑，没有放进 GitHub Actions。

## 待确认（我先按最简单、可逆的方案做了）

- **没有数据库时用种子数据渲染公开站。** 这样在你装 Neon 之前预览链接也能看；装好后自动切到数据库。
- **生产用 neon-http 驱动。** 它不支持交互式事务，所以 digest 的 claim 行会写成单条 `INSERT … SELECT … RETURNING`。若 Better Auth 需要事务，第 2 周改用 Neon 的 WebSocket Pool。
- **Vercel 项目名 `victor-picks`**，预览域名随之而定。
- **React 保持 19.2.8**（create-next-app 为 Next 16.3.6 固定的版本；npm 上已有 19.3.0，但指南写的是 React 19.2）。**TypeScript 保持 5.x**（npm 最新 7.0.2，未确认 Next 16.3 的 typegen 支持）。**ESLint 保持 9**（create-next-app 的选择）。
- **本地 Node 26，CI 与 Vercel 用 Node 22**（指南要求 Node 22；`engines: 22.x`）。
- **`main` 分支只推了文档那一个 commit**，作为 PR 的基准；代码都在 feature 分支上。Vercel 对 `main` 的生产部署会因为没有代码而失败，合并 M0 后自然恢复。
- **预览部署保持 Vercel Authentication 保护**（没有改项目安全设置）。要让不登录 Vercel 的人也能看，需要你在项目 Settings → Deployment Protection 关掉，或等域名绑定后看生产站。
- **首页「本周」= 今天起 7 天（太平洋时间）**，而不是 ISO 周一到周日；周五打开也能看到下周初的活动。`/week/[yyyy-Www]` 仍按 ISO 周。
- **模板封面在站内不发图片请求**：`cover.kind = template` 直接渲染 CSS 瓦片（同一套类别色 + 大字），next/og 生成的模板图只用于 OG 和邮件。
- **「Victor 会去」条不跟随类别筛选**，精选卡和日列表跟随。
- **手机卡片的点评跨封面和标题两列**：PRD 估算的手机标题列 246 px 按公式算其实只有 174 px（见文档冲突 9），点评放在标题列里太窄。
- **手机时间列 56 px、字号 1.125rem**：PRD 的 48 px 放不下 1.25rem 等宽的「18:30」（约 60 px）。桌面仍是 1.25rem。
- **中文字体只覆盖 GB 2312**（6,763 个常用汉字加标点），更少见的字回退到系统的苹方或微软雅黑，这样 @font-face CSS 从 180 KB 降到 40 KB（gzip）。
- **语言切换是整页跳转**（普通链接），因为换 `[locale]` 根参数时软导航没有更新正文；换语言是低频操作。
- **CJK 正文字体「系统优先」**：Noto Sans SC 的 @font-face 先写 `local(PingFang SC Regular)`、`local(Noto Sans CJK SC Regular)`，苹果和安卓设备直接用系统字体，不下载切片；Windows、Linux 才下载 Noto。并且用 `font-display: optional`：切片 100 毫秒内没到就整页保持系统字体。结果是苹果设备上的正文是苹方而不是 Noto Sans SC。标题（Noto Serif SC 600）照旧用网络字体。要改回全平台统一 Noto，只需删掉 `scripts/fonts-cjk.ts` 里的 local 列表并重跑 `pnpm fonts:cjk`。
- **霞鹜文楷在页面空闲后才加载**（`NoteFontLoader`），首屏点评先用衬线回退字体显示。
- **Geist 与 Geist Mono 改用 next/font 的 latin 子集**，不再用 geist 包的全字形文件（每个 70 KB）。**Fraunces 斜体去掉 opsz 轴**（点评是小字，静态字重即可，文件小很多），并预加载，因为列表页的最大文本经常是英文点评。
- **模板封面的六个汉字（黑投校会骑聚）是 SVG 轮廓**，由 `scripts/glyph-paths.py` 从 Noto Serif SC 生成；`AI` 仍用 Fraunces 文本。以后 next/og 的模板图可以复用同一份轮廓。
- **流式内容的占位高度是 150vh**，页脚留在静态外壳里（保留 contentinfo 地标），位移发生在屏幕外，不计入 CLS。
- **/privacy 的页脚链接先去掉**，M3 写隐私页时加回，避免链到 404。
- **语言选择的规则**：只有语言切换（`/_locale`）写一年的 NEXT_LOCALE cookie；没有 cookie 时看浏览器首选语言，zh 开头（含繁体）进 /zh，其余英文。打开任何 /zh 或英文链接都不会改你存下的选择。
- **没有匹配路由的地址用双语 404**（`app/global-not-found.tsx`），依赖 Next 的实验开关 `experimental.globalNotFound`；以后开关转正或行为变了要回来看。
- **Outlook 的订阅深链接** `outlook.live.com/calendar/0/addfromweb?url=…` 没有官方文档，已用快照测试锁住格式。
- **页头「订阅」按钮在 M3 前隐藏**；日历订阅入口放在首页、月历和 /going 的「订阅」菜单里。
- **骑行活动在所有公开出口只显示城市**，不显示场地名或起点，包括已报名的正式骑行（gran fondo）。
- **VTIMEZONE 只内置 17 个时区**（太平洋、山地、中部、东部、夏威夷、阿拉斯加、伦敦、巴黎、柏林、上海、香港、台北、东京、新加坡、加尔各答、UTC）。其他时区的活动仍写 TZID，但不附 VTIMEZONE 块，主流日历 App 认识 IANA 名称。
- **ICS 与 RSS 从第 6 周提前到第 4 周**，因为详情页的「加入日历」要用。
- **域名暂不买（2026-09-30 你的决定）**：继续用 `victor-picks.vercel.app`。大陆访问不了（`*.vercel.app` 被干扰），但你确认这不需要考虑：活动都在湾区，国内读者看得到也去不了。所以域名只剩一个用途：发信。影响：① Resend 只能用 `onboarding@resend.dev` 发信，且只能发给 Resend 账号本人的邮箱，所以后台 magic link 能用（`ADMIN_EMAIL` 设成注册 Resend 的邮箱），但 M3 的 newsletter 发不出去；② G0 的 DKIM/DMARC 推迟到 M3 首发前验证。M2（抓取、后台录入、AI 草稿、封面）不依赖域名。买域名后要改的只有 `PUBLIC_HOST`、Vercel 域名绑定、ICS 的 UID 主机名（UID 变会让已订阅的日历重复一次，越早换越好）。
- **ingest 的 AI 输出长度与范围事后裁剪**：指南的 schema 写了 `summary_en ≤ 240`、`summary_zh ≤ 120`、置信度 0–1；我把限制写进字段说明，调用后再截断和钳制，而不是交给 schema 校验，免得模型多写几个字就让整次录入失败。
- **页面事实优先于模型**：时间、时区、场地、城市、价格、报名方式只要页面上有，就不用模型的值；模型可以把活动标成私人场地，但不能取消私人场地标记。
- **标题去掉装饰性 emoji**（「⚕️ HealthTech Pitch⚕️」→「HealthTech Pitch」），卡片有自己的视觉语言。
- **私人场地的场地名和街区不写进数据库的公开列**：PRD 只说私人场地影响「会去」印章，但判定为私人场地的情况里场地名常常就是街道地址，所以更保守地留空；完整地址仍存在不公开的 `address` 列。
- **需要 token 才能打开的私密链接不会被抓取**：敏感参数在抓取前就去掉了，这类页面会作为最小草稿（202）保存，由你手动补信息；这是为了保证 token 永远不进数据库。
- **读不了的链接也建草稿（202）**，包括被 SSRF 规则挡下的地址；这种草稿从不再次抓取，只保存链接和点评。
- **publish 模式的模板封面暂用种子数据的约定 `template:<类别>`**（公开站本来就用 CSS 瓦片渲染模板封面，不发图片请求）；第 9 周的封面管线接上 next/og 后生成真正的模板图与 OG 图。
- **没有 AI 时的类别**：Luma 自带类别 `ai` 时先填 `ai`，置信度 0.5；其他情况留空，发布校验会要求补上。
- **模板图和分享卡片按需渲染、边缘缓存，不存进 Blob**：指南写的是生成后 `put` 到 Blob（`url_og_en`、`url_og_zh`）。改成 `/og/...` 路由按需渲染有三个好处：还没装 Blob 也能用；改了标题或时间自动更新（URL 带指纹）；省 Blob 的写操作额度。`covers.url_og_*` 暂时留空。
- **组合图版式**：有主办方头像时类别字缩到约 26% 并上移，头像放大到 26% 放在下方；没有头像时和站内模板一致。
- **分享卡片的字体在运行时从 Google Fonts 取子集**：指南只对中文字形这样写，我把 Fraunces 和 Geist Mono 也一起这样取，避免把字体文件打进函数包（之前打包 node_modules 里的文件被 Vercel 拒过）。取不到时 Satori 用内置字体兜底，不会失败。
- **上传路由只签发令牌，不用 `onUploadCompleted` 回调**：回调需要公网可达的地址，本地开发收不到；编辑器拿到上传后的 URL 直接调 `coverFromUpload` 处理。
- **本地 API 令牌脚本叫 `pnpm api-token`**（pnpm 保留了 `token` 这个命令名）。
- **`victorchun-site` 升级到 16.3.7 暂缓**：npm 上 next 最新仍是 16.3.6（今天 9/28，指南说 9/30 之后发布）。它在另一个仓库，发布后单独处理。

## 文档冲突记录（按实现指南执行）

1. **代码仓库**：指南写独立仓库 `victory-c/victor-picks`；你已决定放在本仓库 `victory-c/victory-calendar`。按你的决定。
2. **表数量**：指南写「十四张业务表」，但 SQL 实际列出 13 张。按 SQL 建 13 张。
3. **「想去」的显示**：指南「Going 状态安全规则」写「公开只显示描边印章」，指南组件表与 PRD §7、§9b 都写「不盖印章，只显示灰字」。按组件表与 PRD：只显示灰字。
4. **周报发送门槛**：PRD §8 写三个条件（含「PT 是周日」）；指南只判断 `status = 'scheduled' and send_after <= now()`。按指南。
5. **zh 日期格式**：指南代码片段用 `month: 'numeric'`，当前 ICU 输出是「10/7周三」，与指南和 PRD 写的「10月7日周三」不符。改用 `month: 'short'`，输出与 PRD F08 验收串一致。
6. **en 时间区间的空格**：ICU 在 en dash 两侧放的是细空格（U+2009），不是普通空格。按指南「统一用 Intl 的实际输出」保留。
7. **hreflang**：next-intl 默认在响应头里写 `hreflang="zh"`，PRD 要求 `zh-Hans`。关掉 next-intl 的 alternateLinks，由页面 metadata 输出 en、zh-Hans、x-default。
8. **Better Auth CLI**：指南写 `pnpm dlx @better-auth/cli generate`，该包已在 npm 上标记弃用、停在 1.4.21；与 better-auth 1.7.6 配套的 CLI 现在叫 `auth`（`pnpm dlx auth@1.7.6 generate`）。用后者。
9. **手机标题列宽**：PRD §9b 与指南都写「390 − 32 − 48 − 112 − 24 ≈ 246 px」，实际算出来是 174 px。按实际宽度设计（见待确认）。
10. **印章以外的朱砂**：PRD 规定朱砂只属于 going 系统，但同一份文档也写了焦点环、点评左线和字标小印用朱砂。三处都照文档保留，别处（例如「今天」标签）不用。
11. **字体预算**：PRD 与指南写 en 首屏字体 ≤ 120 KB，但指定的四个字体（Geist、Geist Mono、Fraunces 正体带 opsz、Fraunces 斜体）子集化后实测仍是 140 KB。两份文档都写了这个数字是估算、要用 Lighthouse CI 校准，所以按实测 140 KB 记为新预算；zh 首屏在苹果设备上实测为 Latin 140 KB + 标题切片约 80–370 KB（视页面文字而定）。
12. **date-fns**：指南选了 date-fns 4.4 + @date-fns/tz，但 Next 16.3 的 Cache Components 在预渲染时拒绝 `TZDate` 内部的无参数 `new Date()`。改用 Intl 计算偏移，去掉这两个依赖。
13. **首页 JS 预算**：PRD 与指南写首页 JS ≤ 120 KB（gzip），生产实测 157 KB，其中 React 与 Next 运行时约 117 KB，砍业务代码也到不了 120 KB。按实测记为新预算。
14. **大陆可达性**：PRD 风险表与指南把「大陆可达」列为买域名的理由之一；你在 2026-09-30 决定不考虑大陆读者（活动都在湾区）。域名只作为 M3 发信的前置。zh 界面仍保留 Apple、Outlook 优先的日历按钮顺序，不改代码。
