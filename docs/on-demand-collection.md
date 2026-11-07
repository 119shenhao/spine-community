# Spine Community 按需采集

## 在 ChatGPT 里调用

- **执行 Spine 论坛采集**：检查全部六个来源，对已接通的来源采集，默认每站最多新增 7 篇。
- **执行 120ask 采集，优先腰椎术后康复**：只采指定来源，主题可随指令变化。也可以指定 Patient.info 或寻医问药。
- **执行 39 问医生和 HealthUnlocked 采集**：仅处理这两个来源。39 问医生可自动补充候选，HealthUnlocked 用公开原帖链接作为候选。
- **检查 39 问医生、HealthUnlocked、Mayo 的采集状态**：仅检查，不认领、不入库。
- **用这份已授权导出导入 Spine 开发预览**：由明确知道授权范围的操作者提供已审核、可使用的完整导出。见下方导出格式。

## 来源状态（2026-11-07）

| 来源 | 代码 | 按需处理方式 |
| --- | --- | --- |
| 120ask | `120ask` | 解析公开问答页，核对回答区。存在无法核实的追问、隐藏回答或附件则跳过。 |
| 寻医问药 | `xywy` | 用 Chromium 等待公开回答渲染，检查回答数与结构。超时、不完整或未识别的追问跳过。 |
| Patient.info | `patientinfo` | 读取公开讨论 JSON，核对已返回回复与完整帖子 ID 流及回帖父子关系。默认返回不完整或超过接口限制时跳过。 |
| 39 问医生 | `ask39` | 支持自动从颈椎和腰椎目录补充候选，或提供指定原帖。候选按手术、康复、病程和标题信息排序。逐篇核对患者描述和完整医生回复，跳过过短描述、同轮重复正文、缺失材料或回复结构不明的候选。 |
| HealthUnlocked | `healthunlocked` | 公开主题可按稳定数字 ID 采集。比对页面回复总数和实际回复节点，按 DOM 中的父子结构还原楼中楼；不完整或受限的主题跳过。 |
| Mayo Clinic Connect | `mayoclinic` | 用户确认了转载和访问授权，但本次 GitHub Actions 访问原帖仍返回 HTTP 403。保留带站方数字讨论 ID 的完整授权导出路径。 |

