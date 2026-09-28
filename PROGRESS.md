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

- 分支：`m0-foundations`
- 里程碑：M0 基础（到 2026-10-11），第 1 周进行中
- Vercel 项目：`victor-picks`（victory-c-8190s-projects），已连 GitHub，推送分支自动出预览
- 预览链接：每次推送 `m0-foundations` 自动生成；预览受 Vercel Authentication 保护，手机上需登录 Vercel 账号才能看

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

下一步：第 2 周 Better Auth、Resend、Upstash、Blob、CJK 字体切片，然后用 20 条种子活动把首页做出来。

阻塞：Neon、Resend、Upstash、Blob 需要你在 Marketplace 安装（checklist 第 2 项）；未装之前我用本地 Postgres 和 mock 继续。

## 门槛

| 门槛 | 条目 | 结果 |
|---|---|---|
| G0 | iPhone Face ID 与 Mac Touch ID 登录 /admin | 未验证 |
| G0 | DMARC、DKIM 验证通过 | 未验证（依赖域名） |
| G0 | pnpm test 与 Playwright 冒烟在预览分支通过 | 未验证 |

## 待确认（我先按最简单、可逆的方案做了）

- **没有数据库时用种子数据渲染公开站。** 这样在你装 Neon 之前预览链接也能看；装好后自动切到数据库。
- **生产用 neon-http 驱动。** 它不支持交互式事务，所以 digest 的 claim 行会写成单条 `INSERT … SELECT … RETURNING`。若 Better Auth 需要事务，第 2 周改用 Neon 的 WebSocket Pool。
- **Vercel 项目名 `victor-picks`**，预览域名随之而定。
- **React 保持 19.2.8**（create-next-app 为 Next 16.3.6 固定的版本；npm 上已有 19.3.0，但指南写的是 React 19.2）。**TypeScript 保持 5.x**（npm 最新 7.0.2，未确认 Next 16.3 的 typegen 支持）。**ESLint 保持 9**（create-next-app 的选择）。
- **本地 Node 26，CI 与 Vercel 用 Node 22**（指南要求 Node 22；`engines: 22.x`）。
- **`main` 分支只推了文档那一个 commit**，作为 PR 的基准；代码都在 feature 分支上。Vercel 对 `main` 的生产部署会因为没有代码而失败，合并 M0 后自然恢复。
- **预览部署保持 Vercel Authentication 保护**（没有改项目安全设置）。要让不登录 Vercel 的人也能看，需要你在项目 Settings → Deployment Protection 关掉，或等域名绑定后看生产站。

## 文档冲突记录（按实现指南执行）

1. **代码仓库**：指南写独立仓库 `victory-c/victor-picks`；你已决定放在本仓库 `victory-c/victory-calendar`。按你的决定。
2. **表数量**：指南写「十四张业务表」，但 SQL 实际列出 13 张。按 SQL 建 13 张。
3. **「想去」的显示**：指南「Going 状态安全规则」写「公开只显示描边印章」，指南组件表与 PRD §7、§9b 都写「不盖印章，只显示灰字」。按组件表与 PRD：只显示灰字。
4. **周报发送门槛**：PRD §8 写三个条件（含「PT 是周日」）；指南只判断 `status = 'scheduled' and send_after <= now()`。按指南。
5. **zh 日期格式**：指南代码片段用 `month: 'numeric'`，当前 ICU 输出是「10/7周三」，与指南和 PRD 写的「10月7日周三」不符。改用 `month: 'short'`，输出与 PRD F08 验收串一致。
6. **en 时间区间的空格**：ICU 在 en dash 两侧放的是细空格（U+2009），不是普通空格。按指南「统一用 Intl 的实际输出」保留。
7. **hreflang**：next-intl 默认在响应头里写 `hreflang="zh"`，PRD 要求 `zh-Hans`。关掉 next-intl 的 alternateLinks，由页面 metadata 输出 en、zh-Hans、x-default。
