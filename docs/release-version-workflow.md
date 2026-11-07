# 发布新版本，从开发环境到生产环境

> **状态（2026-11-07）：安全发布工作流已在单独开发分支实现，尚未合并到 main；尚未在生产环境执行。**
> 工作流草案：[PR #3](https://github.com/119shenhao/spine-community/pull/3)（Draft）。
> 本文是 `main/docs/` 下的长期操作说明；正式执行仍受 [开发与发布规范](development-release-workflow.md) 约束。

## 任务的固定名称

- **中文名称：发布新版本，从开发环境到生产环境**
- GitHub Actions 文件：`.github/workflows/release-version.yml`
- 与**同步帖子（Sync Posts）**独立运行：本任务不将开发库中的帖子、评论、点赞、收藏、关注、Google 账户或其他业务数据复制到生产库。

## 任务范围及处理顺序

1. 锁定拟发布的开发分支及**完整 40 位提交 SHA**，检查分支和用户发布授权。
2. 安装依赖，在**不持有生产密钥**的独立任务中执行 `npm run verify`。
3. 只读核对开发、生产 D1 绑定及正式数据库 UUID，检查生产迁移历史、已发布 SQL 不可更改、待迁移文件。
4. **仅当选择 release** 时：确认没有仍在执行的帖子同步或另一项 Production D1 迁移；创建或复用待发布 PR，核对 PR 源代码 SHA。
5. 如有待迁移 SQL，先记录生产数据库 Time Travel 恢复点，再按序执行**已审核**迁移（结构和版本必需的分类、系统设置等基础记录）；没有待迁移 SQL 则跳过写入。
6. 严格按锁定的 SHA 合并 PR 到 `main`，通过现有 Cloudflare GitHub 集成触发正式网站构建。
7. 监测**对应合并提交**的 Cloudflare 构建检查，不能将旧版网站返回 HTTP 200 当作成功；随后检查正式站 `/api/health` 的 `status=ok` 和 `databaseReady=true`。
8. 在 GitHub Actions 的 Summary 中留下候选版本、迁移计划、恢复点、PR、合并 SHA、检查结果及异常。失败时停止；**不自动执行生产库整库恢复**，避免覆盖事故后新数据。

## 当前计划的使用方式（PR 合并并通过首次测试后才可使用）

打开 GitHub Actions 中名为**“发布新版本，从开发环境到生产环境”**的工作流。

| 选项 | inspect（推荐先运行） | release（明确授权后） |
| --- | --- | --- |
| operation | `inspect` | `release` |
| candidate_branch | 待发布的 `feature/*` 或 `release/*` 开发分支 | 同一候选分支 |
| candidate_sha | 可留空 | **必须**填写经过审核的 40 位 SHA |
| confirmation | 留空 | 必须输入 `RELEASE spine-community` |
| 生产数据库、代码 | 只读检查，不迁移、不合并 | 按成功的前置检查逐步迁移、合并并核验 |

**ChatGPT 固定自然语言指令：**
“开始执行任务：发布新版本，从开发环境到生产环境。”
AI 先读取本文件和 `docs/development-release-workflow.md`，验证本次代码候选/权限/风险，然后执行只读检查，明确已获用户对具体版本的发布许可，再通过**实际支持的工具**触发正式工作流。**聊天内收到指令不代表 GitHub 工作流一定已触发，必须报告真实运行 URL 和状态。** 如果所连接的 GitHub 工具不提供 workflow_dispatch，不能冒称已启动，应说明限制并提供对应 Actions 入口。

## 发布安全与首次启用前的检查

- 此工具的建设、PR 创建或文档提交**都不等同于授权新版本进入生产环境**。当前 PR #3 是 Draft，不能作为已上线的一键发布工具。
- 初次发布前必须审核 YAML、检查项目 Actions 的 `GITHUB_TOKEN` 是否允许创建与合并 PR、验证 GitHub Actions 是否能识别 Cloudflare 生成的构建 check-run。
- 按项目规则先做 `inspect` 的**不写生产测试**，再择机测试含迁移和代码合并的真实 release；不能仅凭 YAML 文件存在宣称全流程测试成功。
- 单独的 `Production D1` 仍保留作为有明确授权的独立迁移/恢复排查入口；`Sync Posts` 独立运行。
- 此处的 Time Travel 恢复点不是无损自动回滚保障。D1 已迁移但 PR 合并失败时，应将结果报告为**部分完成**，评估兼容性后人工处理，不自动清库/重导。
- 在正式迁移开始前，尤其应核对生产 D1 结构变更是否兼容尚未更新的生产代码，并优先使用兼容性扩展迁移。
- 如 GitHub 分支保护、Cloudflare 检查或远端网络权限导致任务中止，必须报告已执行到哪一步及哪些步骤**未执行**，禁止跳过防护条件直接发布。

## 当前进度记录

- 2026-11-07：固定名称已确认。
- 2026-11-07：开发分支 `feature/release-version-workflow-20261107` 已建立，新 GitHub Actions 文件已经提交，草案 PR #3 已创建，**未合并**。
- 待办：静态 YAML 校验、预览只读测试、权限及 Cloudflare 部署检测联调；经审核后再合并工作流本身到 `main`，不能因文档更新自动发布网站。

## 历史独立发布成功记录（不是新工作流的测试结论）

- [生产 D1 执行记录](https://github.com/119shenhao/spine-community/actions/runs/42365746245) 已成功应用 `0001` 至 `0005`。
- [旧版正式发布 PR #1](https://github.com/119shenhao/spine-community/pull/1) 已合并并通过当时的生产健康检查。
