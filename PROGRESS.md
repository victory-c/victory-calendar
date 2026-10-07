# PROGRESS · Victor's Picks · Victor 精选

Cross-session state. Read at session start, update before ending. Sources of truth: `PRD.md` and `IMPLEMENTATION_GUIDE.md`; on conflict the guide wins and the conflict is logged below.

## 你需要亲手做的外部步骤（checklist）

Secrets, tokens and private iCal URLs go only into `.env.local` or Vercel env. Never paste them into chat, code or docs.

| # | 步骤 | 何时需要 | 状态 |
|---|---|---|---|
| 1 | 买域名，决定 `picks.<domain>`（站点）和 `mail.<domain>`（Resend 发信）。买好后告诉我域名，我改 `PUBLIC_HOST` 并在 Vercel 绑定 | M3 newsletter 首发前（Resend 发信的前置） | ⏸ 2026-09-30 决定暂不买，继续用 `victor-picks.vercel.app` |
| 2 | Vercel 集成：**Neon**（免费，iad1）、**Upstash Redis**（免费，iad1）、**Blob**（公开，iad1）已于 2026-09-30 装好并连到生产与预览环境，Neon 已建表。**Resend 暂不装**：通过 Vercel 安装必须填自有发信域名，随域名推迟到 M3 前 | M0 第 2 周 | ✅（Resend ⏸） |
| 3 | Resend：添加 `mail.<domain>`，把它生成的 DKIM、SPF 记录加到 DNS，再加 DMARC `v=DMARC1; p=none; rua=mailto:<你的别名>` | 域名买好后（M3 前） | ⏸ 随第 1 项推迟 |
| 4 | Google Calendar（**berkeley.edu 账号**）：设置 → 选日历 → Integrate calendar → 看有没有「Secret address in iCal format」。Workspace 管理员可能隐藏了它：**没有就改用个人 Gmail 日历**并告诉我。有的话复制到 Vercel env `GCAL_SECRET_ICS_URL` | M2 第 11 周 | ⬜ |
| 5 | Google Calendar：Settings → Event settings → 「Add invitations to my calendar」设为 **From everyone**，否则 Luma 邀请不会进日历 | 同上 | ⬜ |
| 6 | Luma：Settings → Calendar Syncing → Add iCal Subscription，复制 URL 到 Vercel env `LUMA_PERSONAL_ICS_URL` | M2 第 11 周 | ⬜ |
| 7 | Partiful：桌面版 Calendar sync → Copy Link，存到 Vercel env `PARTIFUL_ICS_URL` | M2 第 11 周 | ⬜ |
| 8 | Vercel AI Gateway：团队设置里绑定支付方式（约 $0.5–2/月）。M4 起封面选择器的「AI 抽象封面」也靠它（Recraft 每张 $0.007，FLUX 每张 $0.04，每天最多 20 次）；建议在 AI Gateway → Budgets 设一个月预算（例如 $2）并关掉自动充值 | M2 第 7 周 | ⬜ |
| 9 | Vercel env：`ADMIN_EMAIL`（你的 berkeley.edu 地址）已设；`BETTER_AUTH_SECRET`、`CRON_SECRET`、`SUBSCRIBER_LINK_SECRET` 由你运行命令随机生成并直接写入生产环境（值不经过对话）。预览环境还没加，只影响分支预览站的后台 | M0 第 2 周 | ✅ 生产 · ⏳ 预览 |
| 10 | 首次登录 /admin/sign-in：还没有 Resend，登录链接写在 Vercel Logs 里（搜 `email:dev`），5 分钟内打开；然后在 iPhone（Face ID）和 Mac（Touch ID）各注册一个 passkey（G0 门槛） | M0 第 2 周部署后 | ✅ 2026-09-30 生产登录成功 · passkey 两台设备待确认 |
| 11 | 安装两个 iOS 快捷指令（Add to Picks、Add & Publish）。iCloud 链接我生成不了，步骤写在后台「设置」页底部；令牌也在设置页生成（只显示一次） | M2 第 10 周；生产上要先完成第 2、9 项 | ⬜ |
| 12 | 批准把 `m0-foundations` 和 `m1-public-site` 合并进 `main` | G1 验证前 | ✅ 2026-09-28 已合并（#1、#2，以及修正 #3），生产站 `https://victor-picks.vercel.app` 公开可访问 |
| 13 | G1 实测：iPhone「设置 → 日历 → 账户 → 添加已订阅的日历」填 `webcal://victor-picks.vercel.app/calendar.ics?lang=zh`，Google Calendar 用「通过网址添加」填同一地址的 https 版；看活动时间是否是本地时间、改期后是否更新 | 第 12 项之后 | ✅ 2026-09-30 你已订阅，没有问题 |
| 14 | 给我 20 场你真的想推荐的活动（链接 + 一句点评即可），替换示例数据。M2 的后台做好后也可以自己录 | M1 第 6 周 | ⬜ |
| 15 | weekly-events skill 推送到收件箱：后台「设置」生成令牌，名字写 `weekly-events-skill`、只勾 candidates；把令牌存进本机文件 `~/.config/victor-picks/skill-token`（`chmod 600`）。没有这个文件时 skill 的第 5 步自动跳过 | M2 第 11 周 | ⬜ |
| 16 | 订阅表单开放前（域名和 Resend 就绪后）：① Vercel env 设 `RESEND_API_KEY`、`RESEND_FROM`（必须是自有域名地址，例如 `Victor's Picks <picks@mail.<domain>>`）、`RESEND_WEBHOOK_SECRET`；② Resend 控制台建 webhook 指向 `/api/webhooks/resend`，勾 email.bounced、email.complained、email.suppressed、email.failed；③ Resend 关闭打开与点击追踪；④ Vercel Firewall 加一条规则：POST `/subscribe` 与 `/zh/subscribe` 限速；⑤ 确认项目 Settings → Security 里 OIDC Federation 是开启的（BotID 需要）；⑥ Vercel env 设 `PRIVACY_CONTACT_EMAIL`：`/privacy` 上公开的联系邮箱（数据请求、下架），**不要用登录后台的 `ADMIN_EMAIL`**，可以是一个别名；没设时 Vercel 上表单保持关闭。都齐了之后重新部署，表单自动打开（`NEWSLETTER_OPEN=0` 可随时关） | M3 首发前 | ⬜ |
| 17 | G3 前的种子邮箱：准备 gmail.com、icloud.com、outlook.com、qq.com、163.com 各一个你能登录的邮箱，逗号分隔写进 Vercel env `DIGEST_SEED_EMAILS`（标成 Sensitive）。每期排期后在 `/admin/digest` 点「发种子邮件」，中文、英文各一次，挨个看是否进了收件箱而不是垃圾箱。另外：把 gmail 那个用正式表单订阅，等周报到了点 Gmail 自带的「退订」，再到 `/admin/subscribers` 搜一下确认变成已退订；把微信文字粘到「文件传输助手」点一下链接，看 `*.vercel.app` 会不会被拦 | M3 首发前（需要第 16 项） | ⬜ |
| 18 | （可选）Brave 图片搜索：在 Brave Search API 注册并绑卡（每月 $5 免费额度，超出按 $5/千次扣费；代码限制每天最多 30 次），把密钥写进 Vercel env `BRAVE_SEARCH_API_KEY`（标成 Sensitive）后重新部署。没有它，封面选择器里只是不显示这一项；设了之后「关于」页会自动加一行 Brave 署名 | M4 起，随时 | ⬜ |
| 19 | 真机试一次长图：在 `/admin/digest` 生成微信长图，用「原图」发到文件传输助手，看清不清楚；再保存一组小红书图片，看顺序和裁切 | 第一次用之前 | ⬜ |

