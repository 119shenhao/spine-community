# 2026-11-13 用户排行榜与统计局部刷新：生产发布记录

## 发布授权与范围

用户在本次对话明确要求「发布新版本从开发环境到生产环境」；按固定流程、已有 GitHub PR 与 Cloudflare 自动生产构建发布，没有重建或人工点击 GitHub 工作流。

- 源开发分支：`feature/v1-community-build-20261106`，开发验收版本：`3c7aa82551d30a59cbe867ec185aa5536a3258a6`。
- 发布前 main：`c459a55591a545df776e8f671e99524bf507daa5`。
- 受控 release 候选：`release/spine-20261113-contributors-analytics`，SHA `b01db893e2b01ad10a4731e0682dd127e80e9ce9`。
- [正式 PR #31](https://github.com/119shenhao/spine-community/pull/31) 已合并；正式 main merge SHA：`6dddc836aee705d4ff59961412f94e655fba795c`（squash）。

## 新版本内容

- 社区统计新增「活跃用户排行榜」，以稳定用户 ID 汇总真实前台公开帖数、回复数与总贡献，排序可选；排除采集和同步导入的系统作者 Anonymous、待审核、隐藏及删除内容。
- 点击真实作者昵称进入公开用户页（/users/{id}），查看该用户的帖子和回复列表、加入时间、公开贡献计数；20 条分页并可链接回原帖；后端只公开已审核可见内容，不显示 Google 用户身份与账号隐私信息。
- 7d / 30d 只更新「期间新增内容」区域，初始读取最近30天后在浏览器内切片，不重复请求 D1，不重画站点其他区域或回到顶部。
- 「帖子数 / 评论数 / 总贡献」只更新排行榜内容，专用后端管理员只读接口，保留当前滚动位置和其他数据；异步请求有过期响应保护。
- 修复 iOS Safari 点击 7d/30d 时提示「暂时无法加载内容」的 JavaScript 错误：单元素 querySelector 误当成集合 for...of 遍历；改为受测的 querySelectorAll。
- 本次仅 11 个功能相关文件，基于最新 main 有选择地移植；保留已经上线的移动三行摘要与英文单词保护（feed-preview）、阅读偏好设置、主题样式和 Worker 生产配置。

## 生产数据库和资源保护

- 发布前逐文件对比 main 与 feature 的 `migrations/v1`，全部 **16 个正式迁移文件** blob SHA 均相同；生产已在 2026-11-12 完成 0014/0015 迁移。**本次没有待发布 SQL，因此跳过 Production D1 apply**，不修改 schema，不清理数据，不执行 Time Travel 恢复。
- 不复制开发环境的帖子、回复、账号、OAuth、译文等数据；不执行独立「同步帖子」或采集任务。
- 保留 main 的生产 OAuth、Cloudflare `keep_vars`、D1/R2 绑定与其他工作流；没有复制预览机密。

## 测试与上线真实结果

1. [候选 PR CI #43338827823](https://github.com/119shenhao/spine-community/actions/runs/43338827823)：success。
2. [main CI #43338962560](https://github.com/119shenhao/spine-community/actions/runs/43338962560)：`npm run verify` 成功，**141/141 tests pass，0 fail**，含真实作者列表权限、排行榜过滤与 7/30 天按钮 DOM 回归。
3. Cloudflare 生产构建对新 main SHA `6dddc836...` 返回 **completed/success**。Build ID：`f1c1018e-b4ed-403b-803d-58ab3d5a0e29`；Worker Version ID：`5c513ecb-c2ba-444a-bb66-0719a548967a`。参见 [Cloudflare 构建记录](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/f1c1018e-b4ed-403b-803d-58ab3d5a0e29)。
4. **重要顺序复核**：第一次 main production-assets smoke 运行于 Cloudflare 构建完成前，读到旧前端版本 `0b44310ba08ba163`；不能把首次成功当作本次新版本上线证据。Cloudflare 构建成功后，使用原有 GitHub Actions job 重跑相同生产检查（run 43338962560，attempt 2，job 131602835807），最终 success；服务器实际 GET 生产首页读到新资源版本 **`6095b81bb2a46347`**，并验证旧摘要的三行 clamp、feed-preview.js、生产 /api/health 为 production、status=ok、databaseReady=true。
5. 本次已确认真实服务器提供新版本资源与生产健康，未使用有站长登录态的真实 iPhone Safari 逐一点击两组新按钮，也未做生产端真实用户的带登录浏览器交互验收；不能将自动化测试等同于此项人工验收。

## 结果与后续关注

**代码、Cloudflare 生产构建与构建后真实 HTTP 检查已成功。** 用户可在生产站登录进入「社区管理 → 社区统计」检查按钮切换和点击用户名的体验。若发现异常，以此记录的 release/base SHA、Cloudflare Build/Version ID 和 main Actions 第二次运行作为追踪依据。不要未经单独授权恢复生产 D1，避免覆盖恢复点之后的真实患者内容。
