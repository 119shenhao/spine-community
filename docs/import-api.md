# 开发环境帖子与跟帖导入 API

日期：2026-11-06。实现分支：`feature/v1-community-build-20261106`。

## 使用范围

仅开发／预览允许，**不需要密钥、Cookie 或 Google 登录**。生产入口在访问数据库前拒绝，且没有 `IMPORT_DB` 绑定。不提供生产导入或测试数据同步。任何知道开发接口地址的人都能向测试库提交，因此只放虚构开发数据。

开发根地址：

`https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev`

本地允许 `localhost`、`127.0.0.1`、`[::1]`，使用 `wrangler.local.jsonc`。服务端还要求 `APP_ENV=local/preview`、`IMPORT_ENABLED=true`、独立 `IMPORT_DB` 绑定；预览仅允许上述确切域名。请求参数、Host 头、登录态均不能打开生产接口。

## 账号

- 固定内部 ID：`system-unknown-import`（不变）；昵称／前台作者名：**Anonymous**（原为“未知用户”；2026-11-09 确认更名）。
- 数据库迁移 `migrations/v1/0003_import.sql` 创建唯一的系统账号（`is_system=1`），后续迁移 `migrations/v1/0099_import_author_english_name.sql` 仅将旧昵称更新为 `Anonymous`；历史迁移仍保留原始内容，不计入正常注册人数。开发分支已提交，预览数据库应用情况仍需验证；生产需按发布审批迁移。
- 无 Google 身份、密码或登录入口。数据库约束禁止给系统账号创建身份、会话、管理角色；Worker 也拒绝其登录与会话。
- 所有导入内容的作者由服务端固定，不能指定其他用户；不保存原站作者、原站帖子编号、来源链接。

## 接口

| 方法与路径 | 请求内容 | 返回 |
| --- | --- | --- |
| `GET /api/import/account` | 无 | 固定账号及 `canLogin=false` |
| `POST /api/import/topics` | 单个帖子，可附带评论树 | 导入结果 |
| `POST /api/import/comments` | `topic_id`、正文，可指定已有上级回复 | 导入结果 |
| `POST /api/import/batch` | `topics` 数组和／或 `comments` 数组 | 整批原子导入结果 |

POST 使用 `Content-Type: application/json`。命令行无需 `Origin`；浏览器若携带 Origin，必须同源，不开放跨站浏览器调用。

### 帖子与跟帖字段

帖子必填 `title`（1–200 字符）、`body`（1–30000 字符）；可选 `source_lang`、`terms`（最多16个已启用分类ID）、`symptom_duration_days`（0–36500整数）、`comments`。

评论必填 `body`（1–12000 字符）；可选 `source_lang`、`replies`。独立提交评论还必填本站 `topic_id`，可选本站 `parent_comment_id`；上级必须属于同一帖子且可见或已删除占位。现有帖子须为已发布状态。

`comments`／`replies` 是评论数组，可嵌套。所有评论固定 `kind=regular`，不会自动变成“楼主进展”。不支持通过本接口编辑、删除、赋予身份、伪造赞数或指定审核状态。未知字段报错，不悄悄接受 `author_id`、`kind` 或来源字段。

所有输入先校验再整体提交。一条不合法则整批不写入内容。每次最多10个新帖子、总计50条帖子＋评论、评论树深度8层、150000字节请求体；开发导入全局每分钟最多30次非重复提交尝试。

### 批量示例

仓库示例：[import-example.json](examples/import-example.json)。

```json
{
  "topics": [
    {
      "title": "Development test: sample discussion",
      "body": "Fictional content used only to test the import API.",
      "source_lang": "en",
      "comments": [
        {
          "body": "First sample reply.",
          "replies": [{"body": "A nested sample reply."}]
        }
      ]
    }
  ]
}
```

```sh
curl --request POST \
  'https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/api/import/batch' \
  --header 'Content-Type: application/json' \
  --data-binary @docs/examples/import-example.json
```

独立添加跟帖：

```json
{"topic_id":"接口返回的本站帖子ID","body":"测试跟帖","source_lang":"zh-CN"}
```

回复已有跟帖时再加 `parent_comment_id`，填写返回的本站评论 ID，不是外站编号。

### 返回、去重与审核

新导入返回 `201`；`author` 为固定账号，`imported` 给出帖子／评论数量，`results` 按提交树顺序返回每条内容的 `path`、`type`、本站 `id`、`topic_id`、评论的 `parent_comment_id`、审核 `status`；`replayed=false`。

