# Spine Community 生产版本发布记录 — 2026-11-10

## 发布结果
- 发布任务：**发布新版本，从开发环境到生产环境**（由用户当次明确指令授权）。
- 代码来源：`feature/v1-community-build-20261106`，开发分支提交 `2e255ad97f0ef7388d1459c0e64f791e7ede79b2`。
- 发布候选：`release/spine-20261110-preview-2e255ad`，提交 `ddc97ce1f059d242c04bb246ab63e10e08136c5f`。
- 代码合并：[PR #9](https://github.com/119shenhao/spine-community/pull/9) 成功，`main` 生产合并提交 `036874213c0302f9ca0d817f9e8403b2867b518f`。
- 范围：应用程序、前端、测试、构建脚本、依赖、已审查版本化 SQL。沿用 `main` 现有文档、`AGENTS.md` 和生产 GitHub Actions 工作流；没有从开发库同步帖子、回复、账户、点赞等业务数据。
- GitHub 开发代码验证：[feature checks #42720096152](https://github.com/119shenhao/spine-community/actions/runs/42720096152) Success；前端版本资源及预览语言检查 [#42610279956](https://github.com/119shenhao/spine-community/actions/runs/42610279956) Success；R2 分离译文缓存检查 [#42611958315](https://github.com/119shenhao/spine-community/actions/runs/42611958315) Success。

## 生产数据库
- 目标 D1：`spine-community-db`，UUID `5919ff78-b8fc-46ab-85f0-01fe5e6a41b0`，与开发预览 D1 严格隔离。
- [发布前只读 inspect #42725690672](https://github.com/119shenhao/spine-community/actions/runs/42725690672)：Success。
- [生产迁移 apply #42725871703](https://github.com/119shenhao/spine-community/actions/runs/42725871703)：Success；日志显示以下八个迁移均为 ✅：
  - `0007_default_posting_language.sql`
  - `0008_public_projection.sql`
  - `0009_public_projection_checks.sql`
  - `0010_public_projection_operational_limits.sql`
  - `0011_public_projection_demand.sql`
  - `0012_automatic_translation.sql`
  - `0013_language_verifications.sql`
  - `0099_import_author_english_name.sql`
- 工作流在 SQL 写入前执行了 Time Travel 恢复点采集并成功；具体 bookmark 请查本次 Actions Summary，勿据本文件推测。
- [应用后只读 inspect #42726032188](https://github.com/119shenhao/spine-community/actions/runs/42726032188)：Success。inspect 日志未显示迁移异常；若需要明确查看 Pending 数组，应打开该运行的 Summary。

## Cloudflare 生产代码部署
- 已合并至生产分支 `main`，Cloudflare Workers Builds GitHub Check 在对应合并提交报告 **success**，结束时间 `2026-11-10T00:10:33Z`。
- [Cloudflare 正式构建](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/70e35fcb-e0d7-4819-9df8-1106f8a74fde) ID：`70e35fcb-e0d7-4819-9df8-1106f8a74fde`。
- 部署 Version ID：`79617740-18fb-424e-85de-ee369c95b96f`。
- 正式网站：https://spine.nbn369.com/ 。

## 尚未完成的线上运行时验证
- 本次会话的 HTTP/网络入口无法访问 `https://spine.nbn369.com/api/health` 及 workers.dev API：Web 访问工具返回不可访问，容器 DNS 解析失败。**这不是已证实的站点故障，也不是成功完成健康检查。**
- 因此未能直接核对生产 HTTP 200、`databaseReady=true`、Google OAuth、生产翻译/CDN 开关、用户登录与读写页面。Cloudflare Check 的 success 仅证实构建与部署检查成功。
- 需要在能够访问外部网络的环境做这些只读健康及 UI 验证；不要创建或更改真实患者数据进行测试。
- 生产环境是否开启 Azure 翻译、CDN 公共读取等运行参数仍以 Cloudflare 的实际 Secrets/Vars 为准；本次没有擅自添加或开启预览专用 Secret、采集或导入入口。

## 回滚说明
- 优先回滚 Cloudflare Worker 到此前兼容版本，视结构兼容性选择；生产 D1 Time Travel 回退可能丢失此后新增的真实用户数据，必须另行审核和授权，禁止直接自动回滚。

## 2026-11-10 生产翻译与 R2/CDN 环境变量恢复

- 用户提供生产/预览 Cloudflare Settings 截图，确认生产 `TRANSLATION_ENABLED=true`、`TRANSLATOR_REGION=eastus`、`TRANSLATOR_F0_VERIFIED_AT=2026-11-09T06:14:50Z` 已恢复且 `TRANSLATOR_KEY` Secret 已存在；此次未修改以上变量或 Secret。
- 生产相对于开发预览尚缺七个普通变量：`CDN_ZONE_ID`、`PUBLIC_CONTENT_ENABLED`、`PUBLIC_CONTENT_READS`、`PUBLIC_CONTENT_FALLBACK`、`PUBLIC_CONTENT_PAGE_SIZE`、`PUBLIC_TRANSLATION_SEPARATE`、`PUBLIC_TRANSLATION_DIRECT`。通过 [PR #11](https://github.com/119shenhao/spine-community/pull/11) 写入 `wrangler.jsonc`，沿用 `keep_vars: true`，不触碰密钥或 D1 数据。
- PR #11 后首轮 Cloudflare 生产构建失败：现有测试要求生产 `PUBLIC_TRANSLATION_SEPARATE` 不为 `true`，与本轮已确认的配置策略矛盾；通过 [PR #12](https://github.com/119shenhao/spine-community/pull/12) 调整为核对开发与生产均采用分离式译文 JSON，仍检查生产/预览 R2 桶隔离；开发分支 `verify` 成功。测试调整亦同步开发分支。
- 为确保更新到正式构建，通过 [PR #13](https://github.com/119shenhao/spine-community/pull/13) 仅重排生产普通变量顺序（不改变值），触发正式配置构建。最终生产提交 `25ba3afbd18cdf4e398000638d87ee9eef2eb59b` 对应 [Cloudflare Workers Build](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/25960c09-e883-40d0-912e-8e264c35bc60) **Success**，2026-11-10T03:24:27Z 完成。
- 未执行生产 D1 迁移、数据库写入、真实内容同步、导入或采集操作；当前工具无法直连生产 `/api/health`，因此尚未独立验证生产 D1 `translation_enabled`、Azure 新译文生成、R2/CDN 回源及缓存清理实际响应。

## 2026-11-10 生产 D1 翻译开关开启（用户明确授权）

- 用户当次明确确认：「确认开启生产环境D1翻译开关」。目标仅为生产 `spine-community-db`（D1 UUID `5919ff78-b8fc-46ab-85f0-01fe5e6a41b0`）的 `settings.translation_enabled=true`。
- 先通过生产 [只读检查 #42750241080](https://github.com/119shenhao/spine-community/actions/runs/42750241080) 确认实际为 `false`，帖子及回复译文缓存行数均为 0。
- 通过 [PR #15](https://github.com/119shenhao/spine-community/pull/15) 为原有 Production D1 工作流增加严格受控的 `enable-translation` 操作：仅通过明确授权及生产 DB 名称确认的 docs-only 请求触发；再次检查 D1 身份与迁移历史；执行固定 SQL，验证结果；不会修改其它表、额度或预览数据库。
- [生产写入工作流 #42750794988](https://github.com/119shenhao/spine-community/actions/runs/42750794988) **Success**，实际日志：`Production translation_enabled: false -> true`。
- 随后独立发起 [只读复核 #42750854757](https://github.com/119shenhao/spine-community/actions/runs/42750854757)，**Success**，生产 D1 实际状态：`translation_enabled=true`；`topic_translations=3`、`comment_translations=2`；2026-11-10 UTC 当前翻译字符预留 3,849；`provider_blocked_at=0`、`cooldown_until=0`。这表明正式数据库已开始产生译文缓存，但**不等于**已从公网验证首页与详情页的译文呈现、Azure 账户真实计费或 CDN 缓存命中。
- 本次没有发布站点新版本、操作生产用户／帖子／回复、同步预览数据、开启采集导入或改动 Azure 免费额度与 Secret。

## 2026-11-10 生产新版本：回复交互、iOS 焦点与流量统计开关

- 用户明确指令：「发布新版本，开发环境到生产环境」。
- 开发源提交：`5a8188ad35463ee7483f22d65c86b19cbd1c514d`。开发 Actions [#42758476677](https://github.com/119shenhao/spine-community/actions/runs/42758476677) **Success**，111 项自动测试通过。
- 基于当时生产 `main` 提交 `786997002d16ca87e65b60ccf84393859a9a619d` 创建 `release/spine-20261110-analytics-5a8188a`，仅选取 9 个代码/测试文件。发布候选 `5f60fbeb02374f3188e4717bbd59b257f6619e9d`；差异核对严格只有 `public/app.js`、`public/i18n.js`、`public/i18n-zh-tw.js`、`public/styles.css`、`src/admin.ts`、`src/community.ts`、`src/core.ts`、`src/index.ts`、`tests/community.test.mjs`。
- [发布 PR #16](https://github.com/119shenhao/spine-community/pull/16) **Merged**，生产 merge commit：`b24d71c8a8085c948e0c28cc7bf17158f6a4b7bd`。
- [Cloudflare Production Workers Build](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/f1251cfb-8aed-485a-8753-6f4e6ef3c8e6) 的该 merge commit 对应 GitHub Check **completed/success**，表示正式构建已成功。
- 功能：未登录点击首页/详情回复弹登录，已登录可直接回复并正确关联帖子；登录弹窗关闭后消除 iPhone Safari 主区域蓝色焦点框；后台统计增加站长独占流量开关、D1 `settings.analytics_enabled` 缺省视为关闭，取消对 Cloudflare `ANALYTICS_SALT` 的依赖，历史统计保留。
- **生产 D1 无迁移**：对比开发/生产 Git 树，所有 `migrations/v1/` 文件一致；代码复用既有 `settings` 表与审计表，默认 `analytics_enabled=false`（缺失项按 false 解释）。没有同步任何帖子、评论、用户、点赞或翻译缓存数据。
- 保留生产 `wrangler.jsonc` 的环境设置、`keep_vars: true`，保留 `main` 文档与所有生产工作流，不从开发分支覆盖。没有擅自开启统计；生产站长需在「社区管理 → 社区统计」手动打开。
- **尚未完成独立公网验收**：本次工具访问 `https://spine.nbn369.com/api/health` 返回不可访问，不能据此判断网站故障，也不能以构建成功代替在线 HTTP/API/UI 实测。建议站长检查 `/api/health` 的 `analyticsEnabled:false`，随后登录后台验证新开关与手机版回复按钮。

## 2026-11-10 SEO 正式发布：robots.txt / sitemap.xml / History API

- 用户明确要求核实 `robots.txt`、`sitemap.xml`，若正式站缺少则从开发环境发布新版。检查开发代码确认这两个地址由 `src/seo.ts` **动态响应**，不是单独的静态文件；生产此前还没有 `seoRoute`。
- 本次源代码为开发提交 `d7887800fcf8bbbca43dff35a22642818749dcfe`。GitHub Actions [#42769967646](https://github.com/119shenhao/spine-community/actions/runs/42769967646) **Success**，119/119 测试通过；[开发预览 SEO 只读 HTTP Smoke #42769217272](https://github.com/119shenhao/spine-community/actions/runs/42769217272) **Success**，属于开发前一提交版本的真实抓取检查。
- 基于当时 `main` `c98bf28c2e261d1cddd498d46d41d212e15133b5` 建立发布分支 `release/spine-seo-robots-sitemap-20261110`，仅替换七个必要文件：`src/seo.ts`、`src/index.ts`、`src/core.ts`、`public/app.js`、`public/index.html`、`tests/community.test.mjs`、`wrangler.jsonc`。已审查 `wrangler.jsonc`，**生产 Vars/D1/R2/预览绑定/keep_vars 不变**，只增补 `assets.run_worker_first` 正式网页与 SEO 路径。
- [正式发布 PR #17](https://github.com/119shenhao/spine-community/pull/17) **Merged**，生产提交 `c9bf7ddd7423cdeb67d6bcc89035d60f077ad771`。与之对应的 [Cloudflare Production Workers Builds](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/9cbcde58-d4a9-4d29-a5fa-3eb234d96a59) **completed/success**，完成时间 `2026-11-10T06:50:17Z`。
- `https://spine.nbn369.com/robots.txt`：生产允许爬取并指向 `https://spine.nbn369.com/sitemap.xml`；预览禁止爬取。生产 Sitemap 只包含公开帖子并基于 D1 实时生成；超过 500 篇自动索引分片。`/topic/ID` 服务端提供公开原文 HTML、canonical 和基本 Open Graph 元数据；非公开/删除帖子不向爬虫泄露正文。前端使用 History API，**无旧 # 路由兼容**。
- 对比 `migrations/v1/*` 无差异，**无需生产 D1 迁移/写入，不同步预览业务数据**。保留既有 GitHub Workflow 和 main/docs 文件。
- **公网访问限制**：web 打开正式及预览两个 SEO URL 都返回无法访问；容器对 `spine.nbn369.com` DNS 解析失败。故本次只证明代码已合并、Cloudflare 生产构建已通过，**未独立完成生产端点 HTTP 200/响应内容或 Google 实际收录验证**。建议在可联网终端分别访问 `robots.txt`、`sitemap.xml`、真实公开 `/topic/ID`、`/api/health`，并将 Sitemap 提交到 Google Search Console。
