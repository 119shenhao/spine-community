# Spine Community｜主帖去重与开发库→生产库一次性同步

状态：**开发分支已提交实现；尚未获准执行生产迁移或生产数据同步**。2026-11-07。

代码分支：`feature/v1-community-build-20261106`。本文件按约定只放在 `main/docs/`；文档进 main 不代表代码已合并或生产已上线。

## 已确认的规则

- 导入时保留主帖和每条回帖的**原始语言及正文**；服务端不翻译，不为帖子添加“开发测试”前缀。
- 对**主帖**生成内容指纹（SHA-256）；回帖不生成指纹，避免诸如 `Thank you` 的正常重复短评论被误删。
- 主帖指纹来自标题和正文的 Unicode NFKC 规范化、空白折叠、首尾空白去除与小写化后文本；只影响比对，库内仍存原始内容。指纹由 Worker 自动生成，接口调用方不传。
- D1 在 `topics.content_hash` 建立唯一索引。相同主帖跨导入批次再次提交时，导入接口跳过主帖和它附带的整棵回复树，返回原帖子 ID 与 `skipped=true`。
- 开发库→生产库同步**以主帖为单位，只同步一次**：第一次连同当时已发布的可见回帖、有效父子层级同步；开发库成功写入 `topic_sync_receipts` 后，该主帖永久退出待同步队列。后续增加的回帖不会再传到生产库。
- 生产库中同一指纹已经存在时，既不新建主题，也不补贴回复，只记录“已存在”的同步结果。
- 只同步开发库里作者为 **未知用户** 且状态为 `published` 的导入主题；不复制开发库真人账号、登录信息、其他用户的评论、点赞、通知或私有数据。审核中/隐藏等内容不公开同步，无法匹配可见父回复的子回复亦不复制。
- 导入结果含 `imported.topics`、`imported.comments`、`skipped.topics`，每个结果还可带 `skipped=true`。原有同一请求重放幂等功能保留。

## 采用的方案：复用导入 API，另建内部同步任务

**没有开放新的生产 HTTP 导入接口。** 原有 `POST /api/import/topics`、`/api/import/batch` 仍只允许开发预览环境；给生产服务增加公开可访问的写入端点没有必要。

新增内部脚本 `scripts/sync-preview-to-production.mjs`，通过具有授权的 Wrangler 客户端分别访问隔离的预览 D1 和生产 D1。脚本默认**只读预览/生产库并输出计划**；真正写生产须显式 `--apply`，同时设置 `SPINE_SYNC_PRODUCTION_CONFIRM` 为生产 D1 的准确 ID，并预先完成生产审批和备份。

- 预览读取未出现于 `topic_sync_receipts` 的导入主帖，以及本次快照的回复、分类。
- 生产端先检查同指纹或同标题正文的旧帖子；存在就跳过，不补历史回帖。
- 新帖以稳定 ID 导入，回复沿用稳定 ID 和父子关系；SQL `INSERT OR IGNORE` 使中途中断后可重试，数据库指纹唯一索引兜底。每个主题作为一个 SQL 文件提交，随后逐项查询核验主帖和评论，再记录预览侧同步回执。
- 回执**只在生产写入/核验后**写入；如果生产已写入但回执丢失，再次执行会识别生产已有内容，避免重复发布。发生数据不一致时停止，不默默覆盖。
- 生产 D1 若未升级到相应结构，或“未知用户”系统账号未创建，任务直接拒绝，不会写入。

### 文件

| 分支 | 路径 | 作用 |
| --- | --- | --- |
| feature | `migrations/v1/0004_content_fingerprint_sync.sql` | 主帖内容指纹唯一索引、同步回执表 |
| feature | `src/core.ts`、`src/import.ts`、`src/content.ts` | 统一生成指纹、跨批次主帖去重、正常发帖同样检查 |
| feature | `scripts/sync-preview-to-production.mjs` | 独立受保护的同步 CLI，默认只读 |
| feature | `scripts/backfill-topic-fingerprints.mjs` | 历史主帖指纹补算，默认只读，先排查历史重复和冲突 |
| feature | `.github/workflows/feature-verify.yml` | 仅开发分支 TypeScript 与 SQLite 集成测试，不连接生产数据库 |
| feature | `wrangler.production-sync.jsonc` | 明确锁定生产 D1 绑定，防止误用开发配置 |
| feature | `tests/community.test.mjs` | 主帖去重、回执、指纹一致性和楼中楼测试 |
| main | `docs/topic-dedup-and-sync.md` | 本规范（文档仅维护于 main） |

### 验证与上线顺序

1. 在开发分支执行 `npm run verify`。开发预览环境按原有隔离迁移流程应用 `0004`，确认预览构建与 API 测试通过。
2. 旧数据的 `content_hash` 初始为 NULL。使用 `npm run db:backfill-hashes -- --target=preview` **只读检查**历史重复，审核通过后才在已批准的环境执行 `--apply` 补算指纹；生产补算同样需要单独批准和备份。发生重复冲突则停止并人工处理，不自动删帖。迁移不会自动删除、合并历史重复内容。目前导入接口还会检查既有标题正文完全一致的旧帖子。
3. 单独评审并批准生产 D1 的表结构升级、数据库备份、主站应用发布和开发内容同步。**目前未批准，不能提前执行。**
4. 生产升级并核对目标 UUID、审核内容后，先运行只读计划：
   `npm run sync:production -- --limit=20`
5. 获得生产数据操作的**单独明确授权**并取得备份后，使用 `--apply` 和准确的 `SPINE_SYNC_PRODUCTION_CONFIRM` 开关运行。同步后核对回执数、生产帖子/回帖和外键。
6. 每次重新同步时只处理未标记的主帖；曾同步过的主题新增评论**故意不补同步**。

### 局限

- 内容指纹保证**规范化后文本相同**的主帖不会重复插入；轻微改写、增删句子、翻译后的内容指纹不同，不是语义去重。
- 上线前需为历史未填指纹的帖子补算/审查冲突，否则唯一约束仅完整覆盖迁移后写入的新帖和已回填的旧帖。
- 开发库的回复如果来自其他真实用户，任务会停止，而不会假冒“未知用户”移入生产库；如未来要同步真实用户互动，需单独设计身份与许可规则。
- 脚本是命令行任务，不是管理后台按钮或已配置的 GitHub Actions。自动化触发和生产写权限需要另行部署/配置。
- 本次仅提交程序与规范；**没有实际把开发数据写入生产**。

### 开发测试记录

- GitHub Actions 本地自动验证：[run 42329131928](https://github.com/119shenhao/spine-community/actions/runs/42329131928)，**success**，包含 TypeScript 类型检查和 SQLite 集成测试：跨批次去重、同批次重复跳过、回复树不重复导入、回执永久排除已同步主题、原文保留、同步 SQL 反复执行幂等。
- 自动化测试成功不等于 Cloudflare 预览构建/远程 D1 验收成功。尚未在本次对生产 D1 执行迁移、补算或同步。

相关文档：[原导入接口](import-api.md) · [开发/生产发布规范](development-release-workflow.md)。