## 当前状态

- 分支：M0（#1）、M1（#2）和生产验证后的修正（#3）都已于 2026-09-28 合并进 `main`，生产站已部署并抽查通过
- 生产站：`https://victor-picks.vercel.app`，2026-09-30 起接真实数据库（Neon），示例数据横幅已去掉；后台登录已验证。首页在录入活动前显示「精选正在路上」
- 里程碑：M0 代码完成，G0 差 passkey 真机登录（checklist 2、9、10）和 DKIM/DMARC（随域名推迟到 M3 前）；**M1 完成，G1 于 2026-09-30 全部通过**，可以进 M2
- M2：第 7–8 周（ingest，#6）、审查修正（#8）、第 9 周（封面，#7）都已合并；第 10 周后台 PWA（#9）、第 11 周候选收件箱（#13）已合并；收件箱要真正有内容还差 checklist 4–7 和 15。G2 门槛（手机实测）还没做，等你有空
- M3：第 13 周订阅流程（#14）、第 14 周周报（#15）已合并；2026-10-05 已在生产库跑过迁移 `0003_digest_send` 并抽查。第 15 周（隐私页、`/weekly` 存档、订阅者后台、微信文字、种子邮件，#16）2026-10-05 已合并，没有新迁移。**M3 的代码部分已经完成**，第 16 周（软发布与 G3 门槛）要等域名和 Resend。M4 第一轮（微信长图与小红书导出、封面的三个新来源、活动语言与线上偏好，#18）2026-10-06 已合并，没有新迁移；第二轮「会去」即时提醒（#19）2026-10-06 已合并，同一天在生产库跑过迁移 `0004_going_alerts` 并抽查（`/api/cron/alerts` 无密钥 401、`/unsubscribe?list=going` 正常）。**M4 里不依赖域名的部分都做完了**；剩下的 Gmail 转发（F18）要域名和 Resend Pro，发布帖等软发布前写。生产上订阅表单和周报发送都保持关闭，等域名和 Resend 发信域名（checklist 1、3、16、17）
- 另一个分支 `claude/fervent-hawking-99mi50`（把所有显示的时间统一成太平洋时间）合并 #16 后只有 `src/emails/digest.tsx` 一处冲突：保留 main 的版本即可（`dayLabel`、`when` 已挪到 `src/lib/digest/fields.ts`，并且已经不再传时区参数）。我在临时工作区试合并过：类型检查通过，相关测试 190 个通过（含它新增的 `public-times` 测试）
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

### M2 第 10 周（2026-09-30，提前完成）：后台 PWA

做了什么
- **外壳**：`/admin` 是可安装的 PWA（manifest 只在后台布局里链接，公开站不会提示安装），start_url 为 `/admin/add`，图标是字标的朱砂 V 印（`scripts/admin-icons.ts` 生成）。底部 tab：收件箱、添加、草稿、已发布、更多；添加页和编辑器隐藏 tab，改用粘底操作栏，适配刘海屏安全区。安卓 PWA 的 `share_target` 直接打开添加页并带上分享的链接。
- **添加 `/admin/add`**：链接框（「粘贴」按钮读剪贴板）、点评（可用键盘听写）、可选的名字；「存草稿」或「直接发布」，走和快捷指令同一条 ingest，完成后直接跳到编辑器（重复链接跳到已有活动并提示）。
- **草稿 `/admin/drafts`**：每条显示 AI 标记数量和缺什么（时间、类别、点评），可以一键确认全部 AI 字段。
- **已发布 `/admin/live`**：本周、即将、过去 60 天；每行可以切换「会去」（同样经过安全规则）和下架。
- **编辑器 `/admin/e/[id]`**：手机上是 EN、中文、详情、封面四个 tab，桌面上中英文并排。模型填的字段旁边有 AI 标记，改过就算确认。每个字段都能从另一种语言重译（anthropic/claude-sonnet-4.6）。详情里有时间（按活动时区输入，跨夏令时正确）、时区、形式、场地、城市、区域、价格、报名方式、主办方、报名链接、私人场地、公开地址、精选、封面策略。「我去不去」单独保存，不满足公开条件时自动改成「活动后公开」并说明原因（骑行、非四个平台、私人场地、4 周内同主办方同场地重复）。封面 tab：换成模板、粘贴图片链接、从相册上传（后两者需要 Blob）。操作栏：保存、发布（未通过发布校验时逐项列出缺什么）、恢复或重新发布，更多操作里有「活动取消了」、下架、不要这条草稿、确认全部 AI 字段。
- **设置 `/admin/settings`**：两个总开关（显示「我去不去」、官方封面全换模板）、新活动的默认封面策略和「会去」可见性（ingest 现在按这两个默认值建草稿）、令牌的生成（只显示一次）与吊销，以及 iOS 快捷指令的配置步骤。
- **逻辑层 `src/lib/admin/events.ts`**：编辑时去掉被改字段的 AI 标记；已发布活动的时间、地点、形式变化会让 ICS 的 SEQUENCE 加一；改类别时模板封面跟着换；已发布活动不能清空时间或类别；链接照样经过 `publicSafeUrl` 清洗。

检查结果：typecheck、lint、build 通过；Vitest 212 个通过（新增后台逻辑 16 个）；Playwright 按 CI 方式 69 个通过；接本地数据库时新增的后台端到端测试也通过（添加 → 发布校验提示 → 补全 → 发布 → 公开站可见 → 下架后 404；令牌只显示一次并可吊销；manifest 公开、后台页面未登录会跳转）。另外在浏览器里用手机尺寸实际操作：粘贴真实 Luma 链接约 4 秒建好草稿并进入编辑器，测试数据已清理。

顺带修的测试问题
- 多个测试文件同时用 magic link 登录会互相抢 token，还会撞上 Better Auth 的限流（每个 IP 每分钟 5 次）。现在共用一个加了 Postgres advisory lock 的登录函数，遇到限流就等窗口过去；后台测试整个文件只登录一次。
- 首页类别芯片的测试以前偶尔在列表还没重新渲染时就去读，改为轮询。

下一步
- ~~第 11 周：候选收件箱~~ 见下一节。
- G2 门槛（手机添加 20 条、分享到草稿 p50 ≤ 6 秒）需要生产上有数据库和密钥（checklist 2、9），然后你装快捷指令（checklist 11）实测。

### M2 第 11 周（2026-09-30，提前完成）：候选收件箱

