# Spine Community — 开发预览采集协调 API

**必须先阅读：[AI 采集工作流程](ai-collector-sop.md)。** 本接口不是爬虫：它帮助多个具备搜索/网页访问能力的 AI 协作排除已采集帖子、抢占采集权、在开发库原子去重入库。没有任何新生产 HTTP 导入端点。

## 地址、免密访问与环境限制

- 预览根地址：`https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev`
- 仅当 Worker 运行在**预览/本地环境**，`IMPORT_DB` 指向隔离开发库，`IMPORT_ENABLED=true`、`COLLECT_ENABLED=true` 时启用。部署了新接口代码的生产环境会在访问数据库之前返回 `403 collect_disabled`；若生产仍使用未包含该路由的旧代码，可能返回 `404 not_found`。
- **不需要密钥、Bearer、Cookie 或登录**：开发预览环境的四个采集接口可以直接 HTTP 访问。请注意，这是公开可调用的开发入口，任何知道地址的人都可以读取采集 ID、认领帖子或向开发数据库提交内容；保留了请求限流、认领令牌、字段校验、内容指纹和数据库唯一约束，但这些机制**不能替代身份认证、防止所有恶意写入**。不要把预览数据自动发布到生产环境。
- 请求使用 `Content-Type: application/json`；跨域浏览器请求被拒绝；命令行客户端无需 Origin。响应禁用缓存，始终 JSON。
- 每个站点有稳定编码：`tieba`、`reddit` 等。`source_id` 是外站原帖唯一 ID，**不传原站整条 URL**；贴吧目前限定 1–20 位数字，Reddit 目前限定 1–15 位小写字母/数字，其他站点仅允许字母、数字、下划线和连字符。
- 采集 ID/状态存于开发 D1 的 `collect_sources`，仅内部使用，不会自动公开原站链接或假冒原站作者。`topic.content_hash` 是规范化标题＋正文的 SHA-256，与生产一次性同步指纹算法相同。

### ① 搜索前获取排除清单

`GET /api/collect/exclusions?site=tieba&limit=200`

可选参数：`cursor=上一页 next_cursor`；`limit` 为 1–500，默认 200。每次请求只返回单一站点的**已完成**和**未过期认领**，按 ID 字典序排列。旧的、过期的认领不在清单里，主动释放也不在清单里。

```json
{
  "site": "tieba",
  "as_of": 1794038400,
  "items": [
    {"source_id":"123456789","status":"completed","lease_expires_at":null},
    {"source_id":"123456790","status":"claimed","lease_expires_at":1794060000}
  ],
  "next_cursor": null
}
```

**必须翻页直到 next_cursor 为 null**，不能把第一页当全量。一次快照中的数据仍可能随其他 AI 的提交改变，所以候选 ID 还必须走 claim；每轮搜索前应刷新清单。

### ② 批量认领候选 ID（进入正文前）

`POST /api/collect/claim`

```json
{
  "site": "tieba",
  "collector_id": "deepseek1",
  "source_ids": ["123456789", "123456790", "123456791"]
}
```

`collector_id` 是仅用于后台协作的采集程序名（1–40 字符，字母数字/`_`/`-`），**不是论坛用户身份**。一次提交 1–30 个**不重复**帖子 ID。

```json
{
  "site": "tieba",
  "lease_seconds": 21600,
  "results": [
    {"source_id":"123456789","result":"completed","lease_expires_at":null},
    {"source_id":"123456790","result":"in_progress","lease_expires_at":1794060000},
    {"source_id":"123456791","result":"granted","lease_token":"(实际返回的随机临时令牌)","lease_expires_at":1794060000}
  ]
}
```

- **granted**：才可以完整采集；保管该 ID 对应的 token。
- **completed**：已处理，不重复采集；不再补采新评论。
- **in_progress**：别人在采，立即跳过。
- 同 ID 的并发竞争由 `INSERT ... ON CONFLICT ... WHERE` 的单条 D1 原子语句处理，只有一个赢家；认领超过 21600 秒（6 小时）则允许其他 AI 重新认领，旧 token 无效。没有续租功能。

### ③ 采集完成，原子去重并写入开发库

`POST /api/collect/complete`

