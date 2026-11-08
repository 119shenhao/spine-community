# D1 数据库文档索引

这里存放**数据库技术方案和审核记录，不是可以直接执行的生产迁移**。业务标准：[正式需求](../开发需求/项目需求总览.md)；部署/迁移标准：[开发发布规范](../development-release-workflow.md)。

| 文档 | 当前状态 | 作用 |
| --- | --- | --- |
| [d1-v1-design.md](d1-v1-design.md) | 评审草案 | 表结构与索引设计 |
| [d1-v1-review-2026-11-06.md](d1-v1-review-2026-11-06.md) | 有待修正项的审核报告 | 记录审核过程和建表阻断项 |
| [d1-v1-schema-draft.sql](d1-v1-schema-draft.sql) | **不可直接执行** | SQL 设计草案 |

## 本次开发后的实际状态

- 旧 `migrations/0001_initial.sql` 已移至 [历史归档](../archive/0001-initial-legacy.sql)，不再属于活跃迁移路径；上方 v1 设计／审核／SQL 草案保留为历史设计依据，不能冒充当前执行脚本。
- 活跃实现：`migrations/v1/0001_community.sql` 与 `0002_taxonomy.sql`。本地 Wrangler D1 迁移成功，独立远程预览 D1 已初始化；远程健康检查返回 `databaseReady=true`。
- 预览迁移专用配置：`wrangler.preview-migrations.jsonc`，绑定 `PREVIEW_DB`，仅指向 `spine-community-db-preview`（`4362537a-5748-4a05-b0c4-219c3db36996`）。
- 关键约束、权限、原文/译文/索引删除、搜索与预算竞态等已纳入16项集成测试。完整范围与局限见 [开发实现与验收记录](../implementation-v1-2026-11-06.md)；真实Google登录和供应商联调不在已通过范围内。
- **生产 D1 尚未执行本次迁移。** 生产执行仍需影响评审、备份及用户明确批准；绝不复制测试数据库数据覆盖生产数据库。
