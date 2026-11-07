# 固定任务名：发布新版本，从开发环境到生产环境

> 2026-11-07 确认：**这只是对已经成功运行过的发布流程起一个统一名称**。不需要新建或启用额外的 GitHub Actions 工作流，更不需要为了改名重写已验证的脚本。
> 具体安全规则与操作细节以 [开发、预览、数据库迁移与正式发布规范](development-release-workflow.md) 为准。

## 约定的任务名称与触发语

**发布新版本，从开发环境到生产环境**

用户以后在 ChatGPT 说“执行发布新版本，从开发环境到生产环境”或“开始发布新版本”，即表示要按下面**现有**流程处理。AI 应先读本文件及 `docs/development-release-workflow.md`，从 GitHub 读取实际状态，直接推进既有步骤，不再提出重新建设一套工作流。

## 直接复用的现有发布流程

1. 核实本次要发布的开发分支、提交版本、代码差异、自动测试结果和预览环境。对尚未明确的生产发布范围，只问一次必要的问题并取得当次发布授权；不要把启动讨论当作无条件允许生产写入。
2. 检查是否有尚未应用的数据库迁移；其中允许携带**经过审核的必要基础表数据**（分类、标签、默认设置、系统账号等），不整库复制开发数据库。
3. 如果需要迁移，使用原有 [Production D1](https://github.com/119shenhao/spine-community/actions/workflows/production-d1.yml) 工作流：先 `inspect`，核对生产 D1 身份与待迁移 SQL；记录恢复点，再根据授权执行 `apply`，确认迁移结果。没有待迁移 SQL 就跳过写入。
4. 将已经测试并获批的开发代码按现有 PR 流程合并到 `main`。现有 Cloudflare GitHub 集成自动构建、部署生产站点。
5. 检查 Cloudflare 部署成功及生产站点健康、受影响 API/页面；保留发布记录。任何阶段失败均如实报告已完成项与后续补救，不宣称整个发布成功，也不擅自恢复生产数据库。

## 明确与另一个任务区分

本任务仅发布**代码、数据库结构、必要基础表数据**。开发环境采集的帖子、回复、楼中楼不通过本任务同步，它们由独立任务“同步帖子”负责。不得覆盖生产真实用户及其业务数据。

## ChatGPT 直接触发，无须每次点击 Run workflow（2026-11-07 已验证）

**名称保持不变：发布新版本，从开发环境到生产环境。** 用户在 ChatGPT 说“执行发布新版本，从开发环境到生产环境”，AI 应按本页现有版本发布步骤执行，而不是要求用户到 GitHub 手动点 Run workflow。此指令不代表可以忽略当次候选版本、SQL 差异、发布授权和生产风险审查。

**现有 Production D1 工作流已增加一个非常小的自动触发入口，原来的数据库迁移实现和工作流手动入口都保留：**

- 工作流文件：`.github/workflows/production-d1.yml`，通过 [PR #5](https://github.com/119shenhao/spine-community/pull/5) 合并到 `main`；Cloudflare 构建监视路径已排除该工作流文件。
- ChatGPT 先核对待发布分支及完整 SHA、测试、预览状态和迁移清单（既有要求：迁移候选 SHA 必须属于 `main` 或 `release/*`，功能分支需要先准备同版本的 `release/*` 发布候选）；检查正式 D1 UUID，必要时申请本次上线授权。
- **无需 GitHub 网页按钮的触发方式：** ChatGPT 通过 GitHub 连接器修改/创建 `main/docs/release-requests/production-d1.json`，内容为 `repository`、`operation`（`inspect` 或 `apply`）、`migration_sha`、`production_db_id`、`confirmation`（仅 apply）及 `user_authorized`（仅 apply 时为 true）。提交消息严格为 `chatgpt-release-d1 <operation> <40位SHA>`。
- 这个 `docs/` 内的请求提交不会触发 Cloudflare 正式站点构建，但会通过 GitHub `push` 自动唤起一个无生产密钥的请求校验 job，校验提交消息、SHA、仓库和生产 D1 ID 后，调用**原有** Production D1 的 `workflow_dispatch`。原工作流依旧负责生产 D1 只读检查、检查迁移历史、恢复点及按序 apply。
- 首先提交 `inspect` 请求。查看**真正执行迁移检查的第二条** GitHub Actions 运行日志及 Summary；没有新迁移就跳过 apply。有获批新迁移时，再提交 `apply` 请求，必须包含生产 D1 名称确认及 `user_authorized=true`，并检查实际 apply 结果，不能仅凭“已发出请求”就宣称迁移成功。
- 数据库部分完成后，ChatGPT 使用 GitHub 连接器按已审查的 SHA 合并发布 PR 到 `main`，等待 Cloudflare 生产部署并核验生产健康及受影响的 API/页面。**帖子、回帖及真实用户数据不随此任务复制**，仍由单独“同步帖子”任务负责。
- 若 GitHub 连接器不具备提交权限、触发失败、Actions 权限有变，或代码合并遇到保护规则，必须如实报告，不得伪造成功。现有网页手动入口仅作为备用，不是默认要求用户操作。

**已完成的只读端到端验证：**

- [ChatGPT 提交请求触发运行 #42381735726](https://github.com/119shenhao/spine-community/actions/runs/42381735726)：Success，自动调用现有 Production D1。
- [由 GitHub 自动派发的 Production D1 inspect #42381742609](https://github.com/119shenhao/spine-community/actions/runs/42381742609)：Success。确认原来的验证、迁移来源核对、生产 D1 schema 检查成功；`apply` 步骤被跳过，**未修改生产数据库**。
- 这次只测试了自动触发和只读链路；**正式 apply 和新版本代码合并没有在这次测试中执行**，不能将其视为新的生产发布已经完成。

## 成功运行过的历史流程

- [Production D1 生产迁移成功记录（2026-11-07）](https://github.com/119shenhao/spine-community/actions/runs/42365746245)
- [正式代码发布 PR #1](https://github.com/119shenhao/spine-community/pull/1)
- [正式发布规范及详细检查步骤](development-release-workflow.md)

## 关于曾经额外开发的统一工作流

曾尝试把以上环节重新写为一个单独的 `release-version.yml` 工作流（[PR #3](https://github.com/119shenhao/spine-community/pull/3)）。用户明确表示**只需要固定名字复用现有流程，不需要重开发**。该 PR 不应合并或投入使用；不要将“新工作流通过测试”作为运行本固定任务名的前提。

> ChatGPT 的 GitHub 连接器如果没有触发 GitHub Actions 工作流的功能，应说明实际权限限制，并提供现有工作流链接，不能冒称已执行。每次都要以真实运行记录核实状态。
