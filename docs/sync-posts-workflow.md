# 固定任务：同步帖子，从开发环境到生产环境

> **固定名称（2026-11-07 用户确认）：同步帖子，从开发环境到生产环境**
> 与 [发布新版本，从开发环境到生产环境](release-version-workflow.md) **严格区分**：本任务只同步论坛内容，不发布程序代码、数据库结构或系统基础数据。
> 任务实现状态：已沿用 2026-11-07 成功脚本制作重复执行的工作流草案 [PR #4](https://github.com/119shenhao/spine-community/pull/4)，**尚未合并至 main，不能宣称 Actions 中已正式启用**。

## 从 ChatGPT 发起任务时的含义

用户说“**执行同步帖子，从开发环境到生产环境**”，就表示请求使用本文定义的已有同步流程：

1. 读取 `main` 分支的本文及 [帖子去重与同步规范](topic-dedup-and-sync.md)，核对最新同步历史与预览/生产 D1 配置。
2. 先完成自动测试和**只读预检查**，查看待同步主帖数。如果是零，报告无须同步，不写生产库。
3. 确认本次生产写操作已获明确授权，记录生产 D1 Time Travel 恢复点，然后按批次运行**已验证**的脚本 `scripts/sync-preview-to-production.mjs`。
4. 只同步预览库**尚无同步回执的 published 主帖**，在主帖首次同步时一次性带上当前可公开的回复、楼中楼和楼主进展。原作者不限；写入生产时一律映射至“未知用户”，保留正文原文和合法回复层级。隐藏或待审核内容不进入生产。
5. 生产已有相同主帖指纹时跳过，不为已有主帖增量补回帖；完成的开发主帖有回执后永远不再重复处理。任何批次失败，保留成功记录并核对，不清空生产库。
6. 按 GitHub Actions 实际结果核对：每批的主帖、回复数量及回执均匹配，最后一轮 examined=0，才报告“本次符合条件内容全部同步完成”。

**不能把这个固定任务名误认为自动授权任何未来的生产写入。** 如果目前使用的 GitHub 连接器不支持触发 workflow_dispatch，应如实说明，并提供 GitHub Actions 入口；不能声称已启动。

## 成功执行过的历史任务

- [第一次任务 #42372655830](https://github.com/119shenhao/spine-community/actions/runs/42372655830)：第一批成功 100 篇主帖、657 条评论；后续遇到非“未知用户”评论而停止。
- [修复后的成功任务 #42375764551](https://github.com/119shenhao/spine-community/actions/runs/42375764551)：新增 31 篇主帖、153 条回复（含楼中楼），记录 31 条回执，最后一批 examined=0，工作流结论为 Success。
- 两批累计确认 **131 篇主帖、810 条回复**；这是当时的已确认完成量，不代表今后开发环境不会继续产生新内容。

## 可重复执行的 GitHub Actions（草案，未启用）

工作流文件：`.github/workflows/sync-posts.yml`（[PR #4](https://github.com/119shenhao/spine-community/pull/4)）。

- 固定名称：**同步帖子，从开发环境到生产环境**。
- 仅允许 **手动触发**（`workflow_dispatch`），没有定时或推送自动写生产；只允许从 `main` 派发。
- `mode=inspect` 为默认选项：运行测试和只读 D1 预检查，不写生产库。
- `mode=sync`：需要填写确认 `spine-community-db`；运行前测试、只读检查、记录 Time Travel 恢复点，然后批量应用。
- 使用 SHA `4580263f1ec66feed1d1f2d2722873068455f2bb` 锁定 [成功运行 #42375764551](https://github.com/119shenhao/spine-community/actions/runs/42375764551) 中已验证的同步脚本，不会盲目执行后来开发分支新提交。未来若要升级同步代码，需先测试新候选再修改锁定 SHA。
- 保留旧的一次性工作流运行历史，不重新运行历史脚本，也不改变去重规则。

**启用前唯一已知外部配置项**：Cloudflare Worker `spine-community` → 设置 → 构建 → 构建监视路径（Build watch paths）→ **排除路径**，加入 `.github/workflows/sync-posts.yml`。当前已知 `production-d1.yml` 单独被排除，但这个新文件尚未确认已排除。在此之前，PR #4 保持草案、不合并，以免仅安装 GitHub Actions 就触发正式站点重新构建。

完成排除路径配置后，将 PR #4 合并 `main`（此操作只安装 Actions 工作流、不应发布程序），在 GitHub Actions 中先运行一次 `inspect` 并检查结果，再按用户明确授权执行未来的 `sync`。这项手动操作不属于“发布新版本”任务。
