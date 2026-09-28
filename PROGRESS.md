# PROGRESS · Victor's Picks · Victor 精选

Cross-session state. Read at session start, update before ending. Sources of truth: `PRD.md` and `IMPLEMENTATION_GUIDE.md`; on conflict the guide wins and the conflict is logged below.

## 你需要亲手做的外部步骤（checklist）

Secrets, tokens and private iCal URLs go only into `.env.local` or Vercel env. Never paste them into chat, code or docs.

| # | 步骤 | 何时需要 | 状态 |
|---|---|---|---|
| 1 | 买域名，决定 `picks.<domain>`（站点）和 `mail.<domain>`（Resend 发信）。买好后告诉我域名，我改 `PUBLIC_HOST` 并在 Vercel 绑定 | M1 结束前（大陆可达、Resend 发信的前置） | ⬜ 暂用 `*.vercel.app` |
| 2 | Vercel 控制台 → 项目 → Integrations/Marketplace：安装 **Neon**、**Resend**、**Upstash Redis**；Storage 页创建 **Blob** store 并连到项目。装完我跑 `vercel env pull` | M0 第 2 周 | ⬜ 未装时站点用种子数据 |
| 3 | Resend：添加 `mail.<domain>`，把它生成的 DKIM、SPF 记录加到 DNS，再加 DMARC `v=DMARC1; p=none; rua=mailto:<你的别名>` | 域名买好后 | ⬜ |
| 4 | Google Calendar（**berkeley.edu 账号**）：设置 → 选日历 → Integrate calendar → 看有没有「Secret address in iCal format」。Workspace 管理员可能隐藏了它：**没有就改用个人 Gmail 日历**并告诉我。有的话复制到 Vercel env `GCAL_SECRET_ICS_URL` | M2 第 11 周 | ⬜ |
| 5 | Google Calendar：Settings → Event settings → 「Add invitations to my calendar」设为 **From everyone**，否则 Luma 邀请不会进日历 | 同上 | ⬜ |
| 6 | Luma：Settings → Calendar Syncing → Add iCal Subscription，复制 URL 到 Vercel env `LUMA_PERSONAL_ICS_URL` | M2 第 11 周 | ⬜ |
| 7 | Partiful：桌面版 Calendar sync → Copy Link，存到 Vercel env `PARTIFUL_ICS_URL` | M2 第 11 周 | ⬜ |
| 8 | Vercel AI Gateway：团队设置里绑定支付方式（约 $0.5–2/月） | M2 第 7 周 | ⬜ |
| 9 | 在 Vercel env 设 `ADMIN_EMAIL`（后台唯一允许登录的邮箱）、`BETTER_AUTH_SECRET`、`CRON_SECRET`、`SUBSCRIBER_LINK_SECRET`（各用 `openssl rand -base64 32` 生成） | M0 第 2 周 | ⬜ |
| 10 | 首次登录 /admin/sign-in：用 magic link 登录，然后在 iPhone（Face ID）和 Mac（Touch ID）各注册一个 passkey（G0 门槛） | M0 第 2 周部署后 | ⬜ |
| 11 | 安装两个 iOS 快捷指令（Add to Picks、Add & Publish），我会给 iCloud 链接和令牌生成步骤 | M2 第 10 周 | ⬜ |

## 当前状态

- 分支：`m0-foundations`（M0 代码全部在这里，未合并进 `main`）
- 里程碑：M0 代码完成；G0 还差 3 条依赖外部步骤的条目（见「门槛」）
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

## 门槛

| 门槛 | 条目 | 结果 |
|---|---|---|
| G0 | iPhone Face ID 与 Mac Touch ID 登录 /admin | ⏳ 代码路径已验证：本地用 Chromium 虚拟认证器跑通 magic link → 注册 passkey → 退出 → passkey 登录。真机需要 Vercel 上有数据库和 env（checklist 2、9），然后你在两台设备上各做一次（checklist 10） |
| G0 | DMARC、DKIM 验证通过 | ⏳ 依赖域名（checklist 1、3） |
| G0 | pnpm test 与 Playwright 冒烟在预览分支通过 | ✅ `m0-foundations` 的 GitHub Actions：typecheck、lint、Vitest、build、Playwright 全绿；该分支的 Vercel 预览构建 READY |

G0 结论：本地能验证的全部通过，剩下两条只差外部步骤。M1 的工作不碰鉴权和发信，所以我在等外部步骤的同时继续 M1，G0 这两条补验后再记结果。

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
