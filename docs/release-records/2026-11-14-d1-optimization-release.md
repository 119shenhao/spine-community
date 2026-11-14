# Spine Community — D1 读取优化生产发布记录（2026-11-14）

## 结果
**正式发布成功。** 生产 Worker 构建成功；生产 D1 的 0016–0019 迁移成功；发布后的原有完整 CI 与线上资源/健康检查均通过。

- 正式网站：<https://spine.nbn369.com/>
- 生产代码：`2f635db2ec3984251e611a5d1151f6c162474057`
- 发布 PR：[#34](https://github.com/119shenhao/spine-community/pull/34)
- 原开发 HEAD：`c6f6b11b618a897b0dc0a1badc6939fd3d450f0c`
- 审核迁移候选 SHA：`f50db88883d0bfe668483217aadfca75ace81624`，属于受控 `release/spine-20261114-d1-perf`。
- Cloudflare Workers Builds：**Success**，Build ID `a161398a-4e6a-4873-b769-3766eacb6872`，Version ID `7642b3df-f9a1-4124-ab27-40a01df1650c`。构建详情：<https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/a161398a-4e6a-4873-b769-3766eacb6872>

## 安全范围与发布候选
- 本次发布刻意不直接合并长期分叉的 feature 分支，因为它会在 GitHub diff 中显示 `main/docs` 误删除和历史不相关文件；以现有 `main` 为基底，仅选取 **16 个目标文件**（应用程序、4 个 SQL migration、增强回归测试）。PR #34 经检查 **不包含 docs/ 变更**。
- 初版候选 CI 发现将整个 feature 版 `src/translation.ts` 复制到 `main` 会修改生产已修复的英文摘要截断策略；发布候选已改为保留现有生产翻译模块，仅定向采用 `readItems` 的主键查询优化。修复后的 PR CI **success**：<https://github.com/119shenhao/spine-community/actions/runs/43541375370>
- 新版覆盖翻译缓存 SQL、CDN 回填队列、后台统计/排行榜的增量汇总、开发外键检查降频、健康检查缓存、Cloudflare 原生 GET/HEAD 限流（D1 回退及写操作保护）、低频清理、精确内容去重、审核队列索引。
- 不执行 `sync-posts`；不复制开发库帖子/回帖、用户身份、收藏、点赞、生产业务数据；不修改 Google OAuth 凭据、翻译配额设置、R2 存量内容。

## 生产 D1（受控旧工作流）
- 目标生产 D1 名称 `spine-community-db`，UUID `5919ff78-b8fc-46ab-85f0-01fe5e6a41b0`。
- 原有 GitHub Actions `production-d1.yml` + `main/docs/release-requests/production-d1.json` 请求转发；无需手动点击 Run workflow。
- 发布前只读检查：[43541502461](https://github.com/119shenhao/spine-community/actions/runs/43541502461)：已有 0015，**待 0016、0017、0018、0019**，migration history 无冲突，FK errors=0，missing origins=0；生产翻译开关 true。
- 迁移 apply：[43541598175](https://github.com/119shenhao/spine-community/actions/runs/43541598175)：工作流在写入前记录生产 D1 Time Travel restore bookmark（见该运行 Summary），然后按顺序执行 0016–0019，Wrangler 对每个文件显示 ✅；Action **success**。
- 迁移后只读复核：[43541701557](https://github.com/119shenhao/spine-community/actions/runs/43541701557)：Applied 包含 0016–0019、Pending **[]**、blocking_reason=null，外键错误 0、缺少来源记录 0。发布请求已回到 inspect。
- 数据库恢复点不可在未评估后续新增生产数据时直接执行 Time Travel restore；不自动回滚生产业务数据。

## 代码上线与生产检查
- PR [#34](https://github.com/119shenhao/spine-community/pull/34) squash 合并，生产 commit `2f635db2ec3984251e611a5d1151f6c162474057`。
- Cloudflare Workers Builds GitHub check：**success**，Build `a161398a-4e6a-4873-b769-3766eacb6872`。
- 发布后主分支 CI `verify` 与 `Production assets smoke check`：**success**，日志 [43541778208](https://github.com/119shenhao/spine-community/actions/runs/43541778208)。通过真实 HTTP 检查：`/` HTML、16位版本资源 CSS/JS、feed-preview.js、移动端三行摘要/截断、`/api/health` 返回 `environment=production`、`status=ok`、`databaseReady=true`；真实线上 frontend revision `fb410795c4775a06`。列表位置恢复浏览器测试成功。
- 本次自动化没有执行真实用户 Google OAuth 登入后的生产发帖写入验收；没有为了验收生成假患者内容。

## 后续性能复核
- 请以 Cloudflare D1 Insights/GraphQL 在上线后 24–48 小时重新对比 `rowsRead`、`rowsWritten`、按 SQL 分组的 avgRowsRead 和调用次数，确认索引与统计汇总的实际降幅及触发器维护写入量。
- 自动化构建/功能验收成功证明代码兼容性，不意味着已经量测实际生产环境节省的 D1 行数；这一项尚待观察。
- 参见 [三批优化过程、SQL 热点、开发验收](../d1-read-optimization-2026-11-14.md)。
