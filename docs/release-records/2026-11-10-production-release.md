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