做了什么
- **三条私密日历源**：`GCAL_SECRET_ICS_URL`、`LUMA_PERSONAL_ICS_URL`、`PARTIFUL_ICS_URL`（Vercel env）。经 `safeFetch` 抓取（上限 15 MB），node-ical 解析未来 14 天，循环活动展开成每次一行。地址等同密码，不进日志也不进数据库，出错只记一个代码（如 `status_404`）。
- **什么会进收件箱**：Luma、Partiful 的全部条目；Google 日历只收带链接（视频会议、地图链接不算）或 Luma UID 的条目，私人日程不会存。每行只存标题、起止、地点、清洗过的链接（邀请 token 已去掉）、RSVP、活动状态和 ≤300 字摘要（去掉 HTML 和邮箱）。
- **去重**（`src/lib/inbox/keys.ts`、`candidates.ts`）：平台 id（Luma UID 里的 `evt-`、各平台链接）→ ICS UID → 模糊键（去 emoji 与标点的小写标题 + 15 分钟取整的开始时间 + 城市）。同一活动再次出现只累加来源和 sightings；忽略、稍后、已添加的状态不会被同步冲掉。和已有活动对得上时（平台 id、UID 或链接）自动标「已添加」，并把 UID 记到该活动的来源行，`/api/index` 也就能按 UID 跳过它。
- **同步时机**：打开 `/admin/inbox` 时在后台拉一次（10 分钟冷却），「刷新」按钮与每日 13:00 UTC 的 `/api/cron/sync` 用 1 分钟冷却；冷却和防并发锁是同一条条件 UPDATE。cron 同时清理结束超过 7 天的行，每次同步写一条 `jobs_log`。
- **skill 推送**：`POST /api/ingest` 的 `mode: "candidate"` 已实现，需要 candidates 权限；每批最多 100 条，逐条返回 `created`、`merged`、`added`（站上已有）或 `error`，只进收件箱，不建活动。`~/.claude/skills/weekly-events/SKILL.md` 加了第 5 步：写完 Notion 后先 `GET /api/index` 跳过已发布的，再推送；没有令牌文件时跳过（checklist 15）。改之前的版本备份在会话临时目录，没有进仓库。
- **收件箱界面**（手机优先）：按天分组；每行有勾选框、标题、时间、地点、来源芯片、skill 的理由和「skill 建议会去」、第一个链接、「已添加 · 草稿/已发布」链接、会去印章（点按 — → 想去 → 会去）、稍后（明天或下周一 08:00）、忽略。勾选后底部出现「添加 N 项」操作栏（盖住 tab 栏），可切「直接发布」；每行并行（最多 4 个）走 ingest 与封面流程，读不了的页面用日历标题建最小草稿。桌面键盘：J/K 移动，空格勾选，E 添加，X 忽略，H 稍后，G 切换会去，⌘↩ 添加所选。「稍后与已忽略」有单独视图，可以恢复。页首显示三条源的配置与同步状态。
- **设置页**：三条源是否已配置、配置步骤、skill 的用法，以及「清空收件箱数据」（二次确认；已添加的活动不受影响）。

检查结果：typecheck、lint、build 通过；Vitest 247 个通过（新增 35 个：去重键、ICS 解析、同步、skill 推送、忽略与稍后、过期、清空、勾 6 行生成 6 条草稿、会去不触发发布）。浏览器里用手机尺寸实测：skill 推送 4 条 → 显示与分组正确 → 勾 2 条添加成 2 条草稿并显示「已添加 · 草稿」→ 忽略 → 在「稍后与已忽略」里恢复。本地测试数据和令牌已清理（两条测试草稿改成 archived，测试令牌已吊销）。

还没做（留给打磨）
- 手机上的滑动手势（右滑添加、左滑忽略、长按稍后）：现在是按钮，需要引入 motion。
- 桌面三栏（筛选、列表、预览）：现在是单栏加来源筛选芯片。
- 真实三条源的联调：等你完成 checklist 4–7 后，我看一次同步结果（Luma UID 格式、Google 私密地址是否带 PARTSTAT 都还没见过真数据）。

下一步
- 第 12 周：G2 门槛实测（分享到草稿 p50 ≤ 6 秒、每个发布活动都有封面、总开关验证），然后进 M3 newsletter。

### M3 第 13 周（2026-10-04）：订阅流程

做了什么
- **订阅页 `/subscribe`、`/zh/subscribe`**：邮箱、7 个类别（按 `?c=` 预选，默认全选）、邮件语言；Server Action 依次检查蜜罐、填写时间 ≥ 3 秒（从页面开始加载算）、Vercel BotID、每 IP 10 分钟 5 次、每个收件箱每天 3 次（`+tag` 和 Gmail 的点算同一个收件箱）、全站每天的订阅邮件预算（默认 40 封，`SUBSCRIBE_DAILY_SEND_CAP`）。新地址、待确认、已退订、已订阅、被抑制，表单一律显示「还差一步」，邮件在响应之后才发，所以从页面和响应时间都看不出谁订阅过。已订阅的地址会收到一封「已经订阅过了」的偏好链接，不改任何东西。
- **双重确认**：确认邮件中英双语，订阅者的语言在前，没有任何推广内容；没有 Resend key 时写进服务器日志（和后台登录一样）。链接 `/confirm/<token>` 把待确认改成订阅中，然后跳到偏好页显示「订阅好了」；超过 7 天的链接算过期；对 HEAD 请求不做任何事（防邮件扫描器）。
- **链接令牌**：`<id>.<HMAC-SHA256(SUBSCRIBER_LINK_SECRET, id:token_version)>`，不落库，常数时间比对；网址里永远没有邮箱。
- **偏好页 `/prefs/<token>`**：语言和类别（全不选等于退订）、暂停 4 周 / 恢复、全部退订 / 重新订阅；不显示邮箱。重新订阅会记录新的同意（时间、IP、浏览器、来源页）。
- **退订**：`POST /api/unsubscribe?t=…` 按 RFC 8058 一键退订（不需要 cookie、返回 200、不跳转、立即生效、重复调用不报错）；同一网址的 GET 只跳到人工退订页，从不退订（邮件扫描器会预取链接）。人工页 `/unsubscribe?t=` 可以只退一个类别或全部退订，只有按按钮才改。
- **退信与投诉**：`/api/webhooks/resend` 用 Resend SDK 校验 Svix 签名；硬退信、投诉、Resend 自己的抑制都把地址标为 suppressed，之后表单和偏好页都不能再订阅它。
- **清理**：每天 13:00 UTC 的 cron 删除 7 天没确认的新地址；曾经订阅过、重新申请却没确认的地址退回「已退订」而不是删除（保留历史，也不会撞上 digest_sends 的外键）。成功和失败都写 `jobs_log`。
- **开关**：`newsletterStatus()`。本地和 CI 有数据库和密钥就开放；Vercel 上要有 Resend key 且发件地址在自有域名才开放。关闭时订阅页显示「邮件周报快开始了」和日历订阅菜单，页头、页脚、sitemap 都不出现订阅入口。确认、偏好、退订和 webhook 不受开关影响。
- **接线**：proxy 让带点的令牌路径也走 next-intl（否则英文的 `/confirm/<id>.<sig>` 会 404），并跳过 BotID 的挑战路径；令牌页加 `noindex` 和 `X-Robots-Tag`；BotID 只保护这两个 POST 路径。