同一接口、同一 JSON 数据（对象字段次序不影响）重试返回 `200` 和原有结果，`replayed=true`，不会重新创建内容、增加回复计数或统计。无需调用方提供幂等键或原站标识。**更新（2026-11-07，开发分支功能，生产尚未发布）：** 迁移 `0004_content_fingerprint_sync.sql` 后，主帖新增内容指纹和 D1 唯一索引。相同（规范化标题＋正文）的主帖即使分散到不同批次再次导入，也会被跳过，附带的整棵回帖树也不再导入；响应 `skipped.topics` 增加，结果项包含 `skipped=true` 和数据库里已有的主题 ID。**没有新写入时返回 HTTP 200。** 回帖本身不生成指纹。该变更只在实现分支，尚未合并到生产 `main`。参见 [主帖去重与一次性同步方案](topic-dedup-and-sync.md)。

旧版（`0003`）仅对相同完整请求做幂等处理，不会跨批次逐帖去重。删除已导入内容后重试旧请求也不会复活内容。

`import_batches` 只保存请求哈希与结果 ID／状态，不存来源信息或另一份正文。导入记录的状态反映首次导入结果；后续审核、编辑和删除以内容详情为准。

沿用正常低／中／高风险规则：`published`、`pending_review`、`blocked`。受限内容不公开搜索；新帖的评论也受所属帖可见性约束。分类、全文索引和回复计数沿用现有结构。导入不发送站内通知，不触发翻译调用；统计计入导入当日的帖子／评论数，不计为新注册或页面访问。

### 常见错误

| 状态 | 示例错误 | 含义 |
| --- | --- | --- |
| 403 | `import_disabled` | 环境、域名、开关或专用数据库不满足要求，未访问数据库 |
| 400 | `unknown_import_field` | 传入不支持的字段 |
| 400 | `cross_topic_reply` | 上级回复属于其他帖子 |
| 404 | `topic_not_open` / `parent_not_found` | 目标不存在、隐藏或不可回复 |
| 400 | `too_many_topics` / `too_many_items` / `reply_depth_exceeded` | 超出批量限制 |
| 413 / 415 | `request_too_large` / `json_required` | 请求过大或非 JSON |
| 429 | `rate_limit` | 开发导入限流 |
| 503 | `import_account_unavailable` / `service_unavailable` | 账号未准备好、迁移缺失或数据库失败 |

数据库失败时整批内容和去重记录一起回滚，可重试。并发相同请求利用数据库唯一哈希避免重复写入。

## 验证记录

- TypeScript 与25项集成测试通过，含9项新增导入测试：生产关闭及无数据库访问、系统账号禁止登录／授权、免密批量和嵌套、单条接口、去重、跨帖和隐藏内容拒绝、长度和数量限制、审核、失败回滚及测试库隔离。
- 本地 Wrangler 已成功应用 `0003_import.sql`。本机 Wrangler HTTP 启动遇到运行环境的 `uv_interface_addresses` 错误，不能把该步骤写成已完成浏览器验收。
- 远程 Cloudflare Preview 构建 **success**，代码提交 `1df625b0209928db6e7e84d8d8b3093ea32be27b`，Build ID `80d3bb81-cfe3-413a-b540-d5183f4ee9d9`；构建前自动执行了测试库迁移，远程 `/api/import/account` 确认账号存在且 `canLogin=false`。
- 远程健康检查：`version=0.2.0-preview.2`、`databaseReady=true`、`importEnabled=true`。
- 实际无密钥／无 Cookie 导入：批量1帖＋2条嵌套回复返回201；原请求重放返回200及原ID；单独追加1条回复、单帖接口均返回201。
- 两个相同请求并发提交实际得到201和200，内容ID相同；跨帖上级返回400 `cross_topic_reply`，伪造作者返回400 `unknown_import_field`，无效批次返回400 `invalid_title`。
- 2026-11-06 历史验收：浏览器确认导入帖子及3条回复作者均显示旧称“未知用户”，楼中楼链接正常，无楼主进展。测试后预览库保留3篇明确标为 Development test 的虚构帖子和3条回复，便于复查。
- [查看实际测试讨论](https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/#/topic/a2a118dc-a057-474d-9c05-a79c384d3bf6)。
- 生产关闭由隔离Worker测试确认403且零数据库访问；**未向正式站发送写入测试、未提交main、未迁移生产D1**。现有正式站未发布本次代码。

相关：[需求](开发需求/帖子与跟帖导入接口需求.md) · [实现进度](implementation-v1-2026-11-06.md) · [发布规范](development-release-workflow.md)。