```json
{
  "site": "tieba",
  "source_id": "123456791",
  "lease_token": "步骤②获得的真实临时令牌",
  "topic": {
    "title": "Example headline in the source language",
    "body": "Example body in the same source language",
    "source_lang": "en",
    "comments": [
      {
        "body": "Example reply in its original language",
        "source_lang": "en",
        "replies": [
          {"body": "Another nested reply", "source_lang": "en"}
        ]
      }
    ]
  }
}
```

此 JSON 的文字只作接口结构演示，不是实际的患者讨论，**请勿复制示例作为论坛内容**。

`topic` 参数和旧导入接口的单篇帖字段保持一致：`title`（1–200 字符）、`body`（1–30000 字符）、`source_lang`、`comments`、可选 `terms`（分类 ID 数组，最多 16 个）及 `symptom_duration_days`。每条评论支持 `body`、`source_lang`、`replies`，最多 49 条、嵌套深度最多 8 层；总体请求体 150KB 上限。**原站作者、原站链接不属于 forum 内容字段**；不能用 body 自造真实用户互动。

**成功创建新帖（HTTP 201）：**

```json
{
  "site": "tieba",
  "source_id": "123456791",
  "status": "completed",
  "duplicate": false,
  "topic_id": "系统生成的主题UUID",
  "topic_status": "published",
  "imported": {"topics":1, "comments":2}
}
```

**内容指纹已在其他帖子里存在（HTTP 200）：**

```json
{
  "site": "tieba",
  "source_id": "123456791",
  "status": "completed",
  "duplicate": true,
  "topic_id": "已存在的主题UUID",
  "imported": {"topics":0, "comments":0}
}
```

重复同一请求（相同 claim token、相同主帖标题与正文）在成功后重试，返回 `200` 和 `already_completed=true`，不会再写入评论。若主帖内容不同返回 `409 completion_payload_mismatch`。

**事务保证：** SQLite 触发器在提交事务中再次检查有效锁，随后主帖正文指纹及唯一索引进行最终去重。帖子、楼中楼、统计计数和 `collect_sources` 采集完成标记在一个 D1 batch 里提交；任一步失败则整体回滚，锁尚未到期可以重试。

### ④ 无法采集时主动释放锁（推荐）

`POST /api/collect/release`

```json
{
  "site": "tieba",
  "source_id": "123456791",
  "lease_token": "步骤②获得的真实临时令牌"
}
```

成功返回 `{"site":"tieba","source_id":"123456791","status":"released"}`。其他 AI 立刻可重新认领。不是当前 token、锁已过期或帖子已完成时返回 `409 claim_not_owned_or_expired`，不能解锁其他 AI 的任务。崩溃后无须人工释放，6 小时自动过期。

## 返回错误和恢复

| HTTP | error | 处理建议 |
| --- | --- | --- |
| 403 | `collect_disabled` | 非预览地址、开关关闭或无独立 DB；停止，不对生产重试 |
| 400 | `invalid_site` / `invalid_source_id` | 先从候选 URL 解析正确的站点及原帖 ID |
| 400 | `duplicate_source_id` / `invalid_claim_batch_size` | 去除同一批次重复 ID；每批至多 30 个 |
| 400 | `too_many_items` / `reply_depth_exceeded` | 评论总数/楼中楼层级超限 |
| 409 | `claim_not_owned_or_expired` | 刷新排除清单、重新认领，不继续旧令牌 |
| 409 | `already_collected` / `completion_payload_mismatch` | 不能用不同令牌/不同正文重做已完成 ID |
| 409 | `ambiguous_existing_content` | 历史数据库存在多份匹配，人工核查 |
| 429 | `rate_limit` | 等待，适当减少调用频率 |
| 503 | `service_unavailable` | 记录失败、重试同一有效令牌，不宣布成功 |

## 安全、边界和部署

1. 现有 `/api/import/topics|batch` 未被废弃，但直接调用没有外站 ID，不会自动补全排除列表；多 AI 正式采集统一改用 collect claim → complete。
2. 免密开放意味着预览采集 ID 列表可被任何知道预览地址的人读取，且采集与发帖入口可能被恶意调用；预览数据库表 `collect_sources` 不存全文副本，正文只存现有 `topics`、`comments`。生产环境仍严格拒绝采集路由，生产同步必须人工审查和授权。
3. 现有 Cloudflare **生产 D1 不得自动应用新迁移**。迁移文件是 `migrations/v1/0005_collect_coordination.sql`，仅开发预览构建流水线在确认环境后执行。生产代码中 `COLLECT_ENABLED` 未开启，API 禁止访问。
4. 新代码在开发分支 `feature/v1-community-build-20261106`；文档固定在 `main/docs`。客户端不需访问密钥，但 `claim` 返回的 `lease_token` 是该帖子的临时认领凭据，应避免出现在日志或公开聊天中。
5. 若 AI 只具有文本聊天能力，应由你提供具备网络/API 动作能力的外部采集器；拿到本文不意味着 AI 真的可以替你发 HTTP 请求。