检查结果：typecheck、lint、build 通过；Vitest 555 个通过（本周新增约 320 个）；Playwright 接本地数据库 63 个通过（另外 63 个是只在无数据库时跑的），按 CI 的无数据库方式 101 个通过（25 个需要数据库的跳过），没有失败。开发方式：先用 5 个并行调研摸清约定、文档和需求，我写核心库（令牌、状态机、邮件、开关）和设计约定，4 个并行任务分别做页面、偏好页、接口、接线和 e2e；然后 6 个角度的对抗式审查（安全、合规、状态机、Next.js、体验、测试），40 个代理核实后确认 24 条（多数是低严重度），全部修复或记录；再用 3 个代理核验修复，另外补了 6 个小问题（每 IP 每天 10 次、预算先看后扣、确认邮件的 7 天措辞、退订页「不可用」措辞、填写计时防时钟回拨、关闭状态下无 JS 也能看到日历订阅）。我在浏览器里用手机尺寸走了一遍：订阅 → 日志里的确认链接 → 偏好页「订阅好了」→ 一键退订 → 偏好页「已退订」，测试数据已删除。

下一步
- 第 14 周：周报模板、按语言和类别组装、分批发送、两条周日 cron。

### M3 第 14 周（2026-10-05）：每周周报

做了什么
- **一期覆盖哪几天**：一期覆盖一个 ISO 周（周一 00:00 到下周一 00:00，太平洋时间），在前一个周日 17:00 PT 之后发出；`iso_week` 就是覆盖的那一周，和 `/week/yyyy-Www` 对得上。夏令时切换的那一周是 167 或 169 小时，按日期算，不按 7 × 24 小时算。
- **内容**：导语 → 我会去（只列公开印章，只写哪天、不写几点，「打算去」）→ 订阅的每个类别一节（按天分组）→ 下周预告（精选）→ 双语页脚（无付费植入、偏好、退订、改收另一种语言、网页版）。只选了黑客松和 AI 的人，「我会去」和「下周预告」也只出现这两类。总开关关掉时没有「我会去」、没有印章、标题里也不写会去几场。标题如实：「本周 6 场精选 · Victor 会去 2 场」。
- **封面**：邮件里用 192 px 的 PNG/JPEG。模板封面走 `/og/template/[类别]?s=192`；Luma 来源的官方封面默认换成模板，除非你在编辑器里勾「这期保留官方封面」；其他真实封面经 `/og/email-cover/[id]` 转成 JPEG（WebP 在 Outlook 里显示不了）。印章是 `/og/seal/[类型]?l=` 的 PNG，图片被屏蔽时显示 `[会去]` / `[GOING]`。
- **模板**：react-email，全部内联样式，600 px 单栏，深色模式，Outlook 的 600 px 外框，纯文本版里的链接用尖括号包住。最坏情况（7 类 30 场）约 83 KB，低于 Gmail 截断前的 90 KB 上限；超过的变体会报错而不是被截断。
- **发送**：每个「语言 × 类别组合」只渲染一次，再把每个人的令牌填进去；每批最多 100 人（不同组合可以拼在一批）；每封都带 RFC 8058 一键退订头。先在 `digest_sends` 里占位再发（单条 SQL），同一组人用同一个幂等键，重试时邮件内容逐字节相同（这一期开始发送时把内容冻结进 `snapshot`）。01:00 和 02:00 UTC 两次定时任务、管理员「立即发送」都走同一段代码，靠租约保证同时只有一个在跑。每天最多发 60 封周报（`DIGEST_DAILY_CAP`），超出的第二天傍晚补发。周日 17:00 之后 27 小时还没开始的一期不再发。
- **没有推荐的一周**：你选的类别这周没有活动的人，每个月最多收一封「本周没有想推荐的」，其余周不打扰。
- **编辑器 `/admin/digest`**（后台「更多」里）：写一种语言的导语，另一种让模型起草（要你确认后才能排期）；勾下周预告的精选；Luma 封面的保留开关；按语言和类别预览邮件（iframe），显示标题、场数、大小；每个组合的人数；发测试（只发到 `ADMIN_EMAIL`，标题加「[测试]」，每天最多 10 封）；排期 / 取消排期 / 立即发送。
- **生产开关**：Vercel 上没有验证过的发件地址时，周报定时任务什么都不写、直接跳过；`DIGEST_SENDING=0` 随时可以关。

检查结果：typecheck、lint、build 通过；Vitest 831 个通过；Playwright 接本地数据库 64 个通过，按 CI 方式 101 个通过。我在本地用真实 Postgres 跑了一次：3 个订阅者 1 批发完，只选骑行的那位收到「本周没有推荐」，再跑一次没有重复；在编辑器里用手机尺寸看了邮件（封面、印章、点评、双语页脚）。开发方式和第 13 周相同：5 个并行调研、我写核心与约定、4 个并行任务、6 个角度对抗审查（31 个代理，确认 22 条），3 个并行修复，再核验一轮（又补了 4 个小问题：可能已送达的重试行继续计入「每月一封」、改收语言后单选框跟着更新、编辑器在有版本渲染失败或接近 90 KB 时提醒、`DIGEST_SENDING=0` 的端到端测试）。审查里抓到一个我自己引入的严重回归（拆分活动查询时让 `getEventBySlug` 带上了日期过滤，有数据库时所有活动页都会 404），已修复并补了测试。

### M3 第 15 周（2026-10-05）：隐私页、周报存档、订阅者后台、微信文字

做了什么
- **`/privacy` 与 `/zh/privacy`**：第一人称、静态页面，每一条都对照代码写的。内容包括：
  - 存了什么、为什么存；唯一的 cookie（换语言时的 `NEXT_LOCALE`）；
  - 没有统计、广告和第三方脚本；不追踪打开与点击；
  - 四个服务商（Vercel、Neon、Upstash、Resend）及其隐私政策链接；
  - 各类数据保留多久；怎么查看或删除；主办方下架（24 小时，只管网站和之后的邮件）；
  - 「请勿追踪」与 GPC、13 岁以下、适用范围；最后更新日期。
  - 联系邮箱读 `PRIVACY_CONTACT_EMAIL`（不写进公开仓库），没设时页面写「开放订阅前会补上」。页脚、订阅表单、确认邮件和周报页脚都加了隐私链接，`/privacy` 进了 sitemap。
- **改掉一句不实的文案**：活动页和订阅页说「取消和改期也会发邮件通知」，实际没有这种邮件。现在写的是实情：日历订阅下次刷新时同步，取消的活动标成「已取消」留在订阅里。
- **`/weekly` 公开存档**：每期发出后（从开始发送那一刻）有一个公开网页版，邮件里的「网页版」链接指向它（没有活动、只发了「本周没有推荐」的那期仍指向 `/week/`）。
  - 哪些活动、什么顺序、导语，按冻结的内容；每场活动的样子按现在的数据。所以下架的活动会消失，取消的划掉，关掉「显示我去不去」后印章也跟着消失。
  - `/weekly` 列出全部往期，页脚和 sitemap 都有。发送任务结束或出错时都会刷新缓存。
