# 颈椎腰椎论坛接入统一身份认证中心

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
