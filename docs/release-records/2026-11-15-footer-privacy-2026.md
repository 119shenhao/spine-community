# 2026-11-15 页脚隐私与社区规则 2026：生产发布记录

## 发布结果

用户明确授权执行「发布新版本从开发环境到生产环境」。本次完成前端页脚文案变更，并通过 Cloudflare 生产构建、精确资源版本和生产健康验收。

- 开发分支：`feature/v1-community-build-20261106`，开发提交：`fa13635fd738e16c2ca186808b59645bcb5e9ad9`。
- 发布前生产 main：`926eb50c320598e11460c9d989bb94adaa8168cb`。
- 发布候选：`release/spine-20261115-footer-2026`，`d5a8e96cbfe056b8c816a25b00db742e4b153e34`。
- [生产 PR #35](https://github.com/119shenhao/spine-community/pull/35) 已 squash 合并。
- 生产代码提交：`fc66fb8cb46f4c2d1ec81ddea01e1d9ab058f2df`。
- 正式网站：https://spine.nbn369.com/ 。

## 本次范围

只修改 `public/app.js` 的页脚 `/privacy` 链接显示内容，将原文 `${t('privacy')}` 改为 `${t('privacy')}2026`（简体中文为「隐私与社区规则2026」）。不改写其他位置的共用语言文案，不改变链接目标、样式、SEO、业务处理、权限、登录及翻译代码。基于最新 main 生成发布分支，避免以整条开发分支覆盖生产分支上的现有功能。

## 数据库与隐私边界

逐一核对开发与主分支 `migrations/v1/` 全部 20 个版本 SQL 文件：文件名和 blob SHA 一致，没有本次新增或修改的迁移，因此不执行生产 D1 SQL。未同步开发帖子、回帖、用户或测试数据；未修改 D1/R2、生产密钥、环境变量及配额。

## 验收记录

- [开发分支自动检查 #43700837109](https://github.com/119shenhao/spine-community/actions/runs/43700837109)：success。
- [开发分支语言健康检查 #43700837107](https://github.com/119shenhao/spine-community/actions/runs/43700837107)：success。
- [发布候选 CI #43701300928](https://github.com/119shenhao/spine-community/actions/runs/43701300928)：success。
- [生产 main CI #43701383733](https://github.com/119shenhao/spine-community/actions/runs/43701383733)：verify 与 Production assets smoke check 均 success。
- Cloudflare Workers Builds `spine-community` Production 构建 `ee9dd547-ecc7-49c5-b73e-ec567f3cc8d8`：success。
- 生产资源烟雾验证日志：首次收到旧前端版本 `fb410795c4775a06`，随后核实线上部署的精确前端资源版本 `45d6f37c2a4d45de` 与本次 main 源码一致。线上 `/api/health` 返回 `status=ok`、`environment=production`、`databaseReady=true`。原有 Safari 3 行摘要样式、JS 单词截断防护、生产站真实浏览器导航回归也通过。
- 本次没有使用真实手机手工确认页脚展示；检查依据为 GitHub 精确代码 diff、Cloudflare 构建和真实线上资源版本烟雾验证。

若本次发布后页面呈现旧内容，先硬刷新/清理页面缓存，不应更改生产 D1。