- **`/admin/subscribers`**（后台「更多」里）：
  - 各状态 × 语言的人数；本周日会收到周报的人按类别 × 语言统计。
  - G3 门槛卡：确认订阅人数 / 50；最近两期发了多少、是否准时、是否连续两周；退信率、投诉率、种子退信。
  - 双重确认的转化率（近似值）。
  - 精确搜索（邮箱、订阅者 id 或贴一条偏好页链接）：只用 POST，邮箱不会出现在网址里。
  - 手动抑制，删除（一条 SQL 删掉订阅者和发送记录，正在发送时拒绝）。
  - 导出 CSV（只限登录的管理员，不含 IP 和浏览器信息）。
- **保留期限**：退订满 12 个月的记录连同发送记录在每天的定时任务里删除；退信、投诉和手动抑制的保留，作为不再发送的名单。限速计数器里的 IP 改成存哈希。
- **微信文字**：`/admin/digest` 里一键复制中文纯文本：
  - 编号、按天分组、北美太平洋时间（线上活动加北京时间）、一句点评、下周预告。
  - 只有一个链接 `/zh/week/W`，订阅开放后再加订阅链接；没有 emoji，没有任何个人链接。
  - 已发出的那期也按现在的数据导出：关掉「显示我去不去」后没有 [会去]，下架的活动去掉，取消的标「已取消」且不计数。
- **种子邮件**：`/admin/digest` 的「发种子邮件」把当前预览的版本发给 `DIGEST_SEED_EMAILS` 里的地址（最多 10 个，每天最多 4 轮）。
  - 必须有验证过的发信域名才能用。
  - 界面和日志只显示域名，不显示地址；标签是 `digest_seed`，不会误伤订阅者。
- **退信日志**：Resend webhook 的退信、投诉、抑制、发送失败都记一行到 `jobs_log`（`email_event`，只有类型、期号、域名，没有地址），订阅者后台据此算退信率和种子退信。

检查结果：
- typecheck、lint、build 通过；Vitest 1014 个通过（新增约 180 个）。
- Playwright 按 CI 方式 111 个通过；接本地数据库 74 个通过。
- 本地用手机尺寸看了 `/zh/privacy`、`/zh/weekly` 和一期临时造的存档页（看完已删掉）。

开发方式：
- 4 个并行调研，我写核心与约定，4 个并行任务。
- 6 个角度对抗审查：12 个代理，确认 20 条、驳回 4 条。其中中等的两条：
  - 已发出那期的微信文字不看现在的「显示我去不去」开关；
  - 隐私页说删掉被抑制的地址就能重新订阅，但 Resend 自己还有一份抑制名单。
- 3 组并行修复，各自核验一轮，我又补了一个读屏器把相邻文字连读的小问题。

下一步
- 第 16 周（G3）：要等域名和 Resend（checklist 1、3、16、17）。之后是：微信群软启动；连续两期准时发给 ≥ 50 人；种子 0 退信；Gmail 一键退订实测。

### M4 第一轮（2026-10-06）：微信长图与小红书、封面新来源、活动语言与线上偏好

做了什么
- **微信长图与小红书（F17）**：在 `/admin/digest` 的微信文字下面多了「长图 · 小红书」面板。
  - 微信：一张 1080 宽的长图（超过 9000 px 按活动拆成 1/2、2/2），编号和微信文字完全一致，封面跟邮件一样（并印出署名），底部印出本周链接的纯文字。
  - 小红书：3:4 的图，一张封面加最多 8 页、每页 4 场（总共不超过 9 张）；只用模板封面；图片和文案里都没有任何网址或域名（有测试把关，连活动来源网站的域名也去掉了）。点「小红书」时会先把标题和正文复制好。
  - iPhone 上三步：生成 → 保存 → 分享菜单里「存储图像」；电脑上是下载链接。已发出的那期同样按现在的开关和活动状态出图，换过封面会自动换成模板。
  - 图片只给登录的管理员看，现画现给，不存到 Blob。中文字体按这周用到的字从 Google Fonts 分批取，取不全就报错，不会出缺字的图。
  - 顺手修了一个线上问题：分享卡片遇到 WebP 封面时 Satori 读不了，卡片上封面是空的，现在先转成 JPEG。
- **封面的三个新来源（F11 P1）**：编辑器「封面」里多了三栏，只在你点的时候用，自动封面链不会碰它们。
  - Openverse：只搜 CC0、CC BY、CC BY-SA；选中时在服务器上再核对一次许可；网站上显示作品名、作者和许可并附链接，邮件里也带链接。
  - AI 抽象封面：先预览、满意再用；提示词只有固定文字加类别，不含活动标题和主办方；默认 Recraft，「精细版」用 FLUX。要先完成 checklist 8，否则显示「AI Gateway 需要先充值」。
  - Brave 图片搜索：只给建议，要 `BRAVE_SEARCH_API_KEY`（checklist 18）。Brave 的图不进邮件和分享卡片；需要署名的 Openverse 图也不进分享卡片和搜索引擎的结构化数据。
  - 每天的次数上限：Openverse 100、Brave 30、AI 20（全站共用）。
- **活动语言与只看线上（F19）**：
  - 订阅设置里可以选「不限 / 中文或双语 / 英文或双语」和「只要线上活动（含线上线下同步）」，周报只发符合条件的活动（「我会去」和下周预告也一样），页脚写一句「只收：…」。
  - 日历订阅支持 `ev_lang=zh|en|bilingual` 和 `online=1`；网站上的筛选会带进订阅链接和订阅表单。网站筛选加了「英文」选项。
  - 以前的订阅者不受影响（没设就是不限）；已经在发的那期重试时内容逐字节不变。
  - 后台周报预览可以按活动语言和线上筛选看；订阅者后台显示各筛选的人数，CSV 多两列。
- **隐私页**更新到 2026-10-06：封面的几种来源和各自出现在哪里、AI 也用来做抽象封面、订阅时可以存的两个筛选、Upstash 里的每日计数和 Openverse 搜索缓存。

检查结果：
- typecheck、lint、build 通过；Vitest 1202 个通过（新增约 190 个）。第一次跑全套时机器负载很高，有 12 个数据库测试超时，重跑全部通过。
- Playwright 按 CI 方式 115 个通过，接本地数据库 74 个通过。

开发方式：
- 4 个并行调研（上一次断网失败，重跑），我写约定，3 个并行任务。
- 6 个角度对抗审查：12 个代理，确认 23 条、驳回 1 条。中等的几条：
  - 邮件里 Openverse 封面的署名缺许可和出处链接（CC BY 2.0 要求附许可链接）；
  - 小红书图片会印出活动来源网站的域名；
  - 长图的封面署名会被截断；
  - 已发出那期换掉封面后，长图可能还是旧封面；
  - 隐私页列的封面种类漏了手动上传和贴链接的。
- 3 组并行修复，各自核验一轮，我又补了三处小问题。

下一步
- M4 第二轮：「会去」即时提醒（F20），见下一节。

### M4 第二轮（2026-10-06）：「会去」即时提醒（F20）

