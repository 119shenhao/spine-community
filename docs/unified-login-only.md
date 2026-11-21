# 统一身份认证：论坛唯一 Google 登录入口（2026-11-21 确认）

## 需求与权限
生产和开发论坛登录按钮只允许走各自环境的 Identity Center（开发 `spine-community-dev`、生产 `spine-community-prod`）。不得再公开“直接使用 Google 登录”后备入口。原 Google 直连的 `/api/auth/google` 和 `/api/auth/callback` 对任何方法返回 HTTP 410 + `direct_google_login_disabled`，不创建会话、不完成 token 交换；已存在论坛会话和退出登录保持原行为。若中心配置缺失，页面显示暂不可登录，不悄悄回退到原直连端点。

## 旧用户兼容
通过经过验证的签名身份中心 ID Token 中的 `spine_google_sub` 与论坛现有 `auth_identities(provider='google')` 精确匹配，继续使用旧论坛 user ID。帖子、回复、收藏和管理员角色不迁移、不重建、不覆盖；不以昵称或邮箱匹配身份。中心会话与论坛会话仍独立；首版不做撤销跨系统即时联动。

## 部署纪律
1. 首先在 `feature/v1-community-build-20261106` 开发并验证新增/旧路径测试。
2. 开发 CI、Worker 预览部署、旧端点 410 且不下发 Cookie、统一身份认证配置检查通过后，再定向挑选相关文件从生产 `main` 发布，**不得整体合并开发分支到生产**。
3. 生产不得同步开发库用户/帖子；保留 `keep_vars`、Cloudflare Worker Secrets、生产认证中心应用、D1 及原 Google Secrets，禁止明文入仓。旧 Google Secret 可在未来确认没有依赖后单独清理。
4. 生产自动验收 `/api/me.identityConfigured=true`、旧路由 410、无效统一回调 401、生产健康与前端资源，以及原账号内容/角色的回归测试。真实 Google 账号的完整浏览器回跳需要用户端另行验收，不得将自动测试写成已人工验证。
5. 如后续系统不可用，不自动开放旧 Google 直连，必须先排查认证中心和生产配置，经明确批准后调整方案。

## 2026-11-21 执行记录
- [开发 PR #40](https://github.com/119shenhao/spine-community/pull/40)
- [开发 Worker 预览专项验收](https://github.com/119shenhao/spine-community/actions/runs/44874406718)
- [完整开发 CI](https://github.com/119shenhao/spine-community/actions/runs/44874456738)
- [生产定向发布 PR #41](https://github.com/119shenhao/spine-community/pull/41)
- [生产登录端点检查](https://github.com/119shenhao/spine-community/actions/runs/44874717297)
- [生产前端和功能检查](https://github.com/119shenhao/spine-community/actions/runs/44874717236)

正式版的详细开发/生产历史另见 `main/docs/identity-center-integration.md`。
