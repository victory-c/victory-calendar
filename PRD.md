# Tech 活动推荐日历 + Newsletter · PRD

2026-09-27 · Victor Chun

一个由 Victor 亲自筛选的 tech 活动日历：访客可以按类别（黑客松、Talk、Workshop 等）浏览，也可以订阅每周 newsletter 或日历（iCal）接收推荐，还能看到 Victor 自己要去哪些活动。全站中英双语。

## 1. 背景与机会

湾区每周有上百场 tech 活动，但没有一个渠道同时提供“一个人的筛选、他自己要去哪、按兴趣订阅、中英双语”这四件事。Victor 已经每周用 weekly-events skill 把 Luma、Gmail、Google Calendar 和网页搜索过一遍写进 Notion，这份私人笔记只有他自己在用。把它变成公开产品，缺的只是一个后台和一个漂亮的站点。

现有渠道各有一个结构性缺口：

| 渠道 | 问题 |
|---|---|
| Luma | 只能关注日历，不能关注人；城市订阅是全平台推送，不经筛选；日历 newsletter 只能按管理员打的 tag 发，订阅者不能自选兴趣 [Discovering Events](https://help.luma.com/p/discovering-events) [Sending Newsletters](https://help.luma.com/p/sending-newsletters) |
| Roundup newsletter | Bay Area Founders Club 一期 42 条编号链接，没有理由、分类和筛选 [BFC](https://bayareafoundersclub.substack.com/p/this-week-in-the-bay-area-42-curated)；Founders Bay 按城市分版，但不按兴趣 [Founders Bay](https://newsletter.foundersbay.com/p/new-post-a2f2) |
| 微信群与公众号 | 中文活动靠群聊和单场推广，硅谷101 记录同一晚有六场华人活动撞车 [硅谷101](https://news.qq.com/rain/a/20241101A04L8100)；GPTDAO 的中文周报 2024 年 9 月停更 [GPTDAO](https://gptdao.ai/zh/articles/2024/08/Aug26-2024-weekly-ai-event.html) |
| 聚合站 | Hidden Events 声称跟踪 999 个日历、448 场活动，说明“全”已经是廉价商品 [Hidden Events](https://hiddenevents.online/sf) |

Plancast 在 2012 年关停，原因是多数人不提前公开自己的计划 [Plancast 复盘](https://techcrunch.com/2012/01/22/post-mortem-for-plancast/)。所以“Victor 会去”必须是策展人的单向信任信号，而不是社交功能。机会在于：个人观点 + 出席状态 + 分类订阅（邮件和 iCal）+ 中英内容 + 东湾和伯克利学生视角。

## 2. 目标、非目标与成功指标

MVP 要证明三件事：Victor 每周能在 45 分钟内（含手机上）发出 8 到 15 条精选；访客会对精选采取行动（加日历、点 RSVP、订阅 iCal）；中文读者占比至少 30%。MVP 覆盖 M0 到 M3，也就是到 newsletter 软上线为止，因为后两件事没有订阅者无法证明。

### 目标
- 策展效率：手机分享到草稿 ≤6 秒 p50，每周策展 ≤45 分钟。
- 访客行动：北极星指标是“每周被采取行动的精选”，等于加日历点击 + 外链 RSVP 点击 + iCal 订阅开始。
- 双语：每个公开页面、每封邮件、每个 iCal 源都有 en 和 zh 版本。
- 信任：出席状态受安全规则约束，可一键全部隐藏。

### 非目标
- 不做社交网络，不让访客晒自己的计划。
- 不做全量聚合，不和 Hidden Events 比“全”。
- 不存平台的活动描述，只存事实、链接和 Victor 自己的文字。
- MVP 不做赞助位、付费层和微信公众号。

### 成功指标

| 指标 | 目标值（目标，估算） | 时间点 |
|---|---|---|
| 每周被采取行动的精选 | 150 次/周，之后 600 次/周 | 2027-02-28，2027-05-31 |
| 确认订阅者 | 300，之后 1000（zh ≥30%） | 2027-02-28，2027-05-31 |
| 双重确认率 | ≥60% | 软上线起 |
| 每周发布精选 | 8 到 15 条，≥40% 带公开实心印章（会去、主办、分享） | M2 起 |
| iCal 订阅（代理指标） | 每周抓取 /calendar.ics 或 going.ics 的不同 (IP 哈希, User-Agent) 组合数 ≥100 | 2027-02-28 |
| 邮件健康 | 退订 ≤0.5%/次，退信 ≤2%，投诉 <0.1% | 每次发送 |
| 周报可靠性 | 0 次漏发周日周报 | M3 起 |
| 页面质量 | LCP ≤2.5 s，CLS ≤0.1，Lighthouse a11y ≥95（两种语言） | M1 起 |
| 来自收件箱或 skill 的精选占比 | ≥50% | 2027-02-28 |
| 运行成本 | ≤$40/月（非商业；商业化后加 Vercel Pro $20） | 全程 |

## 3. 目标用户与场景

订阅者是湾区 tech 圈里“想去但没时间筛”的人，Victor 是唯一的策展人，也是后台的唯一用户。

| 画像 | 场景 | 需要什么 |
|---|---|---|
| 伯克利、斯坦福学生（含中文学生） | 周末刷手机决定下周去哪，预算有限 | 免费和学生友好标记，东湾距离，中文说明 |
| 早期创始人、找工作的工程师 | 想去 demo、hackathon 认识人 | 黑客松和 AI 两类订阅，apply 或 waitlist 提示 |
| 中文创始人、刚到湾区的人 | 微信群信息碎片，不想读英文长邮件 | 中文周报，活动语言筛选，iCal 而不是 Google Calendar |
| 关注 Victor 的朋友 | 想知道他要去哪、能不能碰面 | “会去”印章和 going.ics |
| 线上参与者（非湾区） | 只看 online 活动 | online 筛选（P1 可订阅） |

### Victor 的四个场景
1. 手机分享：在 Luma app 看到活动，分享给“Add to Picks”，跳过点评时 6 秒内存为草稿，口述一句点评约 25 秒。
2. 桌面润色：晚上打开后台 Drafts，逐条确认自动翻译、分类和封面，每条 1 到 2 分钟发布。
3. 周日发报：10 分钟写引言、看一遍自动组装的周报、排期发送，再导出微信文字。
4. 候选收件箱：周中打开 Inbox，日历和 Luma 报名自动汇总，勾选要发布的，单独标记要去的。

## 4. 竞品与可借鉴点

没有一个现有产品同时做到策展人出席状态、订阅者自选类别、完整中英内容和东湾视角，这就是定位空间。

| 产品 | 做什么 | 订阅与筛选 | 双语 | 我们借鉴 |
|---|---|---|---|---|
| [Luma 城市页](https://luma.com/sf) | 平台，城市 Discover 页，任意日历可 iCal 订阅 | 关注日历不关注人；城市周报周日晚发；newsletter 只能按管理员 tag [iCal Syncing](https://help.luma.com/p/ical-syncing) | UI 有 zh locale，内容随主办方 | 一键 iCal 订阅，周日晚发送时段，方形封面 |
| [Cerebral Valley](https://cerebralvalley.ai/events) | AI 活动站加 beehiiv 周报 | 站内按城市和类型（CV 活动、黑客松）筛选，与邮件偏好不联动 | 否 | 黑客松开关，每条一句“为什么”，日期徽章列表 |
| [Partiful](https://partiful.com/featuring-your-event-on-explore) | 社交邀请，Explore 精选流 | 关注主办方 Org Profile，“朋友要去”是社交信号 | 否 | “会去”作为一个人的信任信号；数据模型支持 Partiful 链接 |
| [AI Tinkerers](https://aitinkerers.org/) | 审核制 demo 社区，263 城 | 每城独立邮件偏好页 | 否 | 每订阅者偏好页；apply 或 screened 标记 |
| [Bay Area Founders Club](https://bayareafoundersclub.substack.com/p/this-week-in-the-bay-area-42-curated) | Substack 周报，116k+ 订阅 | 无分类无筛选，42 条编号链接 | 否 | 反例：只有链接没有理由 |
| [Founders Bay](https://newsletter.foundersbay.com/p/new-post-a2f2) | beehiiv 周报，SF、NYC、Global 分版 | 订阅时勾选城市版 | 否 | 策展人第一人称的声音；分版订阅思路 |
| [Gary's Guide](https://www.garysguide.com/press) | 2008 年起从个人清单长成目录 | 周报按 NYC 或 SF 选 | 否 | 图例（策展人推荐、热门、赞助）和价格字段；版式是反例 |
| [SF IRL](https://sfirl.beehiiv.com/p/sf-irl-nov-17th-2025) 与 [Eddie's List](https://www.eddies-list.com/about) | 一人策展周报，9k 与 29k 订阅 | 无筛选；Eddie 靠读者付费、无广告 | 否 | 投稿表单，“无付费植入”披露，两分钟读完 |
| [Hidden Events](https://hiddenevents.online/sf) | 非官方 Luma 聚合，17 类筛选，WhatsApp 摘要 | 站内筛选，邮件解锁 | 否 | 分类词表，群聊摘要（我们用微信） |
| [GPTDAO 周报](https://gptdao.ai/zh/articles/2024/08/Aug26-2024-weekly-ai-event.html) | 中文湾区 AI 活动周报，2024-09 停更 | 无 | 是 | 英文活动名保留原文，只翻译说明 |
| [湾区人文](https://bayareahuman.org/) | 双语华人文化活动日历，可订阅 | 日历订阅 | 是 | 双语日历模式可行；可交叉推广 |

定位一句话：“Victor 精选：一个双语湾区 tech 活动日历，看得到我要去哪，只订阅你关心的。”

## 5. 功能需求（P0 / P1 / P2）

P0 是 16 项，覆盖公开站、订阅、后台、手机快速添加、封面和候选收件箱；P1 补中文渠道、Gmail 源和封面的外部图源；P2 是可选的 OAuth、MCP 和 Luma 镜像。

| ID | 功能 | 优先级 | 说明 | 验收标准 |
|---|---|---|---|---|
| F01 | 活动数据模型与发布 | P0 | 草稿、已发布、已取消、归档四态；双语字段；7 分类；facets；会去 + 可见性 | 后台发布后 5 秒内出现在首页、详情、日历，RSS 与 iCal 在 15 分钟缓存内更新；取消显示删除线并在 feed 里标 CANCELLED |
| F02 | 本周精选列表页 | P0 | 按天分组、精选横滑 rail、“Victor 会去”条、URL 类别芯片 | 390 px 与 1280 px 无横向滚动；芯片带 aria-pressed；LCP ≤2.5 s p75 |
| F03 | 活动详情页 | P0 | 1:1 封面、双语标题、时间、城市、价格与报名芯片、点评、印章、RSVP、加日历、封面署名 | JSON-LD 只含事实和官方链接；hreflang 三项；address_public=false 时不渲染地址 |
| F04 | 月历与周视图 | P0 | 自研月格（类别点）与周条，手机改议程 | 键盘可用；格子 ≥24 px（手机 44 px）；zh 与 en 周标签由 Intl 生成 |
| F05 | 分类 iCal 订阅 | P0 | /calendar.ics 按类别与语言，going.ics，单活动 .ics，webcal、Google、Outlook 按钮 | VTIMEZONE 正确；Apple Calendar 订阅后本地时间正确；REFRESH-INTERVAL PT1H |
| F06 | 分类订阅 newsletter | P0 | 7 类芯片 + 语言，双重确认，偏好中心，RFC 8058 一键退订（会去提醒见 F20） | 只选黑客松和 AI 的人只收这两节；无 cookie 的退订 POST 返回 200 并即时生效；退信和投诉自动抑制 |
| F07 | 周日精选邮件 | P0 | 周报编辑器；周日 17:00 到 20:00 PT 之间发出（两条每日 cron 01:00 与 02:00 UTC，Hobby 精度 ±59 分）；按语言与类别组合渲染；幂等 | 同一周日两条 cron 先后触发只发一封；HTML ≤90 KB；Gmail、Apple Mail、Outlook、qq.com、163.com 可读 |
| F08 | 双语路由与文案 | P0 | / 与 /zh，LangSwitch 保留路径，Intl 日期 | 每个公开路由两种语言可达；html lang 正确；zh 页显示“10月7日周三 18:30–20:00 北美太平洋时间” |
| F09 | 专属后台 PWA | P0 | passkey 登录，可安装，Inbox、Add、Drafts、Live、More 五个 tab，复用公开站 token | iPhone Face ID 与 Mac Touch ID 可登录；会话 30 天；未登录访问 /admin 返回 401 或跳转 |
| F10 | 链接自动填充 | P0 | POST /api/ingest：规范化、去重、安全抓取、Luma、Partiful、Eventbrite、Meetup 适配器加通用路径，LLM 填充 | 10 个固定页面样本字段正确；私密 Partiful 页返回草稿 needs_manual；重复 URL 返回 409 |
| F11 | 封面自动获取与回退链 | P0 | P0：官方封面、主办方合成、排版模板自动，相册上传与粘贴 URL 手动；P1（M4）：Openverse、AI 生成、Brave 建议 | 录入 15 秒内有封面；手机 Publish now 时先同步生成模板封面；Luma 不用 800×420 社交图；换封面时删旧文件 |
| F12 | 手机快速添加 | P0 | iOS 快捷指令，Android share_target，剪贴板；个人 token 可撤销 | Luma app 分享到草稿 ≤6 秒 p50（20 次测量）；Publish now 后 ≤10 秒可见；撤销 token 后下次调用 401 |
| F13 | 我去不去（Going） | P0 | 状态 + 可见性；实心印章只给会去、主办、分享、去过，想去只显示灰字；/going 与去过档案；going.ics；周报专节；后台总开关（数据库设置行） | 骑行或私人场地自动降级为 after_event 并说明原因；总开关切换后站点与 /going 5 秒内清空印章，going.ics 最长 15 分钟（CDN 缓存） |
| F14 | 设计系统 | P0 | tokens，切片 CJK 字体，核心组件，明暗主题，动效 | 文字对比 ≥4.5:1，芯片 ≥3:1；CLS ≤0.1；首屏字体 en ≤120 KB、zh ≤300 KB（估算）；reduced-motion 关闭全部动画 |
| F15 | 候选收件箱 | P0 | 三个私密 iCal 源 + skill 推送，去重，勾选发布 + 独立会去，稍后与忽略 | 已发布活动显示“已添加”；勾 6 行生成 6 条草稿；忽略隐藏 90 天；候选绝不公开 |
| F16 | 合规与隐私页 | P0 | 双语 /privacy，诚实主题，同意日志，SPF、DKIM、DMARC，默认不追踪 | 每封周报含可见退订链接和 List-Unsubscribe 头；首发 DMARC 对齐 100% |
| F17 | 微信长图与文字导出 | P1 | 1080 px 中文长图，编号纯文本，无链接无二维码的小红书封面 | ≤3 次点击完成复制与下载；小红书导出不含 URL 和二维码 |
| F18 | Gmail 转发候选源 | P1 | Gmail 过滤器转发到 Resend 收件地址，解析 .ics、JSON-LD、链接；roundup 折叠为一行 | 转发的 Luma 确认邮件 2 分钟内成为候选；只存 ≤300 字摘要 |
| F19 | 活动语言与线上偏好 | P1 | event_language 与 online 成为邮件和 iCal 偏好 | 选“中文活动”只收 zh 活动；ICS 参数 ev_lang=zh 生效 |
| F20 | 会去即时提醒 | P1 | Victor 标记公开会去时可选提醒，每天最多 1 封 | 一天两次标记合并成一封；遵守退订与可见性 |
| F21 | Google OAuth 同步 | P2 | calendar.events.readonly + gmail.readonly，加密 refresh token，可断开 | 30 天后 token 仍有效；RSVP 状态显示在收件箱但不设置公开会去 |
| F22 | MCP 与对话式添加 | P2 | add_event、list_drafts、publish、set_going 工具；后台 Ask 框 | Claude Code 里一句话加 3 个链接生成 3 条草稿；publish 需 passkey 会话或 publish 权限 token |
| F23 | Luma 镜像日历 | P2 | 发布的精选推送到 Victor's Picks Luma 日历（需 Luma Plus） | 每次发布创建或更新一次；下架时删除 |

## 5b. 策展后台：链接 + 活动名 + 点评即可发布

后台只有 Victor 一个用户，用 passkey 登录，手机和桌面都能用；添加一条活动只需要链接、活动名和点评三项，其余字段从链接自动填好、发布前可改。

### 谁能用
- 唯一账号：Victor 的邮箱白名单，magic link 首次登录后改用 passkey（iPhone Face ID、Mac Touch ID），30 天滚动会话。
- 个人 token：给 iOS 快捷指令和 weekly-events skill 用，显示最后使用时间，可撤销，不能读订阅者。
- /admin 和 /api 不在公开站点的语言路由内，未登录一律 401 或跳转。

### 添加活动表单

| 字段 | 必填或自动 | 来源 | 可编辑 |
|---|---|---|---|
| 活动链接（Luma、Partiful；Eventbrite、Meetup 可选） | 必填 | Victor | 是 |
| 活动名 | 必填，自动预填 | 页面 JSON-LD 或 og:title，Victor 可覆盖 | 是 |
| Victor 点评（zh 或 en 任一） | 发布必填，草稿可空 | Victor 打字或口述 | 是 |
| 另一语言的活动名、点评、摘要 | 自动 | LLM 起草并标记 auto，逐字段一键批准 | 是 |
| 开始、结束时间、时区 | 自动 | 页面 JSON-LD 或内嵌数据 | 是 |
| 场地名、城市、街区、地址 | 自动 | 页面数据；地址默认不公开；可勾选“私人场地” | 是 |
| 价格、报名方式（open、apply、waitlist、sold_out） | 自动 | 页面数据 + LLM | 是 |
| 类别（7 选 1）+ 置信度 | 自动 | LLM，Luma 自带分类作提示 | 是 |
| 活动语言、形式（线下、线上、混合）、主办方 | 自动 | 页面数据 + LLM | 是 |
| 封面图 | 自动 | 回退链（见下） | 是 |
| 会去状态 + 可见性 | 默认 想去 与 公开 | Victor | 是 |
| 置顶（featured）、话题标签 | 可选 | Victor，标签由 LLM 建议 | 是 |

### 预览卡片与发布校验
自动填充完成后（2 到 4 秒）后台显示一张和公开站完全相同的 EventCard：封面、时间列、双语标题、地点价格一行、类别芯片（含置信度）、点评块、印章。发布校验要求活动名、开始时间、来源链接、类别、至少一种语言的点评和一张封面；缺任何一项保持草稿并显示原因。

手机选 Publish now 时，服务端先同步生成排版模板封面（next/og，约 0.5 秒）作为当前封面再校验发布，随后后台任务找到官方封面且封面策略为官方时自动替换，所以封面这一项总能通过；未填点评则存为草稿并在通知里写明原因。Publish now 时自动译文视为已确认，可事后重译；桌面发布前逐字段批准。

### 封面图自动获取
封面按下面顺序自动尝试，前三步在录入后约 15 秒内完成，所以每条活动一定有封面：
1. 官方封面。Luma 取原始上传图或 JSON-LD 图片，不取 800×420 的社交分享图；Partiful 取海报；Eventbrite 和 Meetup 取 JSON-LD 图片；其他站点取 og:image。Luma 和 Partiful 都要求主办方上传 1:1 封面，裁方形是安全的 [Luma 封面规范](https://help.luma.com/p/event-cover-images) [Partiful 封面规范](https://help.partiful.com/en-us/articles/15525294-are-there-cover-image-guidelines)。
2. 主办方合成。主办方或日历头像放在类别色模板上。
3. 排版模板。不含日期也不含印章：1200² 画面 = 类别色场（12% 色相底加同色相实色大块）+ 占画面约 55% 的类别字（ai → AI、hackathon → 黑、vc → 投、campus → 校、conference → 会、cycling → 骑、social → 聚，Noto Serif SC 600 或 Fraunces）+ 底部主办方名一行（高度约 6%）；中英标题与日期只出现在 1200×630 的 OG 版本。确定性生成，永远可用；自动发布到此为止。

Victor 需要手动选的情况只有一种：他对模板不满意。封面选择器在 P0 提供相册上传和粘贴图片 URL；P1（M4）加入 Openverse（只用 cc0、by、by-sa 许可，自动存署名）、AI 生成抽象封面（无文字、无人物、无 logo）和 Brave 图片搜索建议（只建议，不自动用）。图片一律复制到自己的存储，不热链；替换封面后旧文件删除。

版权规则：事实自由，封面是第三方表达。官方封面尺寸不超过 1600²，卡片下方标注“Cover: 主办方 via 平台”并链接官方页，/privacy 提供 24 小时下架通道；Luma 条款禁止把它的图片作为独立文件转载，所以周报里 Luma 来源的活动默认用模板封面 [Luma Terms](https://luma.com/terms)。

### 添加一条活动的目标时间

| 步骤 | 目标 |
|---|---|
| 分享到草稿保存（无点评） | ≤6 秒 p50，≤10 秒 p95 |
| 含口述点评 | ≤25 秒 |
| 桌面润色到发布 | 每条 1 到 2 分钟 |
| 发布到公开站可见 | 约 2 秒（手机 Publish now 含模板封面生成 ≤10 秒），iCal 缓存 15 分钟内 |

### 手机快速添加（P0）
iPhone 上唯一的分享菜单路线是 iOS 快捷指令，因为 iOS Safari 不支持 Web Share Target [MDN 兼容性数据](https://unpkg.com/@mdn/browser-compat-data/data.json)；Android 用已安装 PWA 的 share_target；两者都能退回到“粘贴链接”。
1. 在 Luma app、Safari、iMessage 里点分享，选“Add to Picks”（快捷指令，接受 URL 与 Safari 网页）。微信内先“在 Safari 打开”再分享，或复制链接后在 PWA 的 Add 页点“从剪贴板粘贴”。
2. 快捷指令弹出“点评？”，可口述一句中文或英文，也可跳过。
3. 选“草稿”或“立即发布”。
4. 快捷指令把链接、点评、模式 POST 到 /api/ingest，用存在指令里的个人 token 认证 [Apple 快捷指令指南](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-another-app-apd163eb9f95/ios)。
5. 收到通知“已保存 · 标题 · 10月7日周三 18:30 · AI (0.91) · 封面：官方”，点“打开”进入编辑页。页面私密或不支持时返回 202 并保存最小草稿，分享永不丢失。

手机上必须能做的事：链接 + 点评 + 草稿或发布 + 会去开关 + 批准自动翻译 + 从回退链里选封面。双语并排润色、facets、置顶和周报编辑留到桌面。

后台移动端规则：复用公开站的全部设计 token，预览卡就是公开站的 EventCard；Add、编辑器和收件箱多选态隐藏底部 tab 栏，只保留一条操作栏（44 px 目标，避开 iOS 底部安全区，键盘弹出时随之上移）；每屏一个主操作；passkey 保持登录；Add 页 JS ≤100 KB。

## 5c. 候选收件箱：Google Calendar 与 Gmail 汇总勾选

候选收件箱把 Victor 日历上和邮箱里“本周收到的活动”自动汇总成清单，勾选即进入与手动粘贴相同的自动填充和封面流程；日历部分 P0 上线，邮箱部分 P1（M4），Google OAuth 推迟到 P2。

### 收集什么、从哪来

| 来源 | 内容 | 接入方式 | 优先级 |
|---|---|---|---|
| Google Calendar | 未来 14 天的日历条目，含落到日历上的 Luma 邀请 | 日历的“iCal 格式的私密地址”，服务端直接抓取 [Google 日历同步](https://support.google.com/calendar/answer/37648) | P0 |
| Luma 个人日历 | 他报名的全部活动（approved、waitlisted、pending） | Luma 个人 iCal 订阅链接 [iCal Syncing](https://help.luma.com/p/ical-syncing) | P0 |
| Partiful 个人日历 | 他被邀请或已回复的活动 | Partiful 个人日历链接 [Partiful 同步](https://help.partiful.com/hc/en-us/articles/15525660-sync-to-google-calendar) | P0 |
| weekly-events skill | 每周筛出的候选和它的一句理由 | skill 最后一步 POST 到 /api/ingest（candidate 模式） | P0 |
| Gmail | Luma、Partiful、Eventbrite、Meetup 的邀请和确认邮件，roundup newsletter | Gmail 过滤器“转发”到 Resend 收件地址，webhook 解析 .ics、EventReservation 标记和链接 [Gmail 转发](https://support.google.com/mail/answer/10957) [Resend 收件](https://resend.com/docs/dashboard/receiving/introduction) | P1 |
| Google OAuth | RSVP 状态（accepted、needsAction） | calendar.events.readonly + gmail.readonly | P2 |

### 为什么选这条路线
私密 iCal 地址和 Gmail 转发都不需要 OAuth 同意屏，Google 也就不需要审核这个应用。Gmail 的 readonly 和 metadata 都是 restricted scope，metadata 还不能用 q 过滤发件人 [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)；读日历事件是 sensitive scope [sensitive scope 说明](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)。Google 对“只有开发者自己用”的应用豁免审核，但这依赖把同意屏发布为 In production 却不提交审核，并在未验证警告上点“继续” [未验证应用](https://support.google.com/cloud/answer/7454865)；项目若留在 Testing 状态，refresh token 每 7 天过期 [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)。

所以 OAuth 只在需要 RSVP 精度时做（P2），且用个人 Gmail 而不是 berkeley.edu，因为 Workspace 管理员可以屏蔽未验证应用和私密地址。设置提醒：Google Calendar 的“将邀请添加到我的日历”要设为“来自所有人”，否则 Luma 邀请只存在于 Gmail 里 [管理邀请](https://support.google.com/calendar/answer/13159188?hl=en&co=GENIE.Platform%3DDesktop)。

### 一行候选显示什么
标题、日期时间、场地城市、来源芯片（Calendar、Luma、Partiful、Mail、Skill）、日历 RSVP 状态（灰字，已知时）、提取出的链接、匹配到已发布活动时的“已添加”链接、发布勾选框、会去控件、稍后与忽略。会去控件在手机上是一个点按循环的印章按钮（— → 想去 → 会去），分段控件只在桌面与详情 sheet 出现，避免和行的横向滑动冲突。同一活动的多次出现按平台 id、iCalUID、“标题 + 15 分钟取整时间 + 城市”三级合并为一行；一封邮件提取到 5 个以上平台链接时视为 roundup，折叠为一行“Newsletter · 发件人 · N 个新链接”，展开后逐条勾选，每封最多 50 条（P1）。

### 勾选发布与标记会去是两个独立动作
- 勾选 N 行后点“添加所选”，每行走一遍 ingest 和封面流程，默认成草稿，可切换“直接发布”。
- 会去控件只设置活动的出席状态，不依赖是否发布；日历上有不等于会去。
- 忽略隐藏 90 天；稍后可选明天或下周；活动结束 7 天后自动过期。

### 同步频率
打开 /admin/inbox 时按需拉取（3 个源约 1 到 3 秒，10 分钟冷却），加每日一次定时同步，因为 Vercel Hobby 的定时任务每天最多一次 [Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)。skill 推送和邮件转发是事件驱动。

### 隐私规则
邮箱和日历里的任何内容在 Victor 勾选之前都不公开：候选不进 feed、不进周报、不进 sitemap。只存来源 id、标题、起止时间、地点字符串、提取的 URL、RSVP 状态和 ≤300 字摘要，绝不存邮件正文；日志里邮箱脱敏；设置页有“清空收件箱数据”按钮。转发到 Resend 的邮件在 Resend 侧保留 30 天（Free 档），因此只转发过滤器命中的平台与 roundup 发件人，永不开全局转发。

### 优先级与理由
P0-lite。Victor 要的“日历上的活动汇总勾选”用三个私密 iCal 源加 skill 推送就能在 MVP 交付，成本低、无审核风险。邮箱那一半需要先在 Resend 开通 Receiving 并完成 Gmail 转发地址验证，托管地址 <alias>@<id>.resend.app 不需要域名或 DNS；放 P1（M4）是为了先把三条 iCal 源与去重跑稳，webhook 验签和邮件解析器的工作量留到那时。OAuth 带来的只有 RSVP 状态这一项增量，放 P2。

桌面版三栏（筛选、按天分组列表、预览），键盘 E 添加、X 忽略、H 稍后、G 切换会去，参考 Readwise Reader 的 Inbox 分流 [Readwise](https://docs.readwise.io/reader/guides/workflows/library-configuration)；手机单列，右滑添加、左滑忽略、长按稍后，行内印章按钮点按切换会去。

## 6. 关键用户流程

两条主线只在“发布”这一点相交：访客只接触公开产物，策展人的三个入口（后台 Add 页、手机分享、候选收件箱）全部汇入同一个 /api/ingest 管道。

> 图见 Claude 文档中的交互式图表；下面是图的内容规格。

```text
Title: 三个策展入口汇入同一条发布管道，访客只与公开产物交互

Layout hint: 四条水平泳道，从上到下：访客、公开产物、系统管道、策展人 Victor；时间从左到右；S1 /api/ingest 作为汇合点放大居中；候选来源作为一个小容器挂在 C3 左侧。

Lane 访客:
- V1 看到入口 (body: 站点 / 微信群 / 小红书)
- V2 选类别与语言 (body: 7 类芯片, EN 或 中文)
- V3 提交订阅表单 (body: BotID + 蜜罐, 双重确认)
- V4 点邮件确认
- V5 收周报或 iCal 更新 (body: 周日 17:00–20:00 PT, iCal 1 小时刷新)
- V6 点 RSVP 或加日历 (body: 跳官方页面, 北极星指标)
- V7 偏好中心或一键退订

Lane 公开产物:
- P1 站点 / 与 /zh (body: 本周精选, 详情, 月历)
- P2 iCal feeds (body: 按类别, going.ics)
- P3 周报邮件 (body: 语言 × 类别 变体)
- P4 /going 页面 (body: 受后台总开关控制)

Lane 系统管道:
- S1 POST /api/ingest (body: 规范化 + 去重, 抓取 + LLM 填充)
- S2 封面回退链 (body: 官方 → 主办方 → 模板, 约 15 秒)
- S3 草稿 (body: auto 字段待批准)
- S4 发布 (body: 校验 6 项, 约 2 秒生效)
- S5 周日 cron 发送 (body: 两条 cron 幂等, Resend 批量)

Lane 策展人 Victor:
- C1 后台 Add 页（桌面或手机） (body: 粘贴链接 + 活动名 + 点评)
- C2 手机分享 (body: iOS 快捷指令, ≤6 秒到草稿)
- C3 候选收件箱勾选 (body: 勾选发布, 单独标记会去)
- C4 润色草稿 (body: 批准翻译, 封面, 会去)
- C5 周日周报编辑 (body: 写引言, 约 10 分钟)

Container 候选来源 (attached left of C3): Google Calendar 私密 iCal; Luma 个人 iCal; Partiful 日历; weekly-events skill; Gmail 转发 (P1)

Edges:
- V1 -> V2
- V2 -> V3
- V3 -> V4 (label: 确认邮件)
- V4 -> V5
- P3 -> V5
- P2 -> V5
- P1 -> V6
- V5 -> V6
- V5 -> V7
- 候选来源 -> C3
- C1 -> S1 (label: 会话)
- C2 -> S1 (label: Bearer token)
- C3 -> S1 (label: 添加所选)
- S1 -> S2
- S1 -> S3
- S2 -> S3 (label: 封面就绪)
- S3 -> C4
- C4 -> S4 (label: 发布)
- S1 -> S4 (label: 立即发布, 先出模板封面)
- S4 -> P1
- S4 -> P2
- S4 -> P4
- C5 -> S5
- S4 -> S5 (label: 本周已发布活动)
- S5 -> P3
```

图里上两条泳道是访客从看到站点、订阅、收周报到点 RSVP 的闭环，下两条泳道是 Victor 三个入口经同一管道产出草稿，封面就绪后发布，同时落到站点、iCal 和周报。

## 7. 活动分类与内容模型

分类固定为 7 个，邮件和 iCal 订阅只按分类；出席状态 6 种，其中“去过”是派生的，不由 Victor 手动设置。

### 分类

| slug | 中文 | English | 说明 |
|---|---|---|---|
| ai | AI 与技术 | AI & Tech | AI、ML 与开发者 talk、demo、workshop、研究沙龙、meetup |
| hackathon | 黑客松 | Hackathons | 黑客松、buildathon、比赛、demo day；报名芯片显示 apply 或 screened |
| vc | 创投与创业者 | VC & Founders | pitch night、fireside chat、投资人 office hours、创始人晚餐、融资分享 |
| campus | 校园创业 | Campus & Student Startup | 伯克利、斯坦福、SCET 与学生社团活动，fellowship 和项目宣讲 |
| conference | 大会与主题周 | Conferences & Tech Weeks | 多日或大型活动：SF Tech Week、Assembling、Alignment 2026、GenAI Summit，通常售票 |
| cycling | 骑行活动 | Cycling | 有报名的正式骑行（gran fondo、俱乐部活动、车展）；非正式 group ride 不收录，出席永不显示 |
| social | 社交与玩乐 | Social & Fun | mixer、happy hour、coffee rave、华人社群聚会与文化活动 |

### 次级标签
每条活动还带 7 个 facet：活动语言（en、zh、bilingual）、形式（线下、线上、混合）、区域（sf、east_bay、peninsula、south_bay、north_bay、online）、报名方式、价格、话题标签（LLM 建议、Victor 批准）和置顶。规则：P0 的订阅只按分类，facet 只做站内筛选和芯片，P1 起活动语言和线上才成为邮件与 iCal 偏好。

### “Victor 会去”状态

| 状态 | 中文 | English | 公开规则 |
|---|---|---|---|
| interested | 想去 | Interested | 每条新活动的默认值；公开页只在元信息行显示灰字“想去 / Interested”，不盖印章，不带到场时间信号；可见性设为 hidden 时连灰字也不显示 |
| going | 会去 | Going | 只有同时满足以下条件才公开显示实心印章：活动公开且在 Luma、Partiful、Eventbrite、Meetup 之一上；线下非私人场地或线上；类别不是骑行；可见性为 public。否则后台自动降级为 after_event 并说明原因；周报只说“计划去”，不说时间 |
| hosting | 主办 | Hosting | 默认公开（场地已经通过主办页公开），实心印章；仍受可见性和总开关约束 |
| speaking | 分享 | Speaking | 默认公开，实心印章；约束同主办 |
| went | 去过 | Went | 派生：活动结束后，可见性为 public 或 after_event 的会去、主办、分享在 /going 档案和卡片上显示为去过印章；骑行永不显示 |
| none | 不显示 | None | 无徽章，不进 /going 和 going.ics。总开关在 /admin/settings，是数据库设置行而不是环境变量：切换后站点与 /going 页 5 秒内隐藏全部印章，going.ics 最长 15 分钟（CDN 缓存）；环境变量 SHOW_ATTENDANCE 只作部署期的强制覆盖，改动需重新部署 |

私人场地的判定，满足任一即算：Luma 页面把地址设为报名后可见；页面只有街道地址没有场地名；地址含 Apt、Unit 或 #；Victor 在编辑器勾选“私人场地”。重复性活动 = 同一 host 与同一场地 4 周内出现 ≥2 次，由系统按 host_url + venue_name 判定；重复性活动的会去只在结束后以“去过”出现。

公开页面只显示城市或街区，街道地址放在官方链接后面；这条规则参考 Luma 的“仅对审核通过的访客显示地址”和 Strava 隐藏起终点的做法 [Luma 隐藏地点](https://help.luma.com/p/hiding-your-event-location) [Strava 地图可见性](https://support.strava.com/hc/en-us/articles/115000173384-Edit-Map-Visibility)。

### 活动核心字段
- 标识与状态：id、slug、status（draft、published、cancelled、archived）、created_via（admin、shortcut、share_target、skill、inbox）、发布时间。
- 双语文字：title_en、title_zh、summary_en、summary_zh（≤2 句，Victor 的口吻，绝不是主办方原文）、note_en、note_zh（Victor 的点评）；官方活动名无需翻译时 title_zh 与 title_en 相同。
- 时间：start_at、end_at（UTC）、tz（IANA）、all_day。
- 地点：venue_name、city、neighborhood、address（私密）、address_public（默认 false）、private_venue（Victor 勾选）、format。
- 分类与 facet：category、category_confidence、tags、event_language、price_text、access、featured。
- 来源：host_name、host_url、source_url（唯一对外链接）、event_sources（平台 + 外部 id，去重键）。
- 出席：going、going_visibility（public、after_event、hidden）。
- 封面：cover_id、cover_policy（official、template），封面记录含来源、许可、署名、主色、缩略哈希。

## 8. Newsletter 与订阅

每周一期，周日 17:00 到 20:00 太平洋时间之间发出，每位订阅者只收到自己勾选类别的内容和自己选的语言。发送由两条每日定时任务（01:00 与 02:00 UTC）触发，因为 Vercel Hobby 的定时任务精度是 ±59 分且失败不重试 [Vercel Cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)：本期的 send_after 设为周日 17:00 PT，“PT 是周日、已过 send_after、本期未发”三个条件满足即发，幂等的发送记录保证第二条任务不会重发。周日晚是读者已经习惯收 Luma 城市周报的时段 [Discovering Events](https://help.luma.com/p/discovering-events)。

### 一期的结构
1. Victor 的引言，2 到 4 行；用一种语言写，另一种由 LLM 起草，在后台批准。
2. 我会去 / Victor is going：只列公开的会去、主办、分享。
3. 每个订阅类别一节，按订阅者的类别顺序；节内按天分组，每条是 96 px 方形封面、当前语言标题（另一语言灰字，两者归一化后相同时省略）、本地格式的日期时间、场地城市、价格与报名芯片、1 到 2 行点评、跳到 source_url 的 RSVP 按钮。
4. 下周预告：只放置顶活动。
5. 页脚：发件人、“无付费植入”声明、语言切换、偏好中心、可见退订链接。

### 个性化规则
变体键 = 语言 + 排序后的类别集合；每个变体渲染一次，再分批发送（每次 100 封）。某个变体本周没有活动时，每月最多发一次“本周没有想推荐的”，其余跳过。主题行必须诚实，例如“本周 6 场精选 · Victor 会去 2 场”，加州法律对误导性主题行每封可罚 $1,000 [California B&P 17529.5](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17529.5)。

### 语言模式
订阅者在报名时选 en 或 zh（按页面语言预填），偏好中心可改；每封邮件只有一种语言，页脚和退订双语；确认邮件双语。

### 报名流程
1. 站内表单：7 个类别芯片 + 语言（会去提醒是 P1 的 F20）。用 fetch 提交，带隐形机器人检测、蜜罐字段、≥3 秒填写时间、按 IP 和邮箱限流，防止表单被刷烧掉发送配额，这是 M3AAWG 建议的做法 [M3AAWG Sender BCP](https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-sender-best-common-practices-aug-27-2026.pdf)。
2. 记录 pending 状态和同意日志（时间、IP、来源页、类别、语言）。
3. 发双语确认邮件，不含任何营销内容；点击 /confirm/[token] 激活；7 天未确认自动清除。

### 偏好中心与退订
/prefs/[token] 用 32 字节哈希 token，不暴露邮箱；可改语言、类别、提醒（P1）、暂停 4 周、退订单个类别或全部。每封邮件带 RFC 8058 一键退订头，退订 POST 不需要 cookie、返回 200、不重定向、即时生效 [RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058)；Gmail 要求 48 小时内处理，我们做到秒级 [Gmail 发件人指南](https://support.google.com/a/answer/14229414)。退信和投诉通过 webhook 自动加入抑制名单。

### 送达与配额
用 mail 子域名发信，SPF、DKIM、DMARC（先 p=none）从第一封开始配齐，虽然日量远低于 5,000 的大宗门槛，但提前满足大宗发件人规则成本很低。Resend 免费层每天 100 封，且收到的邮件同样计入这个额度 [Resend 配额](https://resend.com/docs/knowledge-base/account-quotas-and-limits)：未开启 Gmail 转发时约 90 个活跃订阅者后需要 Pro（$20/月）[Resend 定价](https://resend.com/pricing)，M4 开启 Gmail 转发的同一周升级 Pro。页脚不放邮寄地址：CAN-SPAM 的地址要求只针对商业邮件，本周报不含广告与赞助；一旦加入赞助位，先补一个非住宅地址再发 [FTC CAN-SPAM 指南](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)。

### 加发（P1）
后台可对某个类别发一封“临时加发”，用于临近的热门活动，每类每周最多一次。

## 9. 双语策略

界面用双路由，活动内容是双语字段（LLM 起草、Victor 逐字段批准），邮件每封只有一种语言。

### 界面
- URL：英文在 /…，中文在 /zh/…，路径其余部分相同，例如 /events/ai-tinkerers-oct 对应 /zh/events/ai-tinkerers-oct；/admin 和 /api 不带语言前缀。
- 检测：首次访问按 Accept-Language（zh 开头跳 /zh）；LangSwitch 是页头的“EN | 中”胶囊，保留当前路径，写 1 年的 cookie，之后以它为准；邮件里的链接指向订阅者的语言。
- SEO 与无障碍：每页输出 hreflang en、zh-Hans、x-default，html lang 为 en 或 zh-Hans；页面里的混合语言片段（zh 页上的英文标题、en 页上的中文标题）带 lang 属性，这是 WCAG 3.1.2 的要求 [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/?versions=2.2&levels=aa)。

### 活动内容
- 双语字段：title、summary、note 各两份；分类和 facet 标签来自固定词表。
- 英文专有名词和官方活动名在中文页保留原文，只翻译说明，这是 GPTDAO 周报验证过的做法 [GPTDAO 周报](https://gptdao.ai/zh/articles/2024/08/Aug26-2024-weekly-ai-event.html)；此时 title_zh 与 title_en 相同，卡片不重复渲染第二行。
- Victor 用哪种语言写点评都行，LLM 起草另一种并保留语气，字段标记 auto，一键批准或重译；两种都写了就都保留。
- 主办方的描述任何语言都不存。

### 邮件
每封只用 subscriber.locale 的语言，页脚和退订双语，确认邮件双语。

### 日期与时间

| 语言 | 示例 | 规则 |
|---|---|---|
| zh | 10月7日周三 18:30–20:00 北美太平洋时间 | 24 小时制，时区用长名，全称“2026年10月7日星期三” |
| en | Wed, Oct 7 · 6:30 – 8:00 PM PT | 12 小时制 |
| 线上活动 | 加显示访客本地时间；zh 页加北京时间（PDT 期间 +15 小时，2026-11-01 后 +16 小时） | 两种语言都显示活动所在的太平洋时间 |

存储用 UTC 加 IANA 时区，渲染用 Intl.DateTimeFormat 的实际输出，不维护翻译表；CLDR 数据显示中国大陆偏好 24 小时制、美国偏好 12 小时制 [CLDR timeData](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/timeData.json)。绝不用纯数字日期，每个日期都放在带时区偏移的 time 元素里。

### 中英混排
中文正文行高 1.7，英文 1.5，标题 1.3；正文字距 0，中文展示标题 0.02em；中西文之间留不超过四分之一个汉字宽的间距，用 CSS text-autospace 实现，这是 W3C 中文排版需求的规定 [CLReq](https://www.w3.org/TR/clreq/)；日期块用等宽数字；每个字体栈里拉丁字体排在 CJK 字体前面。

## 9b. 视觉设计方向

气质一句话：一本城市周记的编辑账本，在画廊白的纸面上用安静的、以字体为主的列表呈现，方形封面、等宽数字的时间列、Victor 的页边批注和一枚朱砂印章承担全部个性。

### 参考

| 参考 | 借鉴什么 | 链接 |
|---|---|---|
| Luma 城市页 | 列表优先的密度，每行用方形封面做锚点；平台标准是 1:1、≥800² | [luma.com/sf](https://luma.com/sf) |
| Cerebral Valley | 左侧徽章列；没有图片列表也能显得完整，所以模板封面要像设计出来的 | [cerebralvalley.ai/events](https://cerebralvalley.ai/events) |
| Are.na | 字体克制：一款有个性的字体加等宽字做元数据，索引页不放大图 | [are.na](https://www.are.na/) |
| It's Nice That | 本周置顶卡片的处理、胶囊标签、相对日期 | [itsnicethat.com](https://www.itsnicethat.com/) |
| Gary's Guide（反例） | 保留它按周和按天分组的密度，去掉星号分隔线，换成基于行距的网格和真正的字号层级 | [garysguide.com/events](https://www.garysguide.com/events) |

### 字体搭配

| 用途 | 拉丁 | 中文 | 加载方式 |
|---|---|---|---|
| 展示标题 | Fraunces（可变光学字号，roman 与 italic 各一份，不加 SOFT 与 WONK 轴） | Noto Serif SC 600 | Fraunces 走 next/font/google；中文用 cn-font-split 切成 unicode-range 分片自托管，另配 PingFang SC 度量匹配回退 |
| 正文与芯片 | Geist | Noto Sans SC 400（首屏唯一字重，层级靠字号与颜色） | Geist 与 Geist Mono 走 geist npm 包（全字形）；中文同上 |
| 元数据与时间 | Geist Mono，等宽数字 | 数字和时间不用中文字体 | geist npm 包 |
| Victor 点评 | Fraunces Italic | LXGW WenKai 400（只在点评出现，font-display swap，不阻塞首屏；zh 最小 1rem，无粗体） | 切片自托管，不预加载 |

必须切片的原因：Noto Sans SC 完整文件 17.8 MB [Google Fonts 元数据](https://fonts.google.com/metadata/fonts/Noto%20Sans%20SC)，Google 自己的切片版单个字重也有 4.28 MB、分成 100 片 [Google Fonts CSS2 实测](https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap)，而 next/font/google 没有简体中文子集也不能控制 unicode-range [Next.js 讨论 #47309](https://github.com/vercel/next.js/discussions/47309)；cn-font-split 能按字体实际字符切片 [cn-font-split](https://github.com/KonghaYao/cn-font-split)。所以 zh 首屏只加载两个 CJK 字重（Noto Serif SC 600 与 Noto Sans SC 400）。首屏字体预算：en ≤120 KB，zh ≤300 KB（估算，用 Lighthouse CI 实测后校准）。

每个 CJK 家族在切片 CSS 之后追加一个本地回退 @font-face（PingFang SC 加 size-adjust、ascent-override、descent-override，数值按实测），标题容器给固定 min-height，避免换字时回流影响 CLS。自托管避免依赖第三方字体 CDN（Google Fonts 在大陆的可达性未核实）。

### 色彩角色

| 角色 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| paper | oklch(0.985 0.004 250)，接近白的冷纸色 | oklch(0.16 0.01 260)，深墨蓝灰 | 页面背景 |
| ink | oklch(0.21 0.02 260) | oklch(0.92 0.008 90)，暖白 | 正文与标题，RSVP 主按钮底色（paper 字） |
| muted | oklch(0.55 0.01 260) | oklch(0.68 0.01 260) | 元数据、另一语言标题、“想去”灰字 |
| rule | oklch(0.90 0.01 250) | oklch(0.28 0.01 260) | 分隔线、卡片边、次级按钮（加日历、分享）描边 |
| seal 朱砂 | oklch(0.63 0.19 32)，文字用 oklch(0.48 0.19 32) 保证 4.5:1 | oklch(0.72 0.17 32) | 只属于 going 系统：印章、点评左侧竖线、焦点环 |
| 类别色 | 7 个实色，色相与朱砂的 32° 至少相距 30°：ai 靛 275、hackathon 芥末黄 95、vc 苔绿 145、campus 赭 65、conference 石板 235、cycling 青 190、social 梅紫 330；L 0.55 到 0.62，C 0.12 到 0.15 | 同色相提亮 | 芯片底色为类别色 12% 混入纸色，芯片文字一律 ink；日历圆点与模板封面色场用实色 |

规则：朱砂只属于 going 系统，任何类别、按钮或链接不得使用 32° 色相；每个类别色单独核对与 paper 的 3:1 对比。浅色模式用发丝线分隔，深色模式用柔和阴影；圆角 6、12、20（卡片 12，封面 8，芯片全圆）；4 px 间距基数。

### 活动卡片的解剖
1. 左列：在按天分组的视图（本周、/week、/going、手机议程）里是 TimeBadge，Geist Mono 1.25rem 等宽数字的“18:30”，下方 0.75rem 的时长或“全天”；DateBadge（07 / 周三）只用于没有日期分组的上下文：精选卡、周报邮件、搜索结果。
2. 封面：手机 112 px、桌面 144 px 的 1:1 方块，圆角 8，先显示缩略哈希和主色块；印章盖在左上角（仅会去、主办、分享、去过）。
3. 标题：当前语言用 Fraunces 或 Noto Serif SC，1.25rem 最多 2 行截断；另一语言 0.8125rem 灰字在下方，title_zh 与 title_en 归一化（去空格与标点、小写）后相同时不渲染第二行。手机上标题列约 246 px 宽（390 减 32 边距、48 时间列、112 封面、24 间距，估算）。
4. 元数据一行：Berkeley · Free · 中文 · Apply；“想去”以灰字附在这一行末尾。
5. 类别芯片。
6. 点评块：1 到 2 行斜体或楷体，左侧 2 px 朱砂竖线，“— Victor”落款。

精选卡（每周 2 到 3 张）封面一律 1:1：手机端精选区是横向滚动 rail，每卡 260 px 宽、封面 228 px、点评 2 行，rail 高约 420 px，第一个日期分组在一屏半内可见；桌面为 2 到 3 列网格，封面最大 320 px；精选卡使用 DateBadge。详情页是最大 640 px 的 1:1 封面加同样的块，再加 RSVP 按钮、加日历一行和封面署名。

### 会去印章
方形朱砂印，纸色刻字，三个尺寸：40 px（112 px 封面）、56 px（144 px 封面与精选卡）、80 px（详情页与 /going）。印面只刻当前语言一个标签：zh 为两个汉字（会去、主办、分享、去过），Noto Serif SC 600 占印面 70%；en 为 Geist Mono 700 大写（GOING、HOST、TALK、WENT），字距 0.08em；绝不中英同印。旋转 −3°，预留位置不挤动版面；出现时 120 ms 从 1.15 缩到 1 的“盖章”动效。“想去”不盖印章，只在元信息行显示灰字，这样印章始终是 Victor 真正会到场的信号。

### 视图
本周（默认）：按天分组、天标题吸顶、顶部“Victor 会去”条。月历：桌面月格加类别圆点，点一天展开列表；手机改为议程。列表：facet 筛选。类别芯片行多选，是真正的按钮，桌面 32 px 高、手机 44 px，同时生成个性化的 iCal 和订阅链接。

### 动效与空状态
卡片到详情的封面用 React ViewTransition 变形，周切换淡入淡出，Next.js 16 无需配置 [Next.js 视图过渡](https://nextjs.org/docs/app/guides/view-transitions)；芯片和收件箱滑动用 motion 的精简版，约 4.6 kb [Motion 体积](https://motion.dev/docs/react-reduce-bundle-size)；一律 150 到 250 ms，prefers-reduced-motion 下全部关闭。空状态是一句点评口吻的双语话：“这周这些分类没有我想推荐的活动，试试放宽筛选”，印章做淡水印，附 iCal 和订阅链接；已取消的活动保留卡片，标题加删除线和“已取消 / Cancelled”芯片。模板封面共用类别色，不含日期与印章，在 96 px 下只剩色场与一个大字，因此在列表和邮件缩略图里依然可辨，缺官方封面不会显得是缺陷；封面加载失败时用纯 CSS 的类别色瓦片兜底，不再请求第二张图。

### 预算与无障碍
LCP ≤2.5 s、INP ≤200 ms、CLS ≤0.1（p75）[Web Vitals](https://web.dev/articles/vitals)；首页 JS ≤120 KB；前两张封面预加载并有固定宽高比。文字对比 ≥4.5:1、芯片和印章 ≥3:1，2 px 朱砂焦点环，触控目标 ≥24 px（手机 44 px），图片上不放无遮罩的文字，混合语言片段带 lang 属性。

邮件模板用 600 px 单列、内联样式：zh 正文字体栈为 PingFang SC、Microsoft YaHei、Noto Sans CJK SC、sans-serif，只有标题用 Songti SC、SimSun、serif；en 标题 Georgia、正文系统无衬线；zh 正文 16 px、行高 1.7、段距 12 px，en 正文 16 px、行高 1.5，因为邮件客户端对 web 字体支持只有约 24% [Can I email](https://www.caniemail.com/features/css-at-font-face/)。印章用站点托管的 48 px（@2x）PNG，中英各一套，文字兜底为 [会去] / [GOING]。HTML ≤90 KB，因为 Gmail 在 102 KB 处截断 [Litmus](https://www.litmus.com/blog/how-to-keep-gmail-from-clipping-your-emails)。

### 与 victorchun-site 的关系
同一种“安静的纸”直觉和同一款 Geist Mono 元数据，但纸色更冷，展示字体从 Newsreader 换成带光学字号的 Fraunces，强调色从琥珀换成朱砂，是姊妹站而不是复制。设计 token 按同样的 Tailwind v4 结构复制一份，不做共享包；后台也复用这套 token。victorchun-site 加一个导航链接，并可读取精选的 RSS。

## 10. 版本规划

MVP 是 M0 到 M3（从 Victor 独用到 newsletter 软上线），V1 是 M4（公开上线与中文渠道），V2 是 M5 的可选项；每个阶段有一个必须通过的门槛才能进入下一阶段。

> 图见 Claude 文档中的交互式图表；下面是图的内容规格。

```text
Title: 六个里程碑分成三个版本，每个版本靠一个可测的门槛放行

Layout hint: 水平时间线，从左到右；三个容器（MVP 2026-10 至 2027-01，V1 2027-02，V2 2027-03）各包一到四个里程碑；每个里程碑节点下方挂一个菱形门槛节点；里程碑之间用实线箭头，门槛到下一里程碑用虚线。

Container MVP（Victor 独用到 newsletter 软上线）:
- M0 基础 (body: 2026-10-11; 域名 DB Auth 邮件域)
- G0 门槛 (body: Face ID 与 Touch ID 登录; DMARC DKIM 验证通过)
- M1 公开站与 feeds (body: 2026-11-08; 组件 双语页面 iCal RSS 20 条种子)
- G1 门槛 (body: Lighthouse ≥90 性能 ≥95 a11y; iCal 在 Apple 与 Google 可导入)
- M2 后台 录入 封面 快速添加 (body: 2026-12-13; ingest 4 适配器 PWA 快捷指令 收件箱 P0)
- G2 门槛 (body: 手机加 20 条 ≤6 秒 p50; 每条有封面 总开关有效)
- M3 Newsletter 与软上线 (body: 2027-01-17; 订阅 偏好中心 周日发送 隐私页 微信文字)
- G3 门槛 (body: 连续 2 期准时发给 ≥50 人; 一键退订验证)

Container V1（公开上线与中文渠道）:
- M4 收件箱 P1 与中文渠道 (body: 2027-02-14; Gmail 转发 长图 小红书 会去提醒 封面外部图源)
- G4 门槛 (body: ≥50% 精选来自收件箱或 skill; ≥300 订阅者或上线 4 周)

Container V2（可选）:
- M5 加固与 P2 (body: 2027-03-31; OAuth MCP Luma 镜像 Pro 决策)
- G5 门槛 (body: 基于用量的决策备忘; 春季 backlog)

Edges:
- M0 -> G0
- G0 -> M1 (dashed)
- M1 -> G1
- G1 -> M2 (dashed)
- M2 -> G2
- G2 -> M3 (dashed, label: 期末只做 cron 和文案)
- M3 -> G3
- G3 -> M4 (dashed)
- M4 -> G4
- G4 -> M5 (dashed)
- M5 -> G5
```

图里从左到右六个里程碑节点写日期和范围，节点下方的菱形是进入下一阶段的门槛，三种底色分别对应 MVP、V1、V2。

## 11. 风险与待定问题

最大的三类风险是平台页面改版导致自动填充失败、公开行踪的人身安全、以及邮件送达；每一类都有不依赖第三方善意的应对。

| 风险 | 影响 | 应对 |
|---|---|---|
| Luma、Partiful 页面结构或内嵌数据改版 | 自动填充和封面失败 | JSON-LD 优先、内嵌数据其次；固定样本每周跑测试；失败时返回 202 最小草稿，分享不丢 |
| 平台条款与封面版权（Luma 禁止转载图片，Eventbrite、Partiful 禁止抓取） | 下架要求或账号风险 | 只存事实、链接和 Victor 的文字；官方封面 ≤1600² 并署名；一键全部换成模板封面；24 小时下架通道 [Luma Terms](https://luma.com/terms) [Eventbrite ToS](https://www.eventbrite.com/help/en-us/articles/251210/eventbrite-terms-of-service/) |
| 公开“我会去”是提前公布行踪 | 跟踪与人身安全，2019 年美国 16 岁以上人口约 1.3% 曾被跟踪 [BJS](https://bjs.ojp.gov/library/publications/stalking-victimization-2019) | 默认“想去”只显示灰字；“会去”受安全规则约束；骑行和私人场地永不显示；后台总开关（数据库行）；公开页只显示城市 |
| 邮件送达（Gmail、Yahoo 规则，qq、163 拦截） | 进垃圾箱或被拒 | 自定义发信子域 SPF、DKIM、DMARC；一键退订头；双重确认；qq.com 和 163.com 种子账号测试 |
| Resend 免费层每天 100 封（收发合计） | 未开启 Gmail 转发时约 90 个活跃订阅者后发不出，开启后更早 | 预算 Pro $20/月，在 M3 前决定；M4 开启 Gmail 转发的同一周升级 |
| Vercel Hobby 定时任务每天一次、精度 ±59 分、不重试 | 周日周报漏发或发两次 | 两条每日 cron（01:00 与 02:00 UTC）都调发送端点，send_after 为周日 17:00 PT，幂等发送记录 |
| 大陆可达性（vercel.app 被封） | 中文读者打不开 | 上线前买自定义域名 [Vercel 中国访问指南](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china) [GreatFire](https://en.greatfire.org/vercel.app)；zh 界面按 Apple、Outlook、.ics、Google 排序 |
| Vercel Hobby 只允许非商业用途 | 赞助或付费即违规 | 商业化当天升 Pro [Vercel Hobby](https://vercel.com/docs/plans/hobby) |
| Google 收紧未验证应用 | P2 OAuth 失效 | P0 与 P1 路线（私密 iCal、Gmail 转发）不依赖 OAuth |
| 订阅表单被刷 | 烧掉发送配额，损害信誉 | 隐形机器人检测、蜜罐、3 秒填写、按 IP 和邮箱限流、防火墙规则 |
| Victor 的学期时间（期中、期末） | 断更 | skill 推送与收件箱降低每周成本；周报允许“本周无精选”；12 月中只做 cron 和文案 |
| 现有站点 Next.js 16.2.6 在漏洞范围内 | 远程代码执行 | M0 一并升级到 16.3.6，9 月 30 日后升 16.3.7 [Next.js 安全公告](https://nextjs.org/blog/nextjs-security-update-september-22-2026) |
| 单人项目 | 无人接手 | 数据可导出（RSS、ICS、订阅者月度 CSV）；数据库在自己名下 |
| 微信渠道限制 | 群 500 人上限；小红书禁止站外链接和二维码 | 多群并行；小红书导出不含链接 [微信群人数](https://kf.qq.com/faq/161223uIfIre161223aUrmqU.html) [小红书导流规则](https://news.qq.com/rain/a/20250312A05A1Y00) |

### 待 Victor 决定
- [ ] 域名：用哪个自定义域名（例如 picks 子域），是否可注册？域名是 Resend 发信和大陆可达的前置条件。
- [ ] 产品名：工作名“Victor's Picks · Victor 精选”确认还是替换？
- [ ] 商业意图：将来会有赞助位或付费层吗？有的话从第一天起用 Vercel Pro，并对中文收件人遵守“广告”主题标注。
- [ ] 收件箱用哪个 Google 账号：个人 Gmail 还是 berkeley.edu？
- [ ] “会去”公开的舒适度：接受默认规则，还是第一个月只用 after_event？
- [ ] 默认封面策略：官方封面复制，还是 Luma 来源一律模板？
- [ ] weekly-events skill 是否继续写 Notion，还是收件箱稳定后停掉？
- [ ] 微信群和小红书账号由谁运营；是否有大陆身份证办公众号（没有就不做 [公众号注册说明](https://kf.qq.com/faq/120911VrYVrA130619v6zaAn.html)）？
- [ ] Luma Plus（$59/月，按年计费 [Luma 定价](https://luma.com/pricing)）是否值得为镜像日历购买？
- [ ] 邮件打开与点击追踪：默认关闭，还是为指标打开？
- [ ] SF Tech Week（10 月 5 到 11 日）：跳过，还是在 M1 前用种子数据发一个静态“Tech Week 精选”页？
- [ ] Gmail 转发过滤器包含哪些 roundup 发件人（Bay Area Founders Club、Founders Bay、Luma SF 周报、Startup Grind SV、weshine、SCET）？
- [ ] 每周 10 到 15 小时的时间预算是否现实，哪些周不可用？

## 12. 参考来源

以下是本 PRD 引用过、调研时实际打开过的页面。

- [Discovering Events · Luma Help](https://help.luma.com/p/discovering-events)
- [Sending Newsletters · Luma Help](https://help.luma.com/p/sending-newsletters)
- [iCal Syncing · Luma Help](https://help.luma.com/p/ical-syncing)
- [Event Cover Images · Luma Help](https://help.luma.com/p/event-cover-images)
- [Hiding Your Event Location · Luma Help](https://help.luma.com/p/hiding-your-event-location)
- [Luma Terms of Use](https://luma.com/terms)
- [Luma Pricing](https://luma.com/pricing)
- [What's Happening in San Francisco · Luma](https://luma.com/sf)
- [Are there cover image guidelines? · Partiful Help](https://help.partiful.com/en-us/articles/15525294-are-there-cover-image-guidelines)
- [Featuring Your Event on Explore · Partiful](https://partiful.com/featuring-your-event-on-explore)
- [Sync to Google Calendar · Partiful Help](https://help.partiful.com/hc/en-us/articles/15525660-sync-to-google-calendar)
- [Cerebral Valley Events](https://cerebralvalley.ai/events)
- [AI Tinkerers](https://aitinkerers.org/)
- [This Week in the Bay Area: 42 Curated Events · Bay Area Founders Club](https://bayareafoundersclub.substack.com/p/this-week-in-the-bay-area-42-curated)
- [Founders Bay SF edition, 2026-09-27](https://newsletter.foundersbay.com/p/new-post-a2f2)
- [GarysGuide Press](https://www.garysguide.com/press)
- [SF Tech Events · GarysGuide](https://www.garysguide.com/events)
- [SF IRL, Nov 17 2025](https://sfirl.beehiiv.com/p/sf-irl-nov-17th-2025)
- [About · Eddie's List](https://www.eddies-list.com/about)
- [Hidden Events SF](https://hiddenevents.online/sf)
- [GPTDAO 湾区 AI 领域活动精选](https://gptdao.ai/zh/articles/2024/08/Aug26-2024-weekly-ai-event.html)
- [湾区人文 · Bay Area Chinese Cultural Events Hub](https://bayareahuman.org/)
- [硅谷101科技大会活动手记](https://news.qq.com/rain/a/20241101A04L8100)
- [Plancast 复盘 · TechCrunch](https://techcrunch.com/2012/01/22/post-mortem-for-plancast/)
- [Are.na](https://www.are.na/)
- [It's Nice That](https://www.itsnicethat.com/)
- [MDN browser-compat-data](https://unpkg.com/@mdn/browser-compat-data/data.json)
- [Apple Shortcuts: 从其他 App 运行快捷指令](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-another-app-apd163eb9f95/ios)
- [Google Calendar: 与计算机程序同步日历](https://support.google.com/calendar/answer/37648)
- [Google Calendar: 管理邀请](https://support.google.com/calendar/answer/13159188?hl=en&co=GENIE.Platform%3DDesktop)
- [Gmail: 自动转发邮件](https://support.google.com/mail/answer/10957)
- [Receiving Emails · Resend Docs](https://resend.com/docs/dashboard/receiving/introduction)
- [Resend Pricing](https://resend.com/pricing)
- [Resend: Account quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [Sensitive scope verification · Google Identity](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Unverified apps · Google Cloud Help](https://support.google.com/cloud/answer/7454865)
- [Using OAuth 2.0 to Access Google APIs](https://developers.google.com/identity/protocols/oauth2)
- [Vercel Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Accessing Vercel-hosted sites from mainland China](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)
- [GreatFire: vercel.app](https://en.greatfire.org/vercel.app)
- [Readwise Reader: Library configuration](https://docs.readwise.io/reader/guides/workflows/library-configuration)
- [Strava: Edit Map Visibility](https://support.strava.com/hc/en-us/articles/115000173384-Edit-Map-Visibility)
- [California B&P 17529.5](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17529.5)
- [M3AAWG Sender Best Common Practices v4.0](https://www.m3aawg.org/sites/default/files/doc_files/m3aawg-sender-best-common-practices-aug-27-2026.pdf)
- [RFC 8058](https://datatracker.ietf.org/doc/html/rfc8058)
- [Email sender guidelines FAQ · Google](https://support.google.com/a/answer/14229414)
- [CAN-SPAM Act Compliance Guide · FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/?versions=2.2&levels=aa)
- [CLDR timeData.json](https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/supplemental/timeData.json)
- [Requirements for Chinese Text Layout (CLReq)](https://www.w3.org/TR/clreq/)
- [Google Fonts metadata: Noto Sans SC](https://fonts.google.com/metadata/fonts/Noto%20Sans%20SC)
- [Google Fonts CSS2 API: Noto Sans SC 切片实测](https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700&display=swap)
- [next/font/google unicode-range · Discussion #47309](https://github.com/vercel/next.js/discussions/47309)
- [KonghaYao/cn-font-split](https://github.com/KonghaYao/cn-font-split)
- [Next.js: Designing view transitions](https://nextjs.org/docs/app/guides/view-transitions)
- [Motion: Reduce bundle size](https://motion.dev/docs/react-reduce-bundle-size)
- [Web Vitals · web.dev](https://web.dev/articles/vitals)
- [Can I email: @font-face](https://www.caniemail.com/features/css-at-font-face/)
- [Litmus: Gmail clipping](https://www.litmus.com/blog/how-to-keep-gmail-from-clipping-your-emails)
- [Eventbrite Terms of Service](https://www.eventbrite.com/help/en-us/articles/251210/eventbrite-terms-of-service/)
- [BJS: Stalking Victimization, 2019](https://bjs.ojp.gov/library/publications/stalking-victimization-2019)
- [Next.js Security Update, 2026-09-22](https://nextjs.org/blog/nextjs-security-update-september-22-2026)
- [微信群人数限制说明 · 腾讯客服](https://kf.qq.com/faq/161223uIfIre161223aUrmqU.html)
- [小红书禁止引导站外交易 · 腾讯新闻](https://news.qq.com/rain/a/20250312A05A1Y00)
- [微信公众平台注册说明 · 腾讯客服](https://kf.qq.com/faq/120911VrYVrA130619v6zaAn.html)