做了什么
- **订阅者可以选择开启**：订阅设置和订阅表单里有「Victor 标记会去时提醒我（每天最多一封）」，只有发信可用时才显示（现在生产上不显示）。只会收到开启之后标记的活动。
- **什么时候发**：你在后台把活动标成公开的会去、主办或分享时记一笔；第二天早上 7–9 点（太平洋时间）的定时任务把前一天的标记合成一封发出（`vercel.json` 多了两条 cron，共 5 条）。当天的活动不发；周日有周报的话不发提醒，那一周的活动由周报带上。
- **发之前再检查一次**：活动必须现在仍然公开会去（没下架、没取消、没改成隐藏或活动后公开、总开关开着），读者仍然订阅、开着提醒、类别和活动语言/线上筛选都符合；同一场活动不会发给同一个人两次（包括已经在周报里看到的）。
- **邮件**：标题「Victor 打算去：活动名」或「Victor 打算去 N 场活动」；只写哪天，不写几点和具体地址；页脚三个链接：关闭会去提醒、订阅设置、全部退订。邮件 App 的一键退订只关闭提醒，不影响周报。
- **配额**：提醒每天最多 30 封（`ALERT_DAILY_CAP`），和周报一起算在每天 60 封（`DIGEST_DAILY_CAP`）以内；超出的并到第二天。`ALERTS_SENDING=0` 可以单独关掉提醒。
- **后台**：「会去」表单多了「提醒订阅者」开关（默认开，记住你上次的选择），保存后告诉你：明早发、周日周报会带上、活动太近不发、不发，或者提醒暂停中。订阅者后台多了「开了会去提醒的人数」和「下一封会去提醒」预览。
- **数据**：新表 `going_marks`（标记时间和开关，不含个人信息）、`alert_sends`（每人每天一行），`subscribers.going_alerts_since`。删除订阅者、退订满 12 个月清理、未确认 7 天清理都包括提醒的发送记录。
- **确认邮件**会写明你还开了会去提醒；隐私页同步更新。
- 顺带修了周报的一个隐患：重试时如果同一批里有人已经退订，防重复的标识会变，可能让其余人收到两封；现在标识在认领时就固定了。

检查结果：
- typecheck、lint、build 通过；Vitest 1451 个通过（这一轮新增约 250 个）。
- Playwright 按 CI 方式 115 个通过，接本地数据库 74 个通过。
- 本地开发库已经跑过 `0004`。另外，本地库里积了 65 个测试用的通行密钥（全是 Chromium 虚拟验证器的），超过了 WebAuthn 64 个的上限，导致通行密钥那条端到端测试失败；已删除，并让这条测试以后自己清理。

开发方式：
- 调研沿用第一轮的，我写约定，3 个并行任务。
- 6 个角度对抗审查：12 个代理，确认 19 条、驳回 2 条。严重的一条是上面那个重试换标识的问题（周报同样有）。中等的：
  - 某些失败重试下一个早上会收到两封；
  - 取消或下架后重新发布会把你关掉的提醒重新打开；
  - 订阅设置清空类别时「关闭提醒」会丢；
  - 确认邮件没提提醒；
  - 卡住的发送记录会一直挡住删除和到期清理。
- 3 组并行修复，各自核验一轮；我又补了几处提示文案（周日周报那一周的活动、暂停时取消勾选、活动太近）。

