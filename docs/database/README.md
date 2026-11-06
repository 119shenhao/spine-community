# D1 数据库文档索引

这里存放**数据库技术方案和审核记录，不是可以直接执行的生产迁移**。业务标准：[正式需求](../requirements/README.md)；部署/迁移标准：[开发发布规范](../development-release-workflow.md)。

| 文档 | 当前状态 | 作用 |
| --- | --- | --- |
| [d1-v1-design.md](d1-v1-design.md) | 评审草案 | 表结构与索引设计 |
| [d1-v1-review-2026-11-06.md](d1-v1-review-2026-11-06.md) | 有待修正项的审核报告 | 记录审核过程和建表阻断项 |
| [d1-v1-schema-draft.sql](d1-v1-schema-draft.sql) | **不可直接执行** | SQL 设计草案 |

现有根目录 `migrations/0001_initial.sql` 与新版需求不兼容，不得直接对任何远程 D1 运行。新迁移先在独立测试库验证、审查生产影响、获得用户明确批准后执行；绝不复制测试数据库数据覆盖生产数据库。
