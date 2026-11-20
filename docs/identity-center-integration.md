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