## 测试内容

自动集成测试覆盖：默认拒绝生产、预览免密请求、6 小时租约、分页、并发认领、释放重领、锁过期、旧 token 失效、完成后即时排除、主帖和楼中楼原语种保留、跨来源相同正文去重、直接导入旧帖关联、同一完成请求重放、事务故障回滚、数量限制与输入校验。

Cloudflare 预览不再需要配置采集 Secret；本地/CI 测试通过不等于已经进行了生产同步。不会把测试帖写入正式数据库。

[AI 操作规程](ai-collector-sop.md) · [原导入接口](import-api.md) · [一次性主帖跨库同步](topic-dedup-and-sync.md)

## 2026-11-07 旧版验证记录（采用密钥的历史版本，已被新版取代）

- [GitHub Actions TypeScript + SQLite 集成测试](https://github.com/119shenhao/spine-community/actions/runs/42330870727)：**success**。包括生产隔离、专用鉴权、排除清单分页、并发认领、锁过期与释放、英文内容及楼中楼原样保存、跨来源指纹去重、崩溃/写入失败回滚、旧内容关联、重复完成的幂等验证。
- [Cloudflare Workers 预览构建](https://github.com/119shenhao/spine-community/runs/128276961775)：**success**，开发分支提交 `b46baa719a5a970d39347f9e7eb29f2e37ff53bd`；预览构建原有流程会针对独立 preview D1 应用迁移。
- [预览站远程只读 HTTP 验证](https://github.com/119shenhao/spine-community/actions/runs/42330870725)：**success**。`/api/health` 确认数据库可用；无 Bearer 访问 `/api/collect/exclusions` 返回 `503 collect_secret_not_configured`，证明新路由已部署且不会匿名读取采集清单。
- **未进行远程带密钥的 claim/complete 写入验收**：当前 Cloudflare 预览环境未设置 `COLLECT_API_TOKEN`，需要通过 Cloudflare 安全配置填入至少 32 字符的专用密钥，再以虚构、明确的测试记录进行远程闭环验收，测试后清理这些记录。生产 D1 完全不参与本轮验证。

## 2026-11-07 最新规则（免密版本）

- **免密访问：** 不再要求 `COLLECT_API_TOKEN`，仅通过预览域名和开关限制采集 API；命令行调用不需要 Authorization。使用真实的 `lease_token` 仍是完成、释放指定帖子的必要条件，它不是全局密钥。
- **采集认领期：** `lease_seconds=21600`（6 小时）。认领过期后新采集者可以接替，已有旧认领在过期前仍按其原截止时间生效。
- **保留保护：** 原子认领、输入限制、请求限流、主帖唯一指纹及事务回滚；不保证能防止恶意的外部匿名访问者占用采集位或向预览库提交垃圾内容。生产 DB 不开放这些采集接口。
- 以前的密钥版验证记录仅用于历史追溯，不再代表当前接口。最新测试结果以开发分支工作流记录为准。

## 2026-11-07 免密六小时版本实际验证

- [GitHub Actions 开发分支自动测试](https://github.com/119shenhao/spine-community/actions/runs/42331386739)：**success**。包含开发/生产环境隔离、未提供任何密钥时的采集认领、21600 秒期限、正文与楼中楼去重等集成测试。
- [开发预览环境远程认领和释放测试](https://github.com/119shenhao/spine-community/actions/runs/42331386745)：**success**。没有传 Authorization/密钥，排除清单返回 HTTP 200；实际在独立预览 D1 用 `smoke` 测试站点成功认领 1 个测试编号，返回 `lease_seconds=21600`，核对到期时间后成功释放。**没有创建测试帖子，也没有访问生产 D1**。
- 原先旧版本的 `COLLECT_API_TOKEN` 需求已经撤销；无需在 Cloudflare 配置采集密钥。
