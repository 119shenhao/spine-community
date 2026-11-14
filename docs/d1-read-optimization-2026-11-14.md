# Spine Community — D1 读取量诊断与首批优化（2026-11-14）

## 范围与环境
- 私有仓库：`119shenhao/spine-community`。
- 代码和迁移：`feature/v1-community-build-20261106` 开发分支。
- 本文档按项目约定写在 `main/docs/`，不在开发分支写 docs。
- 本轮没有生产发布、生产结构迁移、同步帖子或修改生产数据。
- D1 分别为生产 `spine-community-db`、开发 `spine-community-db-preview`；二者共用 Cloudflare 账户 D1 免费读取量额度。

## Cloudflare Analytics 取证
来源：GitHub Actions 只读诊断第 2 次运行（`43533045471`, attempt 2）：
https://github.com/119shenhao/spine-community/actions/runs/43533045471/attempts/2

| UTC 日期 | 生产 rowsRead | 开发 rowsRead | 合计 |
| --- | ---: | ---: | ---: |
| 2026-11-12 | 1,197,873 | 1,226,092 | 2,423,965 |
| 2026-11-13 | 2,110,933 | 1,736,551 | 3,847,484 |

以上是 Cloudflare GraphQL D1 实际日读取量；后续 SQL 排名数据是最近两天的聚合（不是单日计费额），不应混淆。

近期 SQL 样本高消耗项：
- 翻译 API `src/translation.ts:readItems()` 的 JSON requested + topics/comments + translation cache 关联查询：生产约 1,108,848 行（628 次），开发类似查询约 645,427 行（320 次）。
- R2/CDN 投影队列 `src/projection-demand.ts:drainDemand()` 领取任务 SQL：生产约 379,085 行（250 次），开发约 705,470 行（446 次）。
- `src/content-statistics.ts` 内容来源汇总：生产约 300,660 行（20 次），开发约 635,470 行（42 次）。
- 用户榜单、历史未注明日期计数和开发环境 `PRAGMA foreign_key_check` 也有成本，后续单独优化。
- 不应把所有消耗归因于浏览量；定时同步、采集、后台报表和 CDN 回填都可能产生 SQL 读取。

## 首批优化（已开发）
1. `src/translation.ts`：以 `requested r CROSS JOIN topics/comments` 固定小 JSON 请求集合为外侧循环，使主帖/回复主键索引查找先于全表扫描；保留原语言校验、缓存版本、发布状态和评论所属帖可见性。
2. `src/projection-demand.ts`：在尝试 `UPDATE public_projection SET lease` 前先检查是否有到期失效页或待生成页；空队列立即退出，真正任务仍由原子 UPDATE 抢占，不改变锁及冲突处理语义。
3. `migrations/v1/0016_projection_pending_due_index.sql`：为 `public_projection(due_at,lease_until) WHERE state='pending'` 增加部分索引，加速到期任务预检。此前的 priority 索引仍保留。
4. `tests/community.test.mjs`：新增缓存原文/译文与隐藏权限校验、空投影队列不执行 lease UPDATE 的回归测试。

开发验证：
- GitHub Actions `43536231746` 成功，包含 `npm run verify`、Wrangler dry-run 和浏览器检查：
  https://github.com/119shenhao/spine-community/actions/runs/43536231746
- 开发预览 D1 只针对迁移 0016 的只读核对（`43536735397`）成功，结果显示迁移 0016 **已应用**、对应索引 **存在**，因此本次工作流跳过重复迁移：
  https://github.com/119shenhao/spine-community/actions/runs/43536735397

## 后续动作
- **尚未发布生产**；待用户下达固定命令「发布新版本，从开发环境到生产环境」时，再按现有核验过的发布流程将开发代码合并到 main，并应用生产 D1 迁移 0016。不要用帖子同步任务替代版本发布，也不要未经指令直接合并。
- 优化上线之后，按相同 GraphQL/Insights 口径比较 24–48 小时的 `rowsRead`，尤其是 2 个热点 SQL 的平均每次读取行数。代码变更不等于已有足够线上性能证据。
- 下一批优化优先内容来源统计/用户排行榜，要求保持正确的「导入 / 用户实际发布 / 总量」三种口径以及 7d/30d 统计语义。不要直接缓存不加隔离的后台私人响应。
- 诊断流程需要 Account Analytics → Read；诊断用 API Token 存 GitHub Actions Secret，不输出凭证。

