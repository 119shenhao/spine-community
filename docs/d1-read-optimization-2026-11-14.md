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