下一步
- ✅ 2026-10-06 已在生产库跑迁移 `0004_going_alerts`（5 条迁移记录，两张新表、一列、三个索引都在）。
- 真正发出提醒仍然要等域名和 Resend（checklist 1、3、16）。

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
- **后台组件手写，没有引入 shadcn**：指南写 shadcn 只用于 /admin。后台需要的就是按钮、输入框、下拉、tab，手写更小，也直接用全站 token；以后需要复杂组件（日期选择器、对话框）再引入。
- **添加后直接进编辑器**：指南写添加页 2–4 秒后显示和公开站一样的 EventCard 预览；我改成直接跳到编辑器，编辑器顶部显示状态和时间，封面 tab 显示实际封面，发布后有「查看」链接到公开页。这样手机上少一步。
- **编辑器的每个按钮都会先保存整张表单**：重译、发布、下架前不会丢掉没保存的修改。
- **下架和「不要这条草稿」都是改成 archived，不删除**：链接仍然在去重表里，同一个链接不会被再次添加进来。
- **Google 日历只收带链接的条目**：PRD 写「未来 14 天的日历条目」。但私密地址里是你全部的课程、训练和私事，这些没有链接也添加不了（活动必须有来源链接）。只存带链接的条目，收件箱更干净，也少存私人数据。想全收的话删掉 `parseFeed` 里的一行。
- **没添加的行点「会去」会先建一条草稿**：会去是活动的属性，候选表里没有这个字段。草稿不公开，所以这不等于发布；「—」在没添加的行上什么也不做。
- **已添加的行留在列表里**（变淡、显示「已添加」和状态），这样还能直接切换会去；它们和其他行一样在活动结束 7 天后过期。
- **ICS 里标成 CANCELLED 的条目只更新已有的行**（显示「已取消」），不会新建。
- **循环活动的每次出现不用平台 id 去重**：同一个 Meetup 链接会把每周的活动合成一行，所以每次出现按自己的 UID 和模糊键去重。
- **RSVP 只存不显示**：指南说 P2 之前收件箱不显示 RSVP 灰字。读 PARTSTAT 时认 `INBOX_EMAILS`（逗号分隔，可选），没设就用 `ADMIN_EMAIL`；Google 日历在个人 Gmail 账号上时可以设成那个地址。
- **skill 推送成功返回 200**（逐条结果），不是单链接 ingest 的 201/202/409。
- **订阅表单在生产上保持关闭**，直到 Resend 有自有域名的发件地址：共享的 onboarding@resend.dev 只能发给 Resend 账号本人，开着表单会让访客等一封永远不会到的确认信。`NEWSLETTER_OPEN=1` 可以临时在 Vercel 上打开（只适合你自己测试）。
- **确认用 GET**（按指南），邮件扫描器有可能替人确认；如果以后发现这种情况，改成页面上一个「确认」按钮。HEAD 请求不确认。
- **令牌不轮换**：退订不改 token_version，旧邮件里的一键退订链接永远有效（RFC 8058 要求能自动完成）。轮换密钥会让所有已发邮件的链接失效，只在泄露时用。
- **偏好页可以「重新订阅」**：持有链接就证明是本人收件箱，确认过的地址直接恢复，没确认过的重新发确认信；被抑制的地址不能恢复。
- **全站每天订阅邮件预算 40 封**（`SUBSCRIBE_DAILY_SEND_CAP`）：指南的每 IP、每地址限速挡不住多地址刷量，Resend Free 每天 100 封还要留给后台登录和周报。超出时表单显示「今天暂停接受新订阅」。
- **BotID 服务本身出错时放行**（记日志），靠蜜罐、填写时间和三层限速兜底；否则 OIDC 没开之类的配置问题会挡住所有真实订阅。
- **订阅邮件在响应之后发**（`after()`）：所有结果响应时间一致，看不出地址是否被抑制；代价是发送失败时访客不会立刻知道，提示里有「没收到就再提交一次」。
- **going 提醒复选框不放**：指南的表单写了可选的 going 提醒，但它是 P1（M4），放一个不起作用的选项不诚实。
- **确认邮件用纯 HTML**，和后台登录邮件一样；周报（第 14 周）用 react-email。更正：react-email 6.11 其实通过 `@react-email/render` 导出了 `render` 和 `toPlainText`，第 13 周的判断有误。
- **没开 JavaScript 的访客**：订阅表单和偏好页需要 JavaScript（BotID 只能验证脚本发出的请求）；页面会说明，退订页提示可以用邮件 App 的退订按钮（RFC 8058）。
- **一期覆盖下一个 ISO 周**（周一到周日），不是首页那种「今天起 7 天」：周日晚上发出时当天的活动已经在进行，下周日的活动也不该等到再下一期。
- **「我会去」和下周预告也按订阅的类别过滤**，这样「只收你选的类别」字面成立，标题里的数字也和邮件内容一致。
- **周报内容在开始发送时冻结**（`digest_issues.snapshot`），之后的批次都用冻结的内容渲染，重试才会逐字节相同。冻结后只会「收窄」：发送途中关掉「显示我去不去」或打开「官方封面全换模板」，后面的批次会跟着收窄，但不会反过来放宽。
- **每批混装不同组合**：指南写每个变体一批；订阅者分散在几十种组合里时那样要几十次调用，混装只要一次（每封邮件本来就有自己的 HTML）。
- **每天最多 60 封周报**：Resend Free 每天 100 封还要留给后台登录和订阅邮件；超过的第二天傍晚（周一 17/18 点 PT）补发，仍在 27 小时窗口内。订阅者接近 60 人时该升级 Resend Pro。
- **测试邮件不写 `digest_sends`**，标签是 `digest_test`，所以测试邮件退信不会误伤任何订阅者。没有 Resend key 时测试邮件里用无效令牌，免得真实令牌出现在服务器日志里。
- **「改收中文版 / Switch to English」**：页脚链接带 `?lang=`，偏好页上方出现一键切换，只改语言、不动类别。
- **没有做周六提醒邮件**（研究建议过：周六还没排期就提醒你一次），先看实际是否需要。
- **重译用 anthropic/claude-sonnet-4.6**（指南指定）；没配 AI Gateway 时提示「AI 还没配置」。
- **本地连数据库跑 e2e 时 sitemap 那条会失败**：本地库里的 20 条示例活动是 9/28 写进去的，日期是相对那天算的，现在已经过期。CI 不连数据库，不受影响。要刷新的话删掉本地 `seed_` 开头的活动再 `pnpm db:seed`（我没有动你的本地数据）。
- **模板图和分享卡片按需渲染、边缘缓存，不存进 Blob**：指南写的是生成后 `put` 到 Blob（`url_og_en`、`url_og_zh`）。改成 `/og/...` 路由按需渲染有三个好处：还没装 Blob 也能用；改了标题或时间自动更新（URL 带指纹）；省 Blob 的写操作额度。`covers.url_og_*` 暂时留空。
- **组合图版式**：有主办方头像时类别字缩到约 26% 并上移，头像放大到 26% 放在下方；没有头像时和站内模板一致。
- **分享卡片的字体在运行时从 Google Fonts 取子集**：指南只对中文字形这样写，我把 Fraunces 和 Geist Mono 也一起这样取，避免把字体文件打进函数包（之前打包 node_modules 里的文件被 Vercel 拒过）。取不到时 Satori 用内置字体兜底，不会失败。
- **上传路由只签发令牌，不用 `onUploadCompleted` 回调**：回调需要公网可达的地址，本地开发收不到；编辑器拿到上传后的 URL 直接调 `coverFromUpload` 处理。
- **没有 Resend 时第一次登录后台用日志里的链接**：`sendEmail` 在没有 `RESEND_API_KEY` 时把邮件正文写进服务器日志。生产日志只有你的 Vercel 账号能看，链接 5 分钟有效、一次性，而且只有 `ADMIN_EMAIL` 能申请。登录后注册通行密钥，之后不再需要邮件。等 M3 有域名、装好 Resend 后自动改回发邮件。
- **Upstash 通过 Vercel 安装时注入的是 `KV_REST_API_URL` / `KV_REST_API_TOKEN`**，代码现在两套名字都认。
- **预览部署和生产共用同一个 Neon 数据库**：Neon 的「每个 PR 一个数据库分支」以后再开；在那之前别在预览环境里做破坏性操作。
- **本地 API 令牌脚本叫 `pnpm api-token`**（pnpm 保留了 `token` 这个命令名）。
- **`victorchun-site` 升级到 16.3.7 暂缓**：npm 上 next 最新仍是 16.3.6（今天 9/28，指南说 9/30 之后发布）。它在另一个仓库，发布后单独处理。

- **`/privacy` 的联系邮箱用 env `PRIVACY_CONTACT_EMAIL`**，不写进公开仓库，也不回退到 `ADMIN_EMAIL`（那是后台登录白名单，公开它等于告诉别人该攻击哪个邮箱）。Vercel 上没设时订阅表单保持关闭（`NEWSLETTER_OPEN=1` 仍可强开）。
- **数据删除**：只能由你在 `/admin/subscribers` 操作，访客发邮件申请。被抑制的地址删除时要输入 DELETE 确认，并提醒你到 Resend 后台 → Suppressions 一起删，否则新订阅会被 Resend 再次抑制（Resend SDK 有删除接口，但我没自动调用）。
- **保留期限**：未确认 7 天删除（已有）；退订满 12 个月连同发送记录删除；退信、投诉和手动抑制的保留，作为不再发送的名单。指南没写退订后的保留期，12 个月是我定的，可以改。
- **订阅记录只保留最近一次申请**：别人用你的地址再提交一次（没确认），记录里的 IP 和浏览器信息会被覆盖。隐私页如实写成「最近一次订阅申请，不论是否确认」。要保留每次同意的历史需要加列和迁移，先不做。
- **限速计数器存 IP 的哈希**，不存原始 IP。
- **`/weekly` 从开始发送时公开**，不是等全部发完：邮件在发送时渲染，「网页版」链接只能在那时确定；超过每天 60 封上限时其余的第二天才发，等发完会让先收到的人打开 404。`/weekly` 列表和 sitemap 只列已发完的。
- **存档按现在的数据显示活动**：标题、时间、点评改了会跟着变，下架会消失。代价是存档不完全等于当时的邮件。
- **微信文字只有一个链接 `/zh/week/W`**，不放每场活动的链接；订阅开放后加订阅链接。按北美太平洋时间，线上活动加北京时间。已发出的那期按现在的开关和活动状态导出，但时间和标题仍按冻结的内容（改期了要手动改）。
- **种子邮件用真实标题**（不加「[测试]」），因为要看的是进收件箱还是垃圾箱；幂等键按分钟，修改后同一小时内重发不会被当成重复。
- **CSV 导出不含 IP 和浏览器信息**（数据最小化）。要拿它当同意证据的话告诉我，我加回去。
- **退信率的分母包括「本周没有推荐」那种邮件**，G3 的「发给 ≥ 50 人」只算正式周报。
- **G3 卡上的种子退信包括退信、抑制和发送失败**；Gmail 一键退订、进收件箱还是垃圾箱只能手动看（checklist 17）。