复核入口：[39 问医生腰椎分类](https://ask.39.net/browse/11760-1-1.html) · [39 问医生历史样本](https://ask.39.net/question/38519664.html) · [HealthUnlocked 的公开可见性说明](https://support.healthunlocked.com/article/35-how-do-i-change-who-sees-my-posts) · [HealthUnlocked 合作联系入口](https://about.healthunlocked.com/about-page-contact-us) · [Mayo Clinic Connect 使用条款](https://connect.mayoclinic.org/terms-of-use/)。

## ChatGPT 执行步骤

1. 先通过 GitHub 读取私有仓库 `119shenhao/spine-community` 的 `main/AGENTS.md`、[采集 SOP](ai-collector-sop.md)、[采集 API](collection-api.md)、[去重与同步规则](topic-dedup-and-sync.md) 和本文。代码及任务配置位于 `feature/v1-community-build-20261106`。
2. 用 GitHub 连接器读取开发分支上的 `.github/spine-collector-request.json`，取得其当前 blob SHA。用 `github_update_file` 提交一条新请求，`request_id` 每次唯一。仅修改该请求文件，脚本和工作流已固定。请求提交触发 `.github/workflows/spine-collector-on-demand.yml`。不需要 Actions dispatch 权限。
3. 新搜索前，先以 `mode: "inspect"`、空 `candidates` 获取选定来源的完整排除清单并确认预览接口可达。检查 Actions 日志中的 `plan` 和 `site_error`。已接通的来源再用搜索工具找公开候选链接，使用搜索结果的 URL 和简要元数据筛选，正文和回复由采集器在获准认领后打开。若只有候选检查需求，可把链接交给 `inspect` 对照排除清单。39 问医生的只读检查额外探测十页官方目录。
4. 只有用户要求采集时，才提交新的 `mode: "collect"` 请求，选定 `sites` 并填入对应 `candidates`。每站最多提交 12 个规范 HTTPS 主题链接，39 问医生可提供最多 36 个。39 问医生未提供候选时，采集器会在读取排除清单后从目录选择最多 36 个新候选。每站 `limit` 为 1–7 个新增主题，重复和不合格候选不计入新增。工具在搜索后再次完整读取 exclusions，过滤、逐帖 claim，只处理 granted，原子 complete，失败 release。成功后回读标题、正文、原文语言、回复数量及父子关系，并复核 completed 标记。
5. 通过 GitHub Actions 查询 **对应提交 SHA** 的运行，等待完成后读取 `collector` job 的日志。按站报告候选、已排除、认领、已验证新增帖与回复、重复、待核对和跳过原因。逐帖报告 `imported` 事件的来源链接及 `topic_id`。带 `unverified` 或 `mark_failures` 的条目必须如实标出。若需再次运行，提交新的请求并重新去重。

最小请求示例（仅检查）：

```json
{
  "request_id": "check-20261107-001",
  "mode": "inspect",
  "sites": ["ask39", "healthunlocked", "mayoclinic"],
  "candidates": {},
  "limit": 7
}
```

请求文件只放站点代码、规范公开链接和数量等参数。正文、账号、导出文件和 claim token 不进入 GitHub 提交或 Actions 日志。脚本只请求独立开发预览 Worker，按原语言和层级入库。工作流只在开发分支收到新的请求文件提交时触发。

## 导入获授权的导出

在能访问开发预览、并能私下读取导出文件的执行环境，用同一套工具。先核对转载及使用范围、患者叙述、完整回复、附件和个人信息。将每帖规范化为 [采集 API](collection-api.md) 的 `topic` 对象，保存到 `<private-dir>/<site>/<source_id>.json`。不把文件提交到仓库。Mayo 另需 `<private-dir>/mayoclinic-ids.json`，将原帖规范 URL 映射到站方提供的稳定数字讨论 ID。资料不全、授权范围不清、需要登录的材料先暂停。

```bash
python -m pip install 'beautifulsoup4==4.13.4'
python scripts/spine_collect.py /private/request.json --export-dir /private/authorized-export
```

使用与上面相同的请求格式及 `mode: "collect"`。本地程序先验证候选 URL，读取完整 exclusions，取得租约后再读取对应私有文件。每帖最多 49 条回复、8 层、单次提交小于 150 KB。本轮未执行 Mayo 授权导出导入。

## 初版入口的只读验收

开发分支代码提交 `937ff21243f50eab245ed779548545c6a2a63ae9`。在 [只读运行](https://github.com/119shenhao/spine-community/actions/runs/42355074051) 中，六个来源的预览 exclusions 都成功读取。寻医问药及 Patient.info 两条历史样本成功排除，39 的四个分类页每页读到 15 条候选链接，未据此认定候选合格。现有 [开发分支检查](https://github.com/119shenhao/spine-community/actions/runs/42355074029) 通过。本轮验收没有调用 claim 或 complete，也没有执行数据库迁移。三个已接通来源此前通过真实导入，新的固定入口本轮验证范围为触发、预览访问、排除和候选检查。

## 39 问医生、HealthUnlocked 和 Mayo 实采记录（2026-11-07）

开发分支采集器提交 [`2e85508`](https://github.com/119shenhao/spine-community/commit/2e85508e49ca1eb1c2240d00ca485b0763e7261e)。本次入库仅使用开发预览 API。

| 来源 | 实际结果 | 执行记录 |
| --- | --- | --- |
| 39 问医生 | 初轮 36 个候选未入库。扩大目录范围并按病程和手术、康复信息排序后，复跑 36 个候选，新增 1 篇、1 条回复。其余 34 篇描述过短，1 篇缺少可核对的患者背景。 | [初轮](https://github.com/119shenhao/spine-community/actions/runs/42357599276) · [复跑](https://github.com/119shenhao/spine-community/actions/runs/42357839672) |
| HealthUnlocked | 检查 4 个候选，新增 1 篇、20 条回复。其余 1 篇含未采集媒体，2 篇未通过颈椎、腰椎相关性筛选。 | [采集](https://github.com/119shenhao/spine-community/actions/runs/42357599276) |
| Mayo Clinic Connect | 普通公开原帖请求返回 HTTP 403，探测时释放认领，新增 0 篇。继续使用上文所列的完整授权导出方式。 | [访问探测](https://github.com/119shenhao/spine-community/actions/runs/42357347494) |

两篇新增主帖的标题、正文、原文语言和回复树均已通过预览 API 回读核对，采集记录均为 `completed`。后续可直接说「执行 39 问医生和 HealthUnlocked 采集」或指定任一来源。39 问医生正文指纹去重与其他来源共享，另在同轮拒绝重复正文。正文近似改写不属于精确指纹去重。
