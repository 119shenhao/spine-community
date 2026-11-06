# Spine Community — 文档总导航

> **此文件是 `docs/` 唯一总入口。** 业务以 [正式需求总览](requirements/README.md) 为准，开发与生产安全规则以 [发布规范](development-release-workflow.md) 为准。设计草案和历史归档不能当作已确认/已实现的功能。

## 开发实现记录

[帖子／跟帖导入 API](import-api.md)：开发免密导入、固定“未知用户”账号、请求示例及生产禁用验证。

[v1 开发实现与验收](implementation-v1-2026-11-06.md)：实际代码、25项测试（初版16项＋导入9项）、最终提交与构建结果、测试库初始化，以及Google登录／统计／翻译的待配置事项。**当前：开发预览已部署；真实登录尚待配置，正式发布未执行。** 需求和设计文档中的历史状态不等同于当前远程部署状态。

## Codex 开发前阅读顺序

1. **[开发、预览、数据库迁移和正式发布规范](development-release-workflow.md)**：测试与生产隔离、上线审批和回滚。
2. **[第一版正式需求总览](requirements/README.md)**：唯一权威需求主文档。
3. **[需求决定记录](requirements/decisions.md)**：已确认、暂缓、待细化的事项。
4. **[数据库设计](database/d1-v1-design.md)** 与 **[审核报告](database/d1-v1-review-2026-11-06.md)**：技术方案、阻断项，尚未代表完成建表。

## requirements/ — 当前产品需求

- [需求主文档](requirements/README.md)
- [需求决定记录](requirements/decisions.md)
- [多语言及自动翻译](requirements/multilingual.md)
- [跨语言症状搜索](requirements/search.md)
- [楼主进展与帖子关注](requirements/author-progress.md)
- [后台管理、举报、日志及统计](requirements/admin-moderation-analytics.md)
- [个人中心、隐私及删帖](requirements/profile-privacy-deletion.md)

**责任界定：**主文档管理范围和入口；专题记录细节；决策记录跟踪确认或变更。专题文件名保持稳定，日期记录在内容中，避免同一功能出现多个“最新版”。

## database/ — D1 设计与审核

- [数据库文档索引](database/README.md)
- [D1 v1 设计](database/d1-v1-design.md)
- [v1 审核报告（2026-11-06）](database/d1-v1-review-2026-11-06.md)
- [D1 SQL 草案（不可直接执行）](database/d1-v1-schema-draft.sql)

**重要：**旧 `migrations/0001_initial.sql` 已移至 [历史归档](archive/0001-initial-legacy.sql)，不能执行。当前开发迁移为 `migrations/v1/`，已在独立测试库初始化；生产 D1 变更仍须另行明确授权。

## 开发与部署

[长期流程](development-release-workflow.md)：feature 分支 → Cloudflare Worker Preview → 独立测试 D1 → 用户验收 → 授权后合并 main 和升级生产数据库。**代码通过 Git 合并，数据库只按迁移升级结构，不复制测试库用户数据。**

## archive/ — 历史资料

- [归档说明](archive/README.md)
- [v0.1 原始需求草案](archive/requirements-v0.1.md)
- [旧需求总汇快照](archive/requirements-summary-2026-11-06.md)
- [旧路径兼容导航](requirements.md)

## 维护规则

1. 确认的产品变更应同时更新对应专题及 [决策记录](requirements/decisions.md)。
2. 已过时的资料归档，不删历史；不得把归档误当有效规则。
3. 重命名时修复所有相对链接，保持导航有效。
4. 只整理文档就只改 `docs/`，不改源码、正式部署、D1 或密钥。