- **活动语言「中文」包括双语活动**（「英文」也一样），和网站筛选一致；PRD 的验收写的是「只收 zh 活动」（见文档冲突 31）。**线上包括线上线下同步**。
- **活动语言只能单选**，存成一个元素的数组；没有加数据库约束（不合规的值一律当作不限），所以这一轮没有迁移。
- **订阅表单不加新控件**：从网站筛选带过来的活动语言和线上条件放在隐藏字段里，旁边一行说明加「清除」；要改就去订阅设置。
- **「我会去」和下周预告也按活动语言和线上过滤**，标题里的数字跟着变。
- **风险**：现在活动语言决定谁会收到邮件，而抓取时是按标题有没有汉字猜的，标题是英文的双语活动会被标成英文。编辑器里要留意这个字段。
- **长图和小红书**：微信长图跟邮件用同一张封面并印出署名；小红书一律用模板封面（官方海报里常有二维码和网址，小红书也是转载风险最大的地方）。小红书的图和文案不出现任何网址。中文正文用思源黑体（Noto Sans SC），网站点评用的霞鹜文楷不在 Google Fonts 上，没有用。
- **长图可以导出草稿**，会提示是草稿。已发出的那期用冻结时的时间和标题。
- **AI 封面先预览再用**，不一键替换（替换会删掉原来的官方封面，找不回来）。网站上标明「AI 生成封面」。
- **Brave 找到的图不进邮件和分享卡片**（不知道许可）；需要署名的 Openverse 图不进分享卡片（卡片上没地方写署名）。
- **每月订阅者 CSV 导出到 Blob 这一项不做**：我们的 Blob 是公开的，后台的直接下载已经能拿到全部数据。

- **会去提醒在第二天早上发**（7–9 点太平洋时间），不是标记后立刻发：这样一天里的多次标记能合成一封，Hobby 计划的 cron 也只能每天跑。当天的活动不发提醒。
- **周日有周报就不发提醒**，那一周的活动由周报带上；周一的提醒跳过周报里已经出现过的活动。
- **提醒也按订阅者的类别和活动语言/线上筛选过滤**，和周报的「我会去」一致。
- **每次标记都有「提醒订阅者」开关**，默认开；关掉之后重新发布、快捷按钮都不会把它重新打开，只有你在表单里再勾上才会。
- **新开提醒的人只收到开启之后的标记**，不补发以前的。
- **邮件 App 的一键退订只关闭提醒**（RFC 8058 按列表），提醒邮件页脚另有「全部退订」。
- **提醒和周报共用每天 60 封的配额**，提醒自己每天最多 30 封；超出的第二天合并发。
- **没确认的重新订阅申请过期时，会去提醒也一起关掉**，避免别人替你开了提醒。

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
15. **收件箱怎么抓 ICS**：指南的 `sync-ics.ts` 示例用 `ical.async.fromURL`，而同一份指南又用 ESLint 禁止 `inbox/` 目录直接发请求（SSRF 规则）。按 SSRF 规则：`safeFetch` 取文本，再 `ical.sync.parseICS`。
16. **取消的日历条目**：指南示例代码直接跳过 CANCELLED，正文又说 `event_status = CANCELLED` 时显示「已取消」。两者合起来：不新建，只更新已有的行。
17. **收件箱同步锁**：指南写 Upstash 锁防并发。改用 `sync_state` 表的一条条件 UPDATE，冷却和锁一步完成，本地和测试也不需要 Redis。
18. **订阅表单提交方式**：PRD 写「用 fetch 提交」，指南写 Server Action。按指南。
19. **令牌存储**：PRD 写「32 字节哈希 token」（暗示存哈希），指南用 HMAC 现算、不落库、靠 token_version 作废。按指南。
20. **going 提醒**：指南的表单与组件表写了可选 going 提醒，PRD 与指南的里程碑把它放在 P1（M4）。按里程碑，第 13 周不放（见待确认）。
21. **周报的 claim**：指南写「事务内插入 claim 行」，neon-http 不支持交互式事务。改成单条 `INSERT … SELECT … ON CONFLICT DO NOTHING RETURNING`，并新增 `batch_key` 记录同一批，重试时用同一个幂等键。
22. **周报的数据模型**：指南没有的三列和一个索引（迁移 `0003_digest_send`）：`digest_issues.auto_fields`（模型起草、待确认的导语）、`keep_cover_ids`（这期保留的 Luma 官方封面）、`snapshot`（冻结的内容）；`digest_sends.kind`（digest / empty）、`batch_key`、`error`。
23. **周报的锁**：指南写 Upstash 锁，改用 `sync_state` 的条件 UPDATE 租约（同第 17 条）。
24. **周报每批**：指南每个变体一批，改为跨变体混装，每批最多 100 人（见待确认）。
25. **`/weekly` 何时公开**：spec 第 33 条写「status = 'sent' 才显示，之前『网页版』链到 `/week/`」。改为从开始发送时公开、邮件直接链到 `/weekly/`（见待确认）。
26. **网站统计**：指南计划用 Vercel Web Analytics，现在没有装，隐私页写的是「没有统计」。以后要装的话先改隐私页。
27. **取消的活动保留 14 天**：指南写取消的条目在订阅里保留 14 天，代码里没有单独实现（`getWindow` 的注释曾这样写，已改正）：取消的活动在它的日期还在订阅时间窗内时一直显示「已取消」。文案按实际写。
28. **订阅者 CSV**：M4 计划把每月的订阅者 CSV 存到 Blob，但我们的 Blob 是公开的，会把邮箱公开出去。第 15 周改成后台直接下载，M4 做的时候不要放进公开 Blob。
29. **姓名**：指南的隐私条目写「可选姓名」，订阅表单没有姓名字段，隐私页也不提。
30. **大陆读者引导**（指南 PIPL 一条：引导大陆读者用 ICS 和微信）：按 2026-09-30 的决定不考虑大陆，隐私页只写一句适用范围。
31. **「中文活动」的范围**：PRD F19 的验收写「选中文活动只收 zh 活动」，但网站筛选里中文一直包括双语活动。按网站的规则：中文 = 中文 + 双语，并在所有地方写明「中文或双语」。
32. **小红书张数**：资料里有「最多 9 张」和「最多 18 张」两种说法，按 9 张做。
33. **长图的封面**：指南没说长图用哪种封面。按邮件的选择，小红书一律模板（见待确认）。
34. **「可选提醒」是谁的选项**：PRD F20 写「Victor 标记公开会去时可选提醒」，没说是你选还是读者选。两边都做了：读者开启才收，你每次标记也可以选择不发。
35. **提醒的数据**：指南只有 `subscribers.going_alerts` 一列。为了「每天最多一封、两次标记合并、不重复发」，加了 `going_marks`、`alert_sends` 两张表和 `going_alerts_since` 一列（迁移 `0004`）。
