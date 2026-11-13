# 2026-11-13 — 帖子分享（13 平台）生产发布记录

## 发布状态

- 结果：**已合并生产，线上前端资源版本吻合；生产健康与回归检查通过**。
- 用户当次授权：「执行新版本发布从开发环境到生产环境」。
- 开发源分支：`feature/v1-community-build-20261106`，审核版本 `1d6f1cd6943a0ae5724192722ecd2edf7196e4cb`。
- 发布分支：`release/spine-20261113-share-social-1d6f1cd`，候选 SHA `be30125fa9b4439a59ab4e47ab70bf8e605071d9`。
- 生产合并 PR：[PR #32](https://github.com/119shenhao/spine-community/pull/32)，合并提交 `846a3a7738fcbc93c0f0117754d79a1b5fb5d29a`。
- PR 检查：[GitHub Actions #43360144386](https://github.com/119shenhao/spine-community/actions/runs/43360144386)，`npm run verify` 成功。
- 正式站检查：[GitHub Actions #43360240200](https://github.com/119shenhao/spine-community/actions/runs/43360240200)，首次生产烟雾检查虽然成功，但当时网站仍返回旧资源版本 `6095b81bb2a46347`，故没有直接当作发布成功。
- 复查：复用上述 Actions 的 **Production assets smoke check** 单项重跑（attempt 2，job `131673264817`），实际线上返回 `ea298af4ed4d1d92`；与从合并提交全部 19 个 `public/*.js|css` 文件按 `scripts/prepare-build.mjs` 算法计算出的预期修订 `ea298af4ed4d1d92` 完全一致。
- 复查同时验证实际站点 `/api/health` 为 `status=ok`、`environment=production`、`databaseReady=true`，并核验移动端三行摘要及 `feed-preview.js` 生产资源完整。

## 变更范围

1. **帖子详情页底部（评论区上方）**增加分享按钮，只对已发布帖子展示。
2. 优先使用移动系统分享菜单；取消或浏览器不支持时使用备用图标菜单。
3. 弹窗取消中国/国际分组及分组标题，图标按 Facebook、X、Reddit、LinkedIn、WhatsApp、Telegram、Bluesky，接着微信、QQ、抖音、B站、微博、QQ空间的固定顺序排列。
4. QQ、微博、QQ空间跳转至网页分享入口；微信、抖音、B站使用明确的复制链接反馈，不伪造未经验证的直接深链分享；所有平台 SVG 图标均由本地 JS 输出且有无障碍标签。
5. 保留 8 种界面语言，分享操作不触发页面整体刷新。

**安全边界：** 只改动 `public/app.js`、`public/share-ui.js`、`public/styles.css`、`public/i18n.js`、`public/i18n-zh-tw.js` 和 `tests/community.test.mjs` 这 6 个文件。保留此前生产分支已修复的 Safari 摘要与其他功能。开发/生产正式迁移目录的 16 个 SQL 文件 SHA 一致，故本次没有生产 D1 迁移、没有 D1 写入、没有导入开发帖子/回复、没有修改生产变量或密钥。

## 经验与后续发布门禁

**单纯的「GitHub Actions 绿灯」不等于「新代码已在 Cloudflare 生产站部署」。** 本轮首轮烟雾检查通过时，线上仍为旧内容版本。只有等线上 `/_app/{revision}/` 的修订与此代码快照重算值一致，且健康检查正常，才能宣布生产发布成功。后续发布建议把**精确的资源修订匹配**纳入现有 Production assets smoke check，而不只校验历史功能存在；不需要另建工作流。若存在额外前端交互场景，应另行进行真实浏览器点击验收。
