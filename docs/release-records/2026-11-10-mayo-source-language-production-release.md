# Spine Community — Mayo 长帖原文语言识别版本发布（2026-11-10）

## 结论

- 用户当次授权：「发布新版本从开发环境到生产环境，让生产环境的代码变成最新的」。
- **代码发布已完成**，GitHub PR [#21](https://github.com/119shenhao/spine-community/pull/21) merged。
- 来源开发分支 `feature/v1-community-build-20261106`，选定源码 SHA `8884c1d6c73f992965a7d5287198ed06d6941884`。
- 以当时 `main` `07b80769060da008582d99d52ed691da341e77fc` 为基础创建 `release/spine-20261110-mayo-language-current`；发布候选 SHA `9bd94dfd79e02fbf1cd428706509a03b8abaae08`。
- 生产 merge SHA：`18c0bedaf30c07ecc6defaa0df416b6232e0ac36`。
- [Cloudflare Workers Production Build](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/bccc6784-4914-4515-9075-08c7fb65eaeb) （ID `bccc6784-4914-4515-9075-08c7fb65eaeb`）对应生产 merge commit 的 GitHub Checks 显示 **completed/success**，完成于 2026-11-10T15:31:14Z。
- 开发来源 SHA 的 GitHub Actions [feature checks #42844307964](https://github.com/119shenhao/spine-community/actions/runs/42844307964) 为 **success**；发布候选的 Cloudflare Workers Builds Check 同样成功。

## 精准发布清单

发布分支与 `main` 的 PR diff 仅包含 7 个文件：

1. `src/collect-long.ts` — Mayo 长帖正文、回复独立检测原文语言，保存当前版本语言验证证据，不再把所有内容硬编码为英文。
2. `src/admin.ts` — 历史语言辅助管理接口严格限定 `APP_ENV='preview'`，**不允许生产调用**。
3. `src/historical-language.ts` — 证据不充分时保留已有合法旧标签或 `und`，不凭空默认英文。
4. `public/app.js` — 只在开发预览中显示历史回填的交互入口；生产管理不开放。
5. `public/language-admin.js` — 预览管理界面，文案已去除“未知语言暂用英文”的旧表述。
6. `migrations/preview-only/0003_mayo_source_language_metadata.sql` — **仅供开发预览的** Mayo 暂存表添加字段；并未对正式 D1 应用。
7. `tests/community.test.mjs` — 回归覆盖 Mayo 多语言、长帖回复、历史回填的权限与安全逻辑；不包含未发布的离线审计工具测试。

开发分支中的 fastText 研究/审计工作流、生产 D1 Secret、临时采集探测脚本等没有随本次 PR 发布。

## 数据库与配置隔离

- 发布前精确比较了开发/正式两个 Git 树，所有 `migrations/v1/*.sql` 完全一致；新迁移仅在 `migrations/preview-only/`，因此本次跳过生产 D1 写入。
- 先前生产 `Production D1` inspect [#42828128287](https://github.com/119shenhao/spine-community/actions/runs/42828128287) 已成功；未创建新生产迁移请求，也未执行 `apply`。
- `wrangler.jsonc` 保留 `main` 原文件，`assets.html_handling='none'`、Cloudflare 生产/预览绑定及 `keep_vars` 均没有被 feature 分支覆盖。
- 保留原有 `main/docs/` 文档、AGENTS.md、生产 GitHub Actions 工作流和 Google 网站验证文件。
- **不包含**从开发库同步帖子、回复、用户、点赞、翻译缓存等业务数据；历史帖子语言标记保持原值，没有运行 fastText 二次生产修复，也没有更改生产翻译开关。
- 生产采集/导入功能的既有权限限制没有被解除；Mayo 长帖代码随版本进入生产构建不意味着生产环境开放采集接口。

## 验收边界与后续查看

- GitHub 合并和 Cloudflare 正式构建 Check 已验证为 success。
- 本次可用网络工具打开 `https://spine.nbn369.com/api/health` 与预览站健康 URL 时返回不可访问；**因此不能宣称已独立核对生产 HTTP 200、databaseReady 或 Google 登录/翻译 UI**。这不是确认线上故障。
- 可进一步在能访问正式域名的环境验证：主页、真实公开帖 HTML、`/robots.txt`、`/sitemap.xml`、`/api/health`，以及登录后正常发帖与回复。不应拿真实患者数据做测试。
- 回滚策略：优先回滚 Cloudflare Worker 至先前兼容版本；没有新增生产 D1 schema，也无需恢复数据。生产 D1 Time Travel 不得未经授权直接执行。
