# 开工 prompt

在 `~/victory-calendar` 里用 Claude Code 开一个新会话，把下面整段粘进去。

---

在这个仓库里开始实现 "Victor's Picks"（双语湾区 tech 活动日历 + newsletter）。

先读三份文件：`README.md`、`PRD.md`（重点看第 5 节功能表、5b 策展后台、5c 候选收件箱、7 分类与"会去"状态、9b 视觉设计）、`IMPLEMENTATION_GUIDE.md` 全文。这两份文档是唯一事实源；两者冲突时以实现指南为准，并把冲突记进 `PROGRESS.md`。

已经定好的决策，不要再问：
- 代码就放在这个仓库，独立部署为一个 Vercel Hobby 项目；技术栈按指南"技术选型"表（Next.js 16.3.x App Router + next-intl + Neon/Drizzle + Better Auth passkey + Resend + Vercel Blob + AI SDK 经 AI Gateway），安装前用 `pnpm view <pkg> version` 核对最新补丁版，指南里的版本号是下限
- 不用 PO Box，邮件页脚不放邮寄地址，newsletter 保持非商业（无广告、无赞助）
- 候选收件箱 P0 走三条私密 iCal + skill 推送，不做 Google OAuth
- 视觉按 9b 执行：Fraunces + Geist + Noto Serif SC / Noto Sans SC 切片自托管，朱砂色只给 going 系统，模板封面不含日期和印章
- 周报周日 17:00–20:00 PT 发，两条 cron 幂等；里程碑日期以指南"分步实施计划"为准

开工前只问我这 4 个问题，问完就不要再停下来等：
1. 自定义域名用哪个（形如 `picks.<domain>`），我是否已经买了
2. 候选收件箱连哪个 Google 账号：个人 Gmail 还是 berkeley.edu
3. 产品名确认 "Victor's Picks · Victor 精选" 还是换
4. "会去"默认可见性：接受 PRD 第 7 节的默认规则，还是第一个月只显示"去过"

工作方式：
1. 按指南"分步实施计划"的里程碑推进，从 M0 第 1 周开始；每完成一周的清单就跑 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`，并在 `PROGRESS.md` 记录做了什么、下一步、阻塞项
2. 每个里程碑的门槛（G0–G3）逐条验证并写下结果，不通过不进下一个里程碑
3. 需要我亲手做的外部步骤（买域名、Vercel Marketplace 安装 Neon/Resend/Upstash、Resend 域名 DNS、复制 Google Calendar / Luma / Partiful 的私密 iCal 链接、安装 iOS 快捷指令）——整理成一份 checklist 放在 `PROGRESS.md` 顶部，用 `.env.example` 占位，先用 mock 或本地替代继续推进，不要卡住
4. 秘密只进 `.env.local` 和 Vercel env，任何 token、密钥、私密 iCal 地址都不进代码和文档
5. git：从 main 开分支，按里程碑命名（`m0-foundations`、`m1-public-site`…），小步提交；可以 push 到 feature branch，合并进 main 前问我
6. 先做看得见的东西：M0 一结束就用 20 条种子活动把首页跑起来，给我一个能在手机上看的预览链接，设计不对就先改设计
7. 遇到文档没写的决定，选最简单且可逆的方案，在 `PROGRESS.md` 的"待确认"里记一条，然后继续

第一步：读完文档后，先给我 M0 第 1 周的具体计划（要建的文件清单 + 要跑的命令），同时问上面 4 个问题，我回答后立即开始。