## 第二批 D1 优化（2026-11-14，开发分支已通过完整验证）

在用户要求将四个剩余问题全部优化后，新增以下变更：

### 内容来源统计与排行榜：持久增量汇总
- 迁移 `migrations/v1/0017_materialized_content_stats.sql` 新建：
  `visible_content_index`（仅可见的帖子/回帖索引）、
  `visible_content_totals`（按内容类型/来源统计）、
  `visible_contributor_totals`（按真实用户统计）、
  `content_origin_day_totals`（按原本 entered_at 与来源统计，含空日期）。
- 内容创建、来源重分类、编辑状态、隐藏与恢复、删除、作者更新、回复归属变更都使用 D1 triggers 在原事务内维护汇总，避免管理后台每次对所有帖子和回复进行 JOIN/UNION/GROUP BY。
- 历史每日新增的口径保持 **content_origins 首次入库日期**，并非帖子原文发布日期；当前总量按可见内容，历史新增不因隐藏/删除而自动清除；用户排行榜只统计 source='user'，不包含匿名导入。
- 管理后台 `src/content-statistics.ts` 与 `src/contributors.ts` 改为查询汇总表；仍从 users 表检查账户状态，禁止把被禁用用户计入活跃榜。

### 外键检查按需执行
- `.github/workflows/preview-content-statistics.yml` 中的完整 `PRAGMA foreign_key_check` 从默认统计审计中移除。
- 仅在该工作流手动 `workflow_dispatch` 并设置 `deep_integrity=true` 时单独执行，避免每次普通统计审计扫描所有外键。迁移与重要入库仍应安排专项完整性检查。

### 健康检查与限流
- `src/health-schema.ts` 使用按 D1 绑定分离的 5 分钟 schema capability cache；运行时翻译开关、流量统计开关和缓存译文是否存在每次继续读取，确保后台动态切换可见。
- `wrangler.jsonc` 引入原生 Cloudflare Rate Limiting binding `API_RATE_LIMITER`（180/60秒），`src/core.ts` 在 GET/HEAD 请求使用边缘原生限流，减少不必要 D1 bucket 写入；关键写操作继续使用严格 D1 限流；绑定缺失或服务调用失败则退回现有 D1 限流。
- 注意：原生 Rate Limiting 是 Cloudflare POP 级别**近似限制**，不能宣称与 D1 全局原子限制等效。关键数据写操作继续保留 D1；该功能的可用性还需随 Preview/Production 部署验证。
- `src/maintenance.ts` 将旧访客行和限流过期行清理合并到 Worker 隔离实例每小时至多一次的后台任务，不再在每次 pageview 都执行 DELETE。
- 迁移 `0018_rate_limit_expiry_index.sql` 新建 `rate_limits(expires_at)` 索引加速过期清理。

### 回归及线上预览验收
- 通过完整自动化 CI：`43539191509`，包含 `npm run verify`、Wrangler dry-run、浏览器测试。
- 增加回归测试：从旧 SQL 与缓存聚合对比，依次验证帖子/评论直接导入、隐藏/恢复、逻辑删除、作者切换、来源和 entered_at 修订、删除；原生限流 GET 不写 D1，POST 保留严格限流，原生服务失败回退；健康检查不缓存动态设置。
- 通过独立开发 D1 只读核对 `43539482188`：
  - 当前内容：`visible_content_index` 4,962 行 = `visible_content_totals` 4,962 = 源表可见内容 4,962。
  - 历史来源记录：日期汇总 4,976 = `content_origins` 4,976。
  - 用户贡献：排行汇总计数 5 = 可见且来源为 user 的记录 5。
  - D1 迁移记录里 0017 与 0018 均存在，过期限流索引存在；当次作业没有重复应用迁移。
- 运行记录：
  - https://github.com/119shenhao/spine-community/actions/runs/43539191509
  - https://github.com/119shenhao/spine-community/actions/runs/43539482188
- **尚未在本轮发布生产**，不得将开发库索引/汇总情况视为生产库已应用。
- 生产发布必须沿用既定「发布新版本」流程，先审查 0017/0018 对生产 D1 的写入负担和备份点，完成迁移后再发布新代码，避免代码期待汇总表但表尚不存在。
- 生产发布后至少用 24–48 小时 D1 Insights/GraphQL 对比 rowsRead，同时关注 rowsWritten：增量触发器用适量写入换取大量读取节省，不能只盯读取量。
