# Spine Community — Codex 工作规范

> 本文件随第一版功能开发分支保存。**读取本文件后必须先阅读 [长期开发发布规范](docs/development-release-workflow.md) 和 [当前需求](docs/requirements/README.md)。** 如果有更近的用户明确指令，以用户明确指令为准，但不能绕过生产操作审批和安全要求。

## 开发前必读

1. `docs/development-release-workflow.md` —— **必须遵守**：feature → Worker Preview → 测试 D1 → 用户验收 → 用户明确授权 → main/生产部署；不把测试 DB 数据合并到正式 DB。
2. `docs/requirements/README.md`、`docs/requirements/decisions.md` 及本次功能专题 —— 产品已经确认的规则。
3. `docs/database/d1-v1-design.md`、`docs/database/d1-v1-review-2026-11-06.md` —— 数据结构草案和审核阻断项。SQL 草案不等于已执行迁移。

## 强制限制

- **默认在 `feature/v1-community-build-20261106` 或用户指定的其他 feature 分支工作；未经当次明确授权，不得合并、提交或直接部署 `main`。**
- 预览 D1：`spine-community-db-preview`（`4362537a-5748-4a05-b0c4-219c3db36996`）。
- 生产 D1：`spine-community-db`（`5919ff78-b8fc-46ab-85f0-01fe5e6a41b0`）。
- **绝不在未经用户另行明确批准的情况下对生产 D1 进行写操作、迁移、导入、删除或恢复。** 不执行面向顶层生产 `DB` 的远程命令来测试功能。
- 预览迁移需先建立并审核独立 `wrangler.preview-migrations.jsonc`，核对它指向预览 D1，再按规范执行。旧 `migrations/0001_initial.sql` 尚不适合直接执行。
- 代码和数据库结构分别发布：Git 合并的是代码和迁移文件，**绝不复制测试 D1 的用户或帖子到生产库**。
- 不能将真实患者数据、OAuth Token、Cloudflare API Token、Secret 写入源码、GitHub、预览数据库或日志。
- 开发中的功能必须测试并报告预览构建实际结果；GitHub 提交不意味着预览或生产成功。
- 如果用户说“只写需求/规范文档”，只修改 `docs/`，不要修改源代码/数据库配置，不触发生产发布。
- 根目录 `AGENTS.md` 位于 Cloudflare `docs/*` 构建过滤之外，变更该文件可能触发**预览构建**。但仍不得触发或授权生产发布。

## 每个任务的交付报告

简要说明：本次修改内容与 GitHub commit、预览网址、自动/手工测试是否通过、测试 D1 是否执行了迁移、剩余问题和是否涉及需要用户确认的正式发布操作。

**当前预览网站可以打开，但第一版论坛业务功能及数据库初始化尚未完成；不得将“预览网页可访问”描述为“论坛已经开发完成”。**
