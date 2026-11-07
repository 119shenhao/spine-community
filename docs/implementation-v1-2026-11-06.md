# v1 开发实现与验收记录

日期：2026-11-06。分支：`feature/v1-community-build-20261106`。此记录区分代码、自测和远程环境，不将代码存在等同于可公开上线。

## 开发预览：默认发帖语言跟随界面语言（2026-11-07）

- 用户确认将个人中心的“原文语言”设置项改为“默认发帖语言”；具体帖子/回复的原文语言选择仍保留，因为那是本条内容的真实语言标识。
- 账户语言偏好支持 **自动（跟随当前界面）/ 手动固定（指定语言）** 两种状态。新账号及历史未手动指定的账号，打开个人中心时显示“跟随界面语言（当前语言）”，新发帖和新回复的默认原文语言自动使用当前界面语言（包括 `zh-CN`、`zh-TW`）。手动指定后在切换界面语言和重新登录时保留指定语言；可再次选择“跟随界面语言”恢复自动。
- 新增 `migrations/v1/0007_default_posting_language.sql`：为 `users` 增加 `preferred_locale_mode`，默认 `auto`；旧数据中 `preferred_locale!='en'` 的账号标记为 `manual`，尽量保留已设的非英语偏好。**历史手动选定英语与原本的英语默认值无法区分**，该部分账号将切换为自动模式；可以重新手动选择英语锁定。
- `PATCH /api/me` 向下兼容原有的具体语言值请求，将 `preferred_locale='auto'` 解读为自动跟随，并提供 `preferred_locale_mode` 在 `GET /api/me` 中。未涉及生产端用户数据，未改动帖子原文。
- 开发分支：`feature/v1-community-build-20261106`；最终提交 `de379aaef1f0f0f448e488daa24f72df14f5f6d4`；[GitHub verify #42388612142](https://github.com/119shenhao/spine-community/actions/runs/42388612142) 测试为 success，Cloudflare Preview 构建结果以对应 SHA 检查为准。
- **仅更新开发分支及开发预览数据库，未合并/发布任何程序代码至生产环境，也未执行生产 D1 迁移。** 未来正式发布必须按现有 Production D1 inspect/apply 流程审查 `0007` 迁移，并评估英语默认历史账号的语义变化。

## 第三次正式发布：繁体中文与首页帖子优先（2026-11-07）

- 用户直接发出固定任务指令“发布新版本从开发环境到生产环境”；按 `docs/release-version-workflow.md` 的**现有** Production D1 / PR / Cloudflare 流程执行，没有新建发布工作流，也没有要求用户手动点击 Run workflow。
- 源分支：`feature/v1-community-build-20261106`；锁定开发版本 `1b367062f1746a385d5ddbf513ffdfcdcfe1fa4a`。GitHub [verify #42385258327](https://github.com/119shenhao/spine-community/actions/runs/42385258327) 和 Cloudflare Preview 构建均为 `success`。
- 由于开发分支与 `main` 历史分叉，以生产主分支为基线准备 `release/spine-20261107-zh-tw-home`，候选完整 SHA `99aca4fa5f5db3acf78099b51a23d5c0f7173e26`，**仅携带 11 个已审查程序/测试/迁移文件**，保留现有生产文档、管理员代理说明、工作流、Google 登录配置和业务数据。
- 功能：进入首页立即看到最新帖子列表（搜索卡片和首页大横幅移除）、导航栏在“个人中心”旁新增“发帖”、繁体中文 `zh-TW` 及台湾／香港／澳门浏览器自动选择、150 条繁体界面词条、后台语言校验、未来翻译目标 `zh-Hant` 兼容映射（实际内容自动翻译仍关闭）。
- 数据库差异：仅新增 `migrations/v1/0006_zh_tw_labels.sql`，对 11 个现有分类/标签增加 `zh-TW` 名称，使用 `INSERT OR IGNORE`，不修改表结构、不覆盖已有标签及用户帖子。以前 0001–0005 的迁移文件未变更。
- 生产 D1 目标经现有工作流校验为 `spine-community-db`、UUID `5919ff78-b8fc-46ab-85f0-01fe5e6a41b0`：[迁移前只读检查 #42386604067](https://github.com/119shenhao/spine-community/actions/runs/42386604067) `success`；[受控 apply #42386727659](https://github.com/119shenhao/spine-community/actions/runs/42386727659) `success`，真实工作日志明确显示 `0006_zh_tw_labels.sql ✅`，且“Record a restore point and apply migrations”步骤成功（恢复 bookmark 写入该工作流 Summary，未另行对外展示）；[迁移后再次只读检查 #42386835903](https://github.com/119shenhao/spine-community/actions/runs/42386835903) `success`，本次未再次执行 apply。
- 代码发布：[PR #8](https://github.com/119shenhao/spine-community/pull/8) 合并成功，生产程序提交 `14ceb14a40a1140d5aeda29eac82d9209248b12b`。Cloudflare 生产 Worker 构建 `b8cf9096-5126-4a3d-9897-c087e06ca64c`：`completed / success`，完成时间 `2026-11-07T15:33:11Z`。
- 没有复制预览库的测试账户、帖子、回帖或楼中楼；“同步帖子”仍是独立任务。恢复数据库需要另行审批，切勿直接执行 Time Travel 回滚导致后续真实数据丢失。
- **验证边界**：GitHub CI、生产 D1 迁移执行及复查、PR 合并和 Cloudflare 生产构建均已核实。当前访问 `https://spine.nbn369.com/` 及 `/api/health` 的工具遇到 DNS/访问限制，**尚未完成真实浏览器中的首页、Google 登录或生产 HTTP 健康复验**；不得把构建成功等同于这些实测已通过。

## 开发预览：繁體中文（台灣、香港、澳門共用）（2026-11-07）

- 根据用户明确要求，在既有开发分支 `feature/v1-community-build-20261106` 新增第八种界面语言 `zh-TW`，下拉菜单显示「繁體中文」。实现独立的繁体中文界面词典，**150 条文案完整翻译**（包括发帖、评论、登录、个人中心、隐私、管理员及通知），而非从英文回退；保留原有七种语言。
- 浏览器 `zh-TW`、`zh-HK`、`zh-MO`、`zh-Hant` 及相关变体默认映射至同一 `zh-TW` 界面；`zh-CN`／`zh-SG`／`zh-Hans` 保持简体中文。显式选择和登录前保存的语言优先，Google 登录后刷新不覆盖。曾保存的 `zh-HK`、`zh-MO` 等浏览器偏好迁移至 `zh-TW`。
- 服务端支持在用户偏好、帖子／回帖的原文语言与翻译目标字段使用 `zh-TW`；新增数据型 D1 迁移 `migrations/v1/0006_zh_tw_labels.sql`，为已有的 11 个分类和症状／治疗标签添加繁体中文显示文字，不覆盖管理员维护的已有标签。不修改其他业务表和用户已有数据。
- 内容翻译服务仍按原全站开关保持关闭；仅补齐未来启用 Azure Translator 时将内部 `zh-TW` 映射到服务商支持的 `zh-Hant`，没有开启外部翻译、申请密钥或计费。繁简关键词互搜仍是后续独立需求，不宣称本次已实现。
- 最终开发代码提交：`1b367062f1746a385d5ddbf513ffdfcdcfe1fa4a`；[GitHub verify #42385258327](https://github.com/119shenhao/spine-community/actions/runs/42385258327) **completed / success**；Cloudflare Worker Preview 构建 `9f1a9844-6420-47b0-a98f-0a81f438d25c` **completed / success**。该构建包含 TypeScript 检查和测试；当前外部浏览工具无法访问预览 Worker，尚未独立实测线上数据库读回和真实手机浏览器交互。
- **仅更新开发分支和其预览环境**；`main` 的程序代码和生产 D1 没有合并／发布此次功能。该新增迁移未来发布至生产时必须先检查和执行 Production D1 流程，不能直接跳过。

## 开发预览：首页帖子优先与导航发帖入口（2026-11-07）

- 根据手机截图反馈，开发分支 `feature/v1-community-build-20261106` 将 `#/（全部讨论）` 首页改成打开后立即显示“最新讨论”帖子列表，不再在列表上方渲染大横幅及搜索筛选卡片。
- 将“发帖”按钮放在导航中的“个人中心”后面，手机和桌面均可使用；未登录时使用现有 Google 登录提示，登录后打开原有发帖表单，保持原有权限检查与 API。
- 搜索与筛选卡片仅在 `#/search（寻找相似经历）` 页面保留；首页默认采用最新时间排序，首页切换排序仍停留在首页，分页沿用相同排序条件，搜索页保持原有相关性搜索行为。
- 七种界面语言增加“New post / 发帖”等对应文案；没有 D1 迁移，也不修改生产数据。
- 功能及回归测试提交：`8de3d9897252f5ecdad0585c42b7aae7ec073376`；[GitHub verify #42384394787](https://github.com/119shenhao/spine-community/actions/runs/42384394787) **completed/success**；Cloudflare Worker Preview 构建 `ffd4e316-37b8-470c-839a-54c0dd15edc9` **completed/success**。
- **只部署到开发预览，没有将代码合并到生产 `main`。** 浏览器的真实手机端交互还需打开预览站实际验收。

## 第二次正式发布：开发环境 → 生产环境（2026-11-07）

- 用户在 ChatGPT 中明确发出固定任务指令“发布新版本从开发环境到生产环境”；本次按照 [固定发布流程](release-version-workflow.md) 执行，没有要求用户手动点击 GitHub Run workflow。
- 源开发分支：`feature/v1-community-build-20261106`，批准发布候选源 SHA：`30318a2eab9c4cfd516e0c1fb1d739a8c1d251b1`。该提交的 [GitHub 测试](https://github.com/119shenhao/spine-community/actions/runs/42383210910) 和 Cloudflare Worker Preview 构建均为 success。
- 因主分支与开发分支历史分叉，不能直接把整个功能分支合并到 `main`，否则会删除生产 `docs/` 与已有工作流。为确保安全，以主分支 `fed307ad9d843dbf59b1be2cc46cfc2a0b779bec` 为基线，创建发布候选 `release/spine-20261107-30318a2`，精准叠加 **10 个程序相关文件**。保留 `main/docs/`、`AGENTS.md`、所有 `.github/workflows/`，不带入开发分支的旧文档。
- 发布内容：访客语言在 Google 登录/刷新后保持（支持中文、其他浏览器语言和手动切换）、移动端标识和界面改良、帖子点赞/收藏/关注及回帖无需整页刷新、回帖结果接口扩展、帖子同步脚本校验完善、预览与生产 Google OAuth Client ID 分离。
- [发布 PR #7](https://github.com/119shenhao/spine-community/pull/7) 从上述发布候选合并进 `main`，生产合并提交：`afd9945674df11ac6376ae0d4df64f6dd8cfe17c`。
- 生产 Cloudflare Workers 构建结果：**completed / success**，构建 ID：`f12780ee-239e-4aba-b529-db5686ba5218`，Cloudflare 构建完成时间 2026-11-07T14:52:50Z。部署运行由 Cloudflare 提供，未使用新的发布工作流。
- 数据库：两分支的 `migrations/v1/` 全部 SQL 文件哈希完全一致，正式生产此前已有 0001–0005 迁移成功的执行记录，因此本次不调用 Production D1，不执行生产 SQL 和业务数据复制。生产帖子及账号不经这次发布复制/替换；“同步帖子”仍独立执行。
- 验证边界：已核验候选构建成功、合并成功、`main` 指向发布提交及生产 Cloudflare 构建 success。当前外部请求工具与容器访问 `spine.nbn369.com` / 预览域名均遇到 DNS / 访问限制，因此**没有完成生产 HTTP /api/health、Google 真实登录回跳或移动端浏览器端到端复验**；不可把构建 success 等同于已进行这些实测。

## v1 正式发布记录（2026-11-07）

- [生产 D1 迁移运行](https://github.com/119shenhao/spine-community/actions/runs/42365746245)已完成。执行前确认生产库 `spine-community-db` 没有应用表，记录了 Time Travel 恢复点，随后成功执行 `0001` 至 `0005`。迁移初始化分类、设置和「未知用户」系统账号。开发库的帖子、回帖和楼中楼未复制。
- [发布 PR #1](https://github.com/119shenhao/spine-community/pull/1)已合并到 `main`，部署提交为 `a11d4b9e5a00c27c46e5fe7608c393875abb43b8`。发布内容以 PR 锁定的候选版本为准；下文后续开发分支上的界面修复属于其他提交。
- [正式站](https://spine.nbn369.com/)首页返回 HTTP 200；`/api/health` 返回 `databaseReady=true`、`googleConfigured=true` 和 `importEnabled=false`；分类接口返回 11 个分类，帖子接口返回空列表。
- 实测 Google 登录接口用生产客户端跳转到 Google 登录页，回调地址为 `https://spine.nbn369.com/api/auth/callback`。使用真实账号完成授权回跳、登录会话及登录后的写操作仍待验收。

## 2026-11-06 开发交接快照

**结论：第一版核心代码已提交并部署到开发预览，测试 D1 已初始化；尚未达到真实用户登录和正式运营的验收条件。**

| 项目 | 当前状态 | 验证范围／下一步 |
| --- | --- | --- |
| 开发代码 | 已提交 | 最新代码提交 `1df625b0209928db6e7e84d8d8b3093ea32be27b`（含导入增量），分支 `feature/v1-community-build-20261106` |
| Cloudflare Preview | 构建成功 | 最终代码的 GitHub check 为 `completed / success`；Build ID `80d3bb81-cfe3-413a-b540-d5183f4ee9d9` |
| 独立测试 D1 | 已初始化 | 三份 v1 迁移（含0003系统账号／导入记录）；远程 `/api/health` 已返回 `databaseReady=true`，页面分类和空帖子列表正常读取 |
| TypeScript 与集成测试 | 通过 | `npm run verify`；25 项测试全部通过；使用虚构账号和隔离数据库 |
| 浏览器页面 | 已检查 | 本地初版交互；远程新版首页、分类及导入帖子／3条跟帖，统一显示“未知用户” |
| Google 登录／站长账号 | 代码已实现，凭据未配置 | 远程 `googleConfigured=false`；目前不能真正登录发帖，登录后的浏览器全流程尚未实测 |
| 自动翻译 | 适配器、缓存和预算代码已实现，保持关闭 | 远程 `translationConfigured=false`；供应商、隐私告知及凭据仍待确认，未调用真实供应商联调 |
| 流量统计 | 代码已实现，采集未启用 | 远程 `analyticsConfigured=false`；需预览环境独立 `ANALYTICS_SALT` |
| 图片／R2 | 预留且关闭 | 上传按钮禁用，上传和读取接口均拒绝；未启用 R2 |
| 正式发布 | 未执行 | 未合并 `main`、未写入生产 D1；本轮没有生产数据复制 |

开发预览：[打开论坛](https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/)。

### 下一次继续开发的顺序

1. 在 Cloudflare **Preview** 环境安全配置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`；Google Web OAuth 回调登记为 `https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/api/auth/callback`。密钥不写入本文或源码。
2. 配置 `ADMIN_GOOGLE_SUB` 初始化指定站长；需要统计时配置独立 `ANALYTICS_SALT`。
3. 用测试 Google 账号在远程预览验证登录／退出、发帖、楼中楼回复、楼主进展、点赞取消、收藏关注、通知、举报审核、禁言及数据删除；包含手机端实际操作验收。
4. 翻译供应商及文本处理规则确认后，才配置凭据和双重开关，补做真实翻译联调；当前不自动开启。
5. 补齐隐私政策、年龄和留存规则、SEO、备份恢复与规模测试，再整理生产发布申请。**开发预览成功不等于正式上线获批。**

## 已实现的代码

- 七种界面语言；浏览器初始语言、手动切换和记忆。共用一个论坛，不按语言隔离。
- Google OAuth 授权码 + PKCE、state/nonce、JWKS 签名/issuer/audience/时效验证；随机会话只存 SHA-256 摘要；站长凭服务端 Google subject Secret 初始化。
- 标题/正文必填、其他可选；多分类；帖子编辑/删除；楼中楼评论与稳定父子关系；楼主进展复用根评论、递增序号、顶部最近两条/全部进展入口。
- 点赞与取消（包括自赞）、收藏、独立关注；站内通知、未读角标、点击定位、全部已读和十分钟点赞展示聚合；无自我通知。
- 原文全文索引 FTS5；多语言症状词典扩展；中文短词子串回退；四项严格筛选、相关/最新/讨论排序、20条追加加载、标明放宽条件的相似结果及关键词高亮。
- 按需标题/摘要与详情翻译适配器；版本缓存、并发租约、单行原子日/月字符预算；编辑/删除清理缓存、在途翻译不能回写已删正文。未配置/限额/故障回退原文。
- 规则三级审核，普通内容明确 published；举报不按人数自动隐藏、申诉、站长/版主服务端权限、1/3/7/30天禁言、永久封禁、角色撤销即时生效、分类维护和管理日志。
- 个人帖子/回复/收藏/关注、昵称/自愿地区、数据导出、删除申请；站长处理删除请求清空申请人正文、保留他人回复，注销时撤销身份与会话。
- 基础社区统计；页面 PV、按日随机访客摘要 UV、最近五分钟活跃峰值估算、小时 PV 峰值、7/30天列表。无原始 IP、地区推断或 API 请求冒充 PV。需要独立统计盐值；缺失时明确未开启。
- 图片上传按钮预留且禁用，所有图片上传/读取接口都拒绝；没有 R2、邮件通知或收费服务。

## 本地验证

- `npm run verify`：TypeScript + 16项 Worker/SQLite 集成测试，包含整套DDL、外键、跨帖回复、楼主权限、点赞幂等、自我通知、收藏关注分离、删除译文/索引、七语言词典/中文短词、角色撤销/禁言、翻译预算/删除竞态、统计口径、数据删除及Google JWT验证。
- Wrangler/Miniflare 本地 D1：两份迁移共302条语句成功运行。无远程生产数据库访问。
- 浏览器验证：首页/中文和英文界面、游客发布入口的登录提示、搜索及空状态。真实 Google 登录和外部翻译仍需独立凭据后实测，不能宣称已端到端验证。

## 迁移与环境

- 活跃SQL：`migrations/v1/0001_community.sql`、`0002_taxonomy.sql`。旧迁移归档，避免误执行。
- 本地配置 `wrangler.local.jsonc`；远程迁移专用配置 `wrangler.preview-migrations.jsonc`，仅 `PREVIEW_DB`、UUID `4362537a-5748-4a05-b0c4-219c3db36996`。
- 构建准备脚本仅在 Cloudflare Builds 且分支完全匹配时尝试测试库迁移；同时核对preview绑定和专用配置。未知旧结构直接停止、不DROP、不复制测试数据到生产。不在其他分支自动迁移。
- 此自动化属于本次用户授权的开发环境实现；生产迁移仍须另行批准。未改变原有生产批准政策。

## 真实限制与上线前待办

1. Google OAuth/站长subject和统计盐值需独立Preview Secret；无法从代码生成用户的Google凭据。翻译供应商尚未被批准，保持关闭。
2. 搜索是可解释的词典+全文搜索，不是任意语言的语义搜索；当前词典覆盖11个基础概念，需用真实需求继续扩展。中文未知短词回退会扫描候选原文，规模增大前需基准测试/专门分词索引。排序当前使用有界OFFSET（最多10000），后续按量改稳定游标。
3. 楼中楼数据关系完整；页面缩进封顶但保持回复对象链接。通知列表返回最近100事件；没有邮件/推送。状态展示与留存/聚合策略仍可迭代。
4. 流量统计使用浏览器随机HttpOnly访客cookie，经每日盐值摘要后保存；同人多设备计多UV，机器人判断和五分钟峰值是估算。为低流量开发阶段直接写D1小批事务，限制每访客300PV/天及全站10000PV/天；大规模需异步汇总。匿名访客摘要保留不超过约2天，社区聚合仍需最终留存政策。
5. 无真实用户数据，未启用公开注册运营。正式隐私政策、年龄要求、申诉/审计留存期、第三方文本处理告知、独立语言URL/SEO、生产备份恢复演练和真实手机验收需在正式上线前完成。
6. 自动化测试不能代替远程预览D1和Google/翻译供应商的真实联调；实际构建、API健康及缺失配置应以交付报告为准。

## 远程开发预览验收

- 首次实现提交：`204ddc21abf8d08fd057cca46a048adf924e8e66`。
- Cloudflare GitHub check：**success**，Build ID `c1076802-4c80-4daf-ba9a-c4b1ef61a7fc`。
- 浏览器打开指定远程预览：新版多语言论坛首页和空列表正常，分类词条读取成功。
- `/api/health` 实际返回 `status=ok`、`databaseReady=true`、`version=0.2.0-preview.1`；测试库结构已初始化。
- `googleConfigured=false`、`translationConfigured=false`、`analyticsConfigured=false`；不能声称真实Google登录、外部翻译或流量采集已经启用。
- 首次实现仅更新feature分支与预览D1；没有提交/合并main，没有生产D1写入，也没有复制生产数据。
- 验收截图：[开发预览](assets/development-preview.jpg)。

最终回归补充：管理员隐藏的内容经作者编辑后进入待审核，不能通过编辑绕过审核重新公开；专门回归测试通过。

## 导入功能增量开发（2026-11-06）

用户授权实现开发免密导入与“未知用户”系统账号。新增 `src/import.ts`、迁移 `0003_import.sql`，预览新增专用 `IMPORT_DB` 测试库绑定；生产无该绑定且服务端默认拒绝。支持单帖、单回复、批量嵌套导入、相同请求去重、失败原子回滚；系统账号不能登录或拥有管理角色。TypeScript与25项集成测试通过；本地迁移成功。远程构建success（Build ID `80d3bb81-cfe3-413a-b540-d5183f4ee9d9`），账号已创建，单帖／跟帖／批量嵌套／重试及并发去重实测通过；浏览器已确认作者名和回复结构。代码提交 `1df625b0209928db6e7e84d8d8b3093ea32be27b`。详见[接口文档](import-api.md)。以上初版16项测试及旧代码提交为历史验收，不是本次最新版本。

本次预览实测保留3篇虚构测试帖和3条回复。生产关闭测试在隔离Worker运行，未向正式站发写请求；未修改main或生产D1。Google登录凭据仍未配置，普通用户真实登录验收不在本次完成范围；导入接口独立于Google登录。

## 移动端开发环境标识与登录退出入口（2026-11-07）

- 开发分支 `feature/v1-community-build-20261106`：修复 `public/styles.css` 在窄屏隐藏环境标识的问题；简体中文环境标识改为“开发环境”；`/api/health` 提供环境字段以避免生产界面显示开发标识。
- Google 登录后可点击右上角头像展开菜单，访问“个人中心”“账号与隐私”“退出登录”；个人中心标题旁也有显式退出按钮。移动端窄屏菜单和开发标识使用适应性布局，菜单可通过点击外部或 Esc 关闭。
- 点击退出后调用既有 `POST /api/auth/logout`，撤销本站 D1 会话、清除 Cookie 和前端用户态，并返回公开首页；不会退出浏览器中的整个 Google 账号。
- 退出功能集成回归测试覆盖 Cookie 清空、会话撤销、重复请求及退出后读取用户为空；GitHub Actions `npm run verify` **success**，最终代码提交 `e858a23a1b7aec653cee982ce0dae2d2a197f124`，检查 [42362127680](https://github.com/119shenhao/spine-community/actions/runs/42362127680)。
- **未实测 Cloudflare 线上浏览器效果**：当前访问工具无法打开开发预览地址，应以预览构建成功后的手机实际验收为准。未执行 D1 迁移、未更改生产数据、未授权本次合并生产代码。

## Google OAuth 客户端 ID 环境隔离与防回归（2026-11-07）

- 用户分别提供了开发预览与正式生产使用的 **OAuth Client ID**（Client ID 是公开标识，不是 Client Secret）。
- 在开发分支 `feature/v1-community-build-20261106` 的 `wrangler.jsonc` 固定绑定：生产顶层 `vars.GOOGLE_CLIENT_ID` = `294338107553-k5bts5abj3tg85lt82moelv40sph3tuh.apps.googleusercontent.com`；开发预览 `previews.vars.GOOGLE_CLIENT_ID` = `294338107553-bht5pr4qa112e9knbst517b0mvb9pus9.apps.googleusercontent.com`。
- `GOOGLE_CLIENT_SECRET` 仍必须分别用 Cloudflare 加密 Secret 配置；绝不提交到 GitHub。代码测试会校验两个 Client ID 均非空、互不混用且 Secret 未写入明文配置。
- 修复针对近期开发预览因 `GOOGLE_CLIENT_ID` 运行时变量缺失而不显示 Google 登录按钮的问题。开发代码与检查提交 `8a2f10f1377511fba3534de7295640139a2832b9`。Cloudflare Worker Preview 构建已成功（Build ID `c0556985-1868-48e5-af57-fba423255031`，对应提交 `8a2f10f`），GitHub Actions `npm run verify` 通过；受当前环境 DNS 限制，尚无法读取远程 `/api/health` 以独立确认运行时 `googleConfigured=true`。
- **重要：正式站尚未执行本次配置部署。** 顶层生产 ID 当前保存在开发分支，等正式发布审批后随代码部署至生产；不得为添加 ID 单独合并/发布旧生产代码或误触发生产 D1 变更。本次未触碰生产 D1。

## 帖子点赞、收藏、关注无整页刷新（2026-11-07）

- 按用户手机端反馈，修复点赞、取消点赞、收藏、取消收藏、关注与取消关注请求成功后调用全局 `render()` 导致帖子详情和评论区重新加载、页面跳动的问题。
- 开发分支 `feature/v1-community-build-20261106`：新增 `public/interaction-ui.js`，使用服务器确认的 `active` 和 `like_count` 更新对应按钮、ARIA 状态与前端缓存；无需重新获取帖文与评论。收藏、关注在状态更新后显示轻量提示。在个人中心的“我的收藏”或“关注的帖子”取消相应操作后，局部移除该卡片。
- 改动仅涉及前端代码和测试，无 D1 表结构迁移或正式环境写操作。前端提交 `16f10b6a33efd60ec09e4047954a748f70d7faef`；新增测试的最终提交 `d4908a9af468f22c2aeafd5c6a7f97f53942b197`。
- GitHub Actions [verify](https://github.com/119shenhao/spine-community/actions/runs/42366425368) 结果 `completed/success`；Cloudflare Workers Preview 构建 `completed/success`（Build ID `5540170f-a208-4a17-b659-5a3e014a34b9`）。
- 当前执行环境无法访问 Worker Preview URL，尚未完成真实手机点击与滚动位置的人工验收；只在开发预览部署，不把这次程序代码推送到生产 `main`。

## 回复发表、编辑后仅局部更新（2026-11-07）

- 用户在移动端反馈：帖子回复、楼中楼发布后整页重新加载并滚动跳动，要求提交后直接显示新回复并定位到它。
- 开发分支 `feature/v1-community-build-20261106`：`src/content.ts` 的新增／编辑回复 API 保持原路由与鉴权，额外返回可直接渲染的完整评论、审核状态和由 D1 触发器维护的最新主帖回复数；不增加数据库迁移。
- 前端新增 `public/reply-ui.js`，`public/app.js` 在创建普通评论、楼中楼、楼主进展或编辑回复成功后更新内存数组与对应评论 DOM，局部修正回复计数和进展摘要；不调用整页 `render()`，不修改路由哈希。发表成功后关闭弹窗／清空输入框，滚动聚焦新增回复并在 `public/styles.css` 中短暂高亮。待审核、拦截状态继续按服务端状态显示，不误增加公开回复数量。
- 新增三组回归测试，覆盖发表普通／楼中楼／进展、编辑的完整 API 数据、局部状态合并及不再整页刷新的前端行为。
- 原交互功能提交 `f0977d7613d4cb8348b7ce6c813a2f4a5870e99a`，随后补修 `加载更多` 时按照评论 ID 去重，最终开发代码提交 `b511c721d19093131fb787fac1a371cadfd2560f`。原提交的 GitHub Actions [verify](https://github.com/119shenhao/spine-community/actions/runs/42367153766) 已通过；最终补修提交的 [verify](https://github.com/119shenhao/spine-community/actions/runs/42367264552) 也已通过（`completed/success`）；其 Cloudflare Preview 构建也已通过（Build ID `a8bf6786-03a4-41e2-b96a-d3d103f5c3c9`）。Cloudflare Workers Preview 构建已完成并显示 **success**（Build ID `513b7027-7465-4a30-ada3-3f6a24c40272`）；手机端发布、滚动及审核提示的实际交互仍待用户现场验收。
- 无生产 D1 写入、无 schema 变化，未将这次程序代码合并入生产 `main`。
