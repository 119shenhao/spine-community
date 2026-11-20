# 颈椎腰椎论坛接入统一身份认证中心

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
