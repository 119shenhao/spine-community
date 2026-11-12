# 2026-11-12 阅读舒适设置正式发布记录

## 发布范围与依据

- 用户明确指令：“发布新版本从开发环境到生产环境”，且已在开发预览确认阅读设置效果。
- 源代码功能分支：`feature/v1-community-build-20261106`，开发验收提交 `a2f6350bc0cc8061a05277159674037ac66f1680`，自动测试成功：[Actions #43158870818](https://github.com/119shenhao/spine-community/actions/runs/43158870818)。
- 生产以当时 `main`（`5ab90e8e7b7a720cd923873533f02e26259af3e1`）为基线制作最小候选；没有直接合并长期分叉的 feature 分支，避免覆盖生产已存在的移动摘要相关修复。
- 候选分支：`release/spine-20261112-reading-comfort`；候选 SHA：`1947dd5349a3c6e44ffd767c93fa3694eff7b2d0`。
- 正式合并 [PR #30](https://github.com/119shenhao/spine-community/pull/30)；生产代码提交 `f7006a626ccbee464818a75ccafc3cf1a1fe3487`（squash merge）。

## 变更内容

仅四个文件：`public/app.js`、`public/styles.css`、新增 `public/reading-preferences.js`、`tests/community.test.mjs`。

- 个人中心顶部增加阅读设置入口；未登录游客同样可进入并使用，不需要 Google 登录。
- 提供标准浅色与柔和暖色配色、三级字号调整；浏览器本地存储偏好，不向生产 D1 写个人阅读设置。
- 登录后账户下拉菜单保留快捷入口；不改变论坛页面布局和既有论坛业务行为。
- 保留生产已上线的移动端三行摘要限制及英文摘要保护逻辑。

## D1 数据安全

- 发布前逐一核对开发与 `main` 的 `migrations/v1` 共 16 个正式 SQL 文件，blob SHA 全部一致。
- 本次没有 SQL 文件变更，不新增或修改生产 D1 结构，不执行生产 D1 `apply`，不进行生产库数据复制、清理、覆盖或回滚。
- 开发库的帖子、回复、账号与其他业务数据不属于“发布新版本”，只允许独立的“同步帖子”任务处理。

## 验收

1. [PR 自动验证 #43159769678](https://github.com/119shenhao/spine-community/actions/runs/43159769678)：`verify` 成功；Cloudflare 候选构建检查成功。
2. [生产 main Actions #43159909941](https://github.com/119shenhao/spine-community/actions/runs/43159909941)：`verify` 成功；Production assets smoke check 成功。
3. Cloudflare 正式构建对生产提交 `f7006a...` 的 GitHub check 结果为 `success`（构建详情：`https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/771292e0-47a2-4ec9-87a5-b59c413e5f7b`）。
4. 首次生产 smoke 于构建成功之前检测的旧前端版本为 `731105ec10b38c0c`，因此不能作为新版本已上线的证据。**在 Cloudflare 新构建成功后**，主动重跑同一生产 smoke（Actions #43159909941，attempt 2），日志显示线上版本已变为 `0b44310ba08ba163`，且移动端摘要保护和生产 `/api/health` 数据库就绪检查成功。
5. 注意：本次重新执行的线上 smoke 只覆盖旧摘要保护与健康检查；阅读设置功能的自动验收来自 PR 的新增单元回归测试、已确认的预览体验及成功发布的代码构建。未取得浏览器内逐项人工生产交互的独立验收结论。

## 后续复盘要求

- 长期开发分支与 main 分叉时，不要直接整体 merge；必须从最新 main 建 release 候选，限量移植本次获批的改动，核对 PR 文件清单。
- 生产部署验收必须等待 Cloudflare **对应发布 SHA** 构建成功，再做真实生产 smoke；之前运行的成功 smoke 不能证明新代码已部署。
- 生产上线结果要区分：GitHub 合并成功、Cloudflare 构建成功、生产前端版本更新、具体功能浏览器交互验收，四者不能互相替代。
