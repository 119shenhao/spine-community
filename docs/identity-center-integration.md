# 颈椎腰椎论坛接入统一身份认证中心

> **最终验收更新（2026-11-21）**：论坛生产 `https://spine.nbn369.com` 已统一接入 `https://idcenter.nbn369.com`，只保留单一「使用 Google 登录」入口；旧 Google 直连登录接口返回 HTTP 410。开发 CI/在线验收、生产自动验收及用户真实登录与原账号、帖子、回复、收藏、论坛管理员权限核对均已完成，**用户明确确认验收通过**。下文“正式站尚未切换”“保留直连 Google 作为回退”等为历史阶段快照，最终结论以本节和文末 2026-11-21 实际验收为准。以后新网站接入请从 [Identity Center 统一接入手册](https://github.com/119shenhao/identity-center/blob/main/docs/NEW_APP_INTEGRATION_GUIDE.md) 开始。

## 当前状态

开发预览已启用统一登录。线上 Worker 凭证、无效授权码和重复回调检查已通过。正式站尚未切换。用户在开发预览反馈退出后重新使用 Google 登录成功，并在后台找到新增的有效会话。该结果来自用户浏览器反馈，旧论坛用户 ID 和管理员权限仍需单独核对。

## 已确认范围

- 先在 `feature/v1-community-build-20261106` 与认证中心 `dev` 联调网页版 Google 登录。用户已批准开发和开发环境验收。正式站切换、生产部署与生产 D1 写入另行批准。
- Identity Center 只验证身份。论坛继续使用自己的用户 ID、权限与会话。旧账号用经验证的 Google `sub` 精确匹配，绑定统一身份 ID 时保留帖子、回复及收藏。邮箱和昵称不参与匹配。新账号同时保存 Google 身份，供直接 Google 登录回退时复用。
- 论坛在后端交换一次性授权码，使用 PKCE S256 和浏览器绑定的 OAuth state，校验签名、签发者、受众、有效期与 nonce。登录完成或取消后回到同站原页面。
- 网页接入使用 `spine-community-dev`，Cloudflare Secret 名称为 `IDENTITY_CLIENT_SECRET`。生产环境需要独立应用、签发者和密钥。现有直接 Google 登录作为回退。
- 首版退出仅结束当前论坛会话，认证中心会话独立。

## 开发与验收记录

### 2026-11-20 · 范围与开发客户端

开发客户端与精确回调已在 `identity-center-dev` 登记并回读，客户端保持停用。论坛 OAuth 代码、老账号映射、应用密钥和浏览器联调待完成。

- 认证中心签发者：`https://dev-identity-center.119shenhao.workers.dev`
- 已登记回调：`https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/api/auth/identity/callback`
- [开发 D1 配置回执](https://github.com/119shenhao/identity-center/actions/runs/44735834152)

### 2026-11-20 · 双仓库代码与本地测试

- [认证中心身份签发](https://github.com/119shenhao/identity-center/commit/ecb5b42b594f82670f7624d0e454aec45071b674) · [认证中心取消授权回调](https://github.com/119shenhao/identity-center/commit/078dd63ccd3ace720c53dc93d72178352a936f49)。限定 Google 主体字段的客户端、回调和令牌类型。24 项测试与 D1 schema 检查通过，认证中心预览构建通过。
- [论坛登录接入](https://github.com/119shenhao/spine-community/commit/28887ae1768e00e1908bf1336cc9bac7b5bb7362)。独立 OAuth 状态表、用户映射唯一约束、原页面回跳和会话复用已实现。验证了旧用户的帖子、回复、收藏、管理员权限，普通新用户、直接 Google 回退、重复或冲突绑定、取消退出和非法回跳拦截。TypeScript 检查和 151 项本地测试通过。
- 论坛预览构建负责应用 `0100_identity_center.sql` 到独立预览 D1。上线证据、机密配置和真实 Google 浏览器验收另行记录。

### 2026-11-20 · 开发预览部署与跨服务联调

- 两个 Cloudflare 开发预览均构建成功。[论坛 Cloudflare 构建](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/previews/feature-v1-community-build-20261106/builds/a0f66d16-1d99-439c-8540-53e89f5143a7) · [论坛 GitHub CI](https://github.com/119shenhao/spine-community/actions/runs/44737893400) · [线上健康与新前端资源回读](https://github.com/119shenhao/spine-community/actions/runs/44737893405) · [认证中心 CI](https://github.com/119shenhao/identity-center/actions/runs/44737830648)。
- 用两个仓库的实际 Worker 请求处理器、隔离 SQLite 和模拟 Google 签名做了跨服务端到端测试。直接 Google 登录建立的测试账号，经统一身份登录仍保留原论坛用户 ID 和管理员权限。重复回调和登出后的旧会话均被拒绝。
- 已验证 D1 凭据访问论坛 Worker Preview 配置返回 HTTP 403。[权限检查](https://github.com/119shenhao/identity-center/actions/runs/44738311142)。改用论坛自身的预览构建部署权限保存应用机密，认证中心沿用原 D1 受控工作流登记单向校验摘要。真实 Google 浏览器登录仍需单独验收。

### 2026-11-20 · 开发应用启用与线上复测

- 论坛开发 Worker 已配置应用密钥，认证中心已启用 `spine-community-dev`，已回读精确回调及唯一有效摘要。论坛开发 D1 已验证迁移 `0100_identity_center.sql`，临时配置回执与脚本已清理。 [启用记录](https://github.com/119shenhao/identity-center/actions/runs/44739637845) · [清理提交](https://github.com/119shenhao/spine-community/commit/d964ae9a6b8c7be9d6097ca9a01937dc4b1e8aa3)
- 线上复测发现十六进制摘要与运行时格式不一致，已转换为 Base64URL。论坛开发配置启用 `global_fetch_strictly_public`，经公开 HTTPS 入口访问认证中心预览。 [摘要修正](https://github.com/119shenhao/identity-center/actions/runs/44749011105) · [论坛修正](https://github.com/119shenhao/spine-community/commit/e920e5a5a081d6ae6d0af9bb835f017c29abf88b)
- 复测确认论坛 Worker 凭证被接受，无效授权码与重复回调均被拒绝。浏览器已验证从论坛进入 Google 账号选择页。剩余验收需用真实 Google 账号完成回跳，并核对开发论坛的用户 ID 和权限。 [线上复测](https://github.com/119shenhao/spine-community/actions/runs/44749466919/attempts/2)

### 开发预览的会话行为与用户反馈

- 认证中心和论坛各自管理自己的会话。后台撤销指定中心会话后，论坛自身已签发的 Cookie 当前不会随之失效。退出论坛结束当前论坛会话。
- 开发预览通过统一认证中心重新登录会新建中心会话，旧记录保留「已撤销」状态。直接 Google 登录只产生论坛会话。
- 用户已反馈重新登录成功，并在会话管理中找到新的有效记录。独立的旧账号 ID 与管理员权限线上核对仍待完成。
- 认证中心开发后台已改为按会话创建时间倒序，每页 50 条，增加「创建时间」列。 [开发预览 CI](https://github.com/119shenhao/identity-center/actions/runs/44757425955)


## 2026-11-21 · 正式站接入执行记录（当前阶段）

用户已明确批准认证中心生产站 `https://idcenter.nbn369.com` 与论坛生产站 `https://spine.nbn369.com` 按现有已通过的开发联调方案接入，先部署兼容代码且保持新登录开关关闭，再验收并启用。

- 不使用与 `main` 分歧巨大的开发分支整体覆盖正式站。基于生产 `main` 单独建立 `release/identity-center-prod-20261121`，针对性移植 `src/auth.ts`、`src/core.ts`、`src/community.ts`、`public/app.js`、`public/i18n.js`、繁体中文词条、`migrations/v1/0100_identity_center.sql` 及旧用户绑定、PKCE、回调与错误路径测试。[发布 PR #36](https://github.com/119shenhao/spine-community/pull/36)。
- 生产配置中的 `IDENTITY_ISSUER=https://idcenter.nbn369.com`、`IDENTITY_CLIENT_ID=spine-community-prod`、`IDENTITY_REDIRECT_URI=https://spine.nbn369.com/api/auth/identity/callback`，以及 `IDENTITY_LOGIN_ENABLED=false` 已置于发布分支；`keep_vars: true` 仍保留，正式应用密钥不写入 GitHub。
- 针对论坛生产 D1 `spine-community-db` / `5919ff78-b8fc-46ab-85f0-01fe5e6a41b0` 的 [只读检查 44854412641](https://github.com/119shenhao/spine-community/actions/runs/44854412641) 通过，无历史迁移冲突。经预先记录 Time Travel 恢复点后，[生产迁移 44854655311](https://github.com/119shenhao/spine-community/actions/runs/44854655311) 成功，仅新增 `0100_identity_center.sql`；不复制或改写真实帖子和用户。
- 认证中心生产库已按受控工作流注册**停用**的 `spine-community-prod` 及唯一回调。[注册成功 44854594882](https://github.com/119shenhao/identity-center/actions/runs/44854594882)。认证中心生产 Worker 配置已加入仅限此应用和回调的旧 Google sub 关联参数。
- 生产 Secret 自动配置的权限检测已完成：论坛仓库令牌和认证中心仓库令牌调用 Cloudflare Worker Secret 列表接口均为 HTTP 403，故**尚未**创建/注入正式应用密钥，也**没有**启用认证中心论坛应用；不得把测试令牌复制到正式库，不能绕过权限把密钥写进代码或日志。
- 论坛 PR 的集成测试和浏览器检查通过的证据之一：[44854812323](https://github.com/119shenhao/spine-community/actions/runs/44854812323)。待发布 HEAD 继续核验。生产正式 Google 浏览器登录、Owner 管理员以及论坛真实账号绑定验收未完成。
- 本次保留原来的直接 Google 登录作为回退。即使代码发布，新统一登录入口也必须在正式凭据写入 Cloudflare Worker Secret、认证中心正式应用启用，并通过真实用户联调后才允许打开。

## 2026-11-21 · 论坛生产环境统一身份认证正式启用（自动验收通过）

用户批准复用开发环境已经验证的接入流程。现已完成生产应用密钥初始化、认证中心应用激活、论坛登录开关开启及部署后检查。

- 生产论坛：`https://spine.nbn369.com`；生产认证中心：`https://idcenter.nbn369.com`。仅 `spine-community-prod` 和精确回调 `https://spine.nbn369.com/api/auth/identity/callback` 被启用。
- 生产 Worker Secret：`IDENTITY_CLIENT_SECRET`，在论坛自身 Cloudflare Builds 中生成并安全注入，中心 D1 仅保存匹配的 SHA-256 Base64URL 摘要，明文未入 GitHub 或 D1。针对正式 `wrangler secret list` 命令的参数兼容问题修复并通过 [PR #38](https://github.com/119shenhao/spine-community/pull/38) 合并；[密钥回执验收 44869479321](https://github.com/119shenhao/spine-community/actions/runs/44869479321) 成功。
- [认证中心生产 OAuth 应用激活 44869665293](https://github.com/119shenhao/identity-center/actions/runs/44869665293) 成功；受控工作流核对论坛 D1 回执、认证中心生产 D1、精确回调和摘要一致后，仅启用 `spine-community-prod`。
- [生产启用 PR #39](https://github.com/119shenhao/spine-community/pull/39)（合并提交 `f43b1545e3bf633dbcca968a9cd202bd198ad61a`）：设置 `IDENTITY_LOGIN_ENABLED=true`，删除将一次性密钥初始化挂在每次生产构建上的逻辑，防止重复生成或轮换；保留 `keep_vars: true` 及原 `GOOGLE_CLIENT_ID` 与 Cloudflare 加密 `GOOGLE_CLIENT_SECRET`。
- [上线后统一登录检查 44869871878](https://github.com/119shenhao/spine-community/actions/runs/44869871878) 与 [生产功能/页面检查 44869871891](https://github.com/119shenhao/spine-community/actions/runs/44869871891) 全部成功：正式站 `/api/health` 正常、`/api/me` 的 `identityConfigured=true` 且 `googleConfigured=true`，不合法 OAuth 回调返回 `invalid_oauth_state`，网页及原有功能保持正常。
- **仍需真实用户端到端验收**：本人从生产论坛点击 Google 登录 → 经生产认证中心 → 返回论坛，验证旧论坛账号 ID、帖子/回帖/收藏及原管理员权限均不改变。自动检查成功不等于已完成此真实浏览器操作。认证中心自身的生产 Google 登录与 Owner 后台登录已由用户截图确认。
- 首版不做认证中心撤销会话后立即强制论坛本地 Cookie 失效，也不额外轮询 D1。现有论坛登录退出行为保留；此前用户已同意此范围。

## 2026-11-21 · 生产统一认证成为唯一 Google 登录入口（本次最新决定）

用户在生产论坛登录弹窗发现两条路径：上方“使用 Google 登录”经过身份认证中心并产生 `spine-community-prod` 会话，下方“直接使用 Google 登录”绕过认证中心，不在中心记录论坛应用会话。用户明确决定正式论坛**只保留统一认证登录**，开发测试成功后才定向发布生产。

- **开发阶段**：基于 `feature/v1-community-build-20261106` 建立功能分支并经 [PR #40](https://github.com/119shenhao/spine-community/pull/40) 合并。移除 `public/app.js` 中旧 Google 文本链接与 fallback UI：仅当 `identityConfigured=true` 时渲染通往 `/api/auth/identity?return_to=...` 的 Google 登录按钮；未配置则显示明确不可用说明，**不能悄悄回退直连**。
- **旧接口已禁用**：`GET/POST /api/auth/google`、`GET/POST /api/auth/callback` 均安全返回 HTTP **410**、`{"error":"direct_google_login_disabled"}`，无 Google 跳转、无 OAuth 授权码交换、无新 `auth_states` 或 `user_sessions` 写入。老浏览器/旧链接访问也被拒绝；原论坛会话、退出登录和已有用户数据不受影响。
- **开发验证**：[开发预览站认证专项验收 44874406718](https://github.com/119shenhao/spine-community/actions/runs/44874406718) 通过：`identityConfigured=true`、两个旧路径真实返回 410 且不设置 Cookie，错误/重复统一回调保护仍有效。[开发完整 CI 44874456738](https://github.com/119shenhao/spine-community/actions/runs/44874456738) 通过。期间旧 SEO 测试错误地强制要求旧直连入口，已同步修正；曾有一次无关的宽屏返回位置浏览器测试失败，重新运行通过。
- **定向生产发布**：开发/生产分支存在其他差异，**没有把整个开发分支合并到生产**。仅将已验证的 `src/auth.ts`、`public/app.js`、对应测试和生产烟雾脚本经 [PR #41](https://github.com/119shenhao/spine-community/pull/41) 合并生产 `main`（提交 `ca5512d08fa44032a0d193d78d30980d177816ba`）；[生产统一登录线上烟雾验收 44874717297](https://github.com/119shenhao/spine-community/actions/runs/44874717297) 与 [生产页面/功能验收 44874717236](https://github.com/119shenhao/spine-community/actions/runs/44874717236) 都通过。
- **配置与数据边界**：保留 `IDENTITY_LOGIN_ENABLED=true`、`IDENTITY_ISSUER=https://idcenter.nbn369.com`、`IDENTITY_CLIENT_ID=spine-community-prod`、`IDENTITY_CLIENT_SECRET` Cloudflare 加密绑定；`keep_vars=true` 不变。旧 `GOOGLE_CLIENT_ID` 和 Cloudflare `GOOGLE_CLIENT_SECRET` 配置暂保留但其直连论坛路由已经关闭，后续若确认无外部依赖可单独决定是否清理。此次无 D1 迁移、无用户、帖子、回复或收藏同步/覆盖。
- **旧用户与管理员保护**：继续按签名后的身份中心 `spine_google_sub` 对应论坛现存 Google subject 精确绑定，保留原论坛 user ID、帖子、回帖、收藏和角色；既有模拟端到端回归仍通过。此次生产上线自动检查**不等于**本人在新版页面用真实 Google 账号从头登录并逐条核对数据；真实用户可在 `https://spine.nbn369.com` 退出论坛后重新登录并核验。
- **以后固定规则**：新功能先 `feature/v1-community-build-20261106` 开发，开发 CI + 预览在线验收通过，再基于 `main` 定向挑选相关变更发布生产；不携带开发数据库内容、不覆盖生产 Secrets；生产 Smoke 与前端资产验收通过后记录结果。未经新的明确需求不得恢复旧 Google 直连登录入口或绕过认证中心。

## 2026-11-21 · 最终用户验收通过（结项）

- **真实浏览器验收**：用户先按生产站更新后的唯一「使用 Google 登录」入口操作，再亲自核对原论坛账号、帖子、回复、收藏及论坛管理员权限，明确确认「我验证过了，验收通过」。这条是用户反馈，不能当成额外 D1 审计；自动验收见下列 CI。
- **生产完成证据**：[密钥回执 44869479321](https://github.com/119shenhao/spine-community/actions/runs/44869479321)；[中心生产应用激活 44869665293](https://github.com/119shenhao/identity-center/actions/runs/44869665293)；[开发 PR #40](https://github.com/119shenhao/spine-community/pull/40)、[开发在线验收 44874406718](https://github.com/119shenhao/spine-community/actions/runs/44874406718)、[生产 PR #41](https://github.com/119shenhao/spine-community/pull/41)、[生产 Smoke 44874717297](https://github.com/119shenhao/spine-community/actions/runs/44874717297)、[生产功能检查 44874717236](https://github.com/119shenhao/spine-community/actions/runs/44874717236)。
- **登录现状**：只有 `/api/auth/identity` 与 `/api/auth/identity/callback` 被用于 Google 登录；旧 `/api/auth/google`、`/api/auth/callback`（GET/POST）返回 HTTP 410 `direct_google_login_disabled`，不能恢复第二个直连登录入口。Google Secret 的历史绑定可以暂时保留，但不意味着旧入口可用。`IDENTITY_LOGIN_ENABLED=true`，生产 `spine-community-prod` 与其独立 Secret 已启用。
- **账号与权限边界**：本站通过经验证的 `spine_google_sub` 精确关联旧 Google identity，不迁移/重建论坛本地 user ID，也不覆盖帖子/回复/收藏/业务管理员角色。认证中心 Owner 不自动赋予论坛管理员权限。论坛 Cookie 与中心会话独立，中心撤销后论坛不立即退出；这是用户已接受的非即时联动策略，不增加轮询和额外 Worker/D1 消耗。
- **后续开发规范**：开发环境（`feature/v1-community-build-20261106`）先实现、自动测试及预览在线验收；用户同意后从生产 `main` 基线**定向**发布已测改动；不全量合并分叉的开发分支、不同步开发用户/帖子/会话、不覆盖现有 Cloudflare Secrets；真实登录与旧账号/角色验收完成才结项。
- **复用范本**：本仓库 `src/auth.ts`、`src/community.ts`、`public/app.js`、`migrations/v1/0100_identity_center.sql` 和相应测试；完整新网站接入步骤详见 [Identity Center 接入手册](https://github.com/119shenhao/identity-center/blob/main/docs/NEW_APP_INTEGRATION_GUIDE.md)。其中 Spine 的旧账号映射字段是**定制特例**，其他业务应重新设计映射。

## 2026-11-21 · Google 登录不再展示 Identity Center 提供商选择页（新确认需求）

用户已在戒赌社区开发站实际完成 Google 登录并验收「点击论坛按钮后直接进入 Google / 或复用中心已有 SSO 会话，不再显示 `Identity Center / Choose a provider` 页面」的交互。要求在 Spine Community 同样采用这一体验，并作为所有新网站接入 Google / Identity Center 的固定规范。

**设计与安全边界**：

- 浏览器始终访问本论坛 `/api/auth/identity?return_to=...`；论坛服务端仍生成加密随机 state、nonce、PKCE verifier 并保存一次性状态，设置绑定 Cookie。
- 论坛在原有 `{IDENTITY_ISSUER}/oauth/authorize` 的全部参数上增添 **`provider_hint=google`**。中心只允许已启用且回调精确白名单匹配的 `web_confidential` 客户端直达 Google，仍要验证状态、PKCE、回调以及上游 ID Token。
- 既有 SSO Cookie 时中心直接签发授权码返回论坛；否则中心在设置事务证明 Cookie 后 302 到 Google，不渲染中间 HTML 页面。旧 `/api/auth/google` 等直连路由仍为 410，绝不能改为绕开中心的原生 Google 登录。
- 原有 `spine_google_sub` 的旧账户安全绑定机制、现有 user ID、帖子/回复、收藏、管理员角色、论坛自身 Cookie、退出登录逻辑均不变。
- 取消授权要安全回到论坛，错误回调、非法 state、跨环境 Client/redirect 不允许；未来其他 Google 网站必须按 `identity-center/docs/NEW_APP_INTEGRATION_GUIDE.md` 中的固定规范实现。

**实施记录**：代码已提交开发分支 `feature/v1-community-build-20261106`（`src/auth.ts` / `tests/community.test.mjs`），并通过 [开发完整 CI #44886973516](https://github.com/119shenhao/spine-community/actions/runs/44886973516) 和 [预览认证/语言健康 #44886973502](https://github.com/119shenhao/spine-community/actions/runs/44886973502)。中心通用支持的开发 CI 见 [#44887010782](https://github.com/119shenhao/identity-center/actions/runs/44887010782)。

**发布状态**：这一段只记录开发结果，**不得宣称 Spine 正式站已应用该改动**。生产必须从主分支单独挑选目标改动，通过 CI、线上预验收和用户既定批准流程后发布，不得合并开发分支其他业务功能，不涉及 D1 迁移或 Secret 轮换。正式上线和真实浏览器验收完成后追加记录。

### 本次正式版定向发布单（未合并）

- 已建立 [Identity Center 生产 PR #4](https://github.com/119shenhao/identity-center/pull/4)（Draft），[PR CI #44887221291](https://github.com/119shenhao/identity-center/actions/runs/44887221291) 通过；授权参数处理改为注册的 web_confidential 网站可用。
- 已建立 [Spine 生产 PR #42](https://github.com/119shenhao/spine-community/pull/42)（Draft），[PR CI #44887266128](https://github.com/119shenhao/spine-community/actions/runs/44887266128) 通过。
- 对比 `main` 后确认 Spine 生产 PR 仅 2 个文件：`src/auth.ts` 新增 3 行、`tests/community.test.mjs` 新增 1 行；认证中心 PR 仅 3 个文件；与开发分支的其他更改隔离。
- **尚未正式发布**：按原正式发布规范待明确批准后才合并这两个 PR，依次完成生产上线 HTTP 双跳验证与真实浏览器验收。
