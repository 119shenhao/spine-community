# 单一 Google 登录按钮与每次账号选择（2026-11-21，开发分支）

## 用户确认体验

- 登录页仅展示一个“使用 Google 登录”按钮，不再另外放置“切换 Google 账号”按钮。
- 每次主动点击该按钮，必须打开 Google 官方账号选择界面，能够选择原 Google 账号或使用其他账号；不允许因 Identity Center 仍有 SSO 会话而直接回到论坛登录完成。
- 不展示 Identity Center 的 Provider Chooser 中间 HTML 页面。认证中心仍是统一身份认证的唯一入口。
- 论坛退出仅退出论坛自身的会话，不强行退出 Google 和其他论坛。

## 实现及安全边界

开发分支 `src/auth.ts` 的 `/api/auth/identity` 保持独立 state、nonce、PKCE S256、精确 callback、一次性 proof cookie、原页面 return_to 与既有 Google `sub` 的旧账号绑定；授权请求新增 `prompt=select_account`，同时保留 `provider_hint=google`。

Identity Center `dev` 的 `/oauth/authorize` 验证合法 client/redirect/state/nonce/PKCE；收到 `provider_hint=google&prompt=select_account` 时跳过已有中心会话的自动授权，直接请求 Google，传递 `prompt=select_account`。Google 官方处理账号选择和输入新账号；本站不采集 Google 密码。取消/失败、账号归属、用户 ID、帖子、回复、收藏及论坛管理员角色仍采用原有逻辑。

## 验收与发布边界

开发代码和自动测试仅证明必要授权参数已传递。还需检查开发线上论坛 → Identity Center → Google 两次跳转，在已存在 Center SSO Cookie 时仍访问 Google 选择页；手动用两个 Google 账号确认独立用户、登录返回正确并能切回旧账号。

**生产 `main` 尚未按此需求发布**；上线须从开发验证后定向挑选改动、通过 CI 和线上检查，不能把大规模功能分支整体并入主分支，也不能修改生产 D1、密钥或论坛业务内容。以后新网站接入时沿用 Identity Center 的账号选择规范。
