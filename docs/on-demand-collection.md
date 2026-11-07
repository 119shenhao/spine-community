# Spine Community 人工触发采集任务

## 如何调用

在 ChatGPT 对话中直接说：

- “执行 Spine 论坛采集”
- “执行 120ask 采集”
- “执行 Patient.info 采集”
- “执行寻医问药采集”
- “执行 Mayo Clinic Connect 采集”

收到这类请求后，按本文件和当前采集规程立即执行一轮。此任务只在用户提出请求时运行，不依赖定时任务。

## 五项任务与六个来源

| 任务 | 来源 | `site` |
| --- | --- | --- |
| 120ask 颈腰椎采集 | 快速问医生 | `120ask` |
| 寻医问药与39健康采集 | 寻医问药 | `xywy` |
| 寻医问药与39健康采集 | 39问医生 | `ask39` |
| Patient.info 论坛采集 | Patient.info | `patientinfo` |
| HealthUnlocked 采集 | HealthUnlocked | `healthunlocked` |
| Mayo Clinic Connect 采集 | Mayo Clinic Connect | `mayoclinic` |

“执行 Spine 论坛采集”表示分别尝试全部六个来源。每个来源单独统计候选、排除、认领和实际导入数。寻医问药与39问医生不能共用配额。

## 执行流程

开始外站搜索前，读取私有仓库 `119shenhao/spine-community` 的 main 分支以下最新文件：

1. `AGENTS.md`
2. `docs/ai-collector-sop.md`
3. `docs/collection-api.md`
4. `docs/topic-dedup-and-sync.md`

使用开发预览 API：

`https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev`

对每个来源独立完成以下步骤：

1. 使用对应 `site` 分页获取 `GET /api/collect/exclusions`，一直读取到 `next_cursor` 为空。
2. 在打开完整帖文和回复之前，按原站稳定问答 ID 过滤已完成与仍在认领的条目。
3. 批量调用 `POST /api/collect/claim`，每批最多30个。只处理状态为 `granted` 的帖子。
4. 从原站公开页面读取完整主帖、回复和楼中楼。保留原始标题、正文、语言和父子关系，不翻译、不补写，也不添加测试文字。每帖最多49条回复、8层、150KB。
5. 内容完整且符合授权范围时，用 `POST /api/collect/complete` 写入开发预览库。失败或内容不完整时，用 `POST /api/collect/release` 释放认领。
6. 通过论坛读取接口核对帖子、回复、层级和主题 ID，再确认 exclusions 已显示为 completed。

来源要求登录、页面被拒绝访问、站点请求频率受限、帖子内容不完整、包含无法取得的附件，或无法分辨真人问答与自动生成内容时，跳过对应候选并在结果中注明原因。不得绕过登录或访问限制，不得把搜索摘要当成完整原文。

## 采集器名称

- `chatgpt-on-demand-120ask`
- `chatgpt-on-demand-xywy`
- `chatgpt-on-demand-ask39`
- `chatgpt-on-demand-patientinfo`
- `chatgpt-on-demand-healthunlocked`
- `chatgpt-on-demand-mayoclinic`

## 汇报格式

按六个来源分别汇报候选数、排除数、成功认领数、新增主题数、新增回复数和失败原因。每篇实际新增主题提供原站链接与 `topic_id`。未实际完成 HTTP 写入及回读核验的内容不能报告为成功。

所有写入仅针对独立开发预览环境。此流程不触碰生产数据，也不自动同步到生产。
