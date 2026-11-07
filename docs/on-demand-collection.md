# Spine Community 按需采集

## 在 ChatGPT 里调用

- **执行 Spine 论坛采集**：检查全部六个来源，对已接通的来源采集，默认每站最多新增 7 篇。
- **执行 120ask 采集，优先腰椎术后康复**：只采指定来源，主题可随指令变化。也可以指定 Patient.info 或寻医问药。
- **检查 39 问医生、HealthUnlocked、Mayo 的采集状态**：仅检查，不认领、不入库。
- **用这份已授权导出导入 Spine 开发预览**：由明确知道授权范围的操作者提供已审核、可使用的完整导出。见下方导出格式。

## 来源状态（2026-11-07）

| 来源 | 代码 | 按需处理方式 |
| --- | --- | --- |
| 120ask | `120ask` | 解析公开问答页，核对回答区。存在无法核实的追问、隐藏回答或附件则跳过。 |
| 寻医问药 | `xywy` | 用 Chromium 等待公开回答渲染，检查回答数与结构。超时、不完整或未识别的追问跳过。 |
| Patient.info | `patientinfo` | 读取公开讨论 JSON，核对已返回回复与完整帖子 ID 流及回帖父子关系。默认返回不完整或超过接口限制时跳过。 |
| 39 问医生 | `ask39` | 只读扫描颈椎与腰椎公开分类的候选链接。抽查新旧问答时，见到标题、问题、补充说明重复的条目；多条医生答复也不能替代患者叙述。需要能核实的真实患者原帖及完整回复，才能按导出流程导入。 |
| HealthUnlocked | `healthunlocked` | 已找到带数字 ID 的公开索引链接，但测试的原帖请求返回 403。保持原站采集暂停，等获授权的完整导出或站方提供的访问渠道。 |
| Mayo Clinic Connect | `mayoclinic` | 可找到公开讨论和分页，但其《Terms of Use》限制自动访问、复制或索引。转载授权不代表具备自动访问例外。仅走站方授权的导出或其明确书面批准的渠道。 |

复核入口：[39 问医生腰椎分类](https://ask.39.net/browse/11760-1-1.html) · [39 问医生历史样本](https://ask.39.net/question/38519664.html) · [HealthUnlocked 的公开可见性说明](https://support.healthunlocked.com/article/35-how-do-i-change-who-sees-my-posts) · [HealthUnlocked 合作联系入口](https://about.healthunlocked.com/about-page-contact-us) · [Mayo Clinic Connect 使用条款](https://connect.mayoclinic.org/terms-of-use/)。

## ChatGPT 执行步骤

1. 先通过 GitHub 读取私有仓库 `119shenhao/spine-community` 的 `main/AGENTS.md`、[采集 SOP](ai-collector-sop.md)、[采集 API](collection-api.md)、[去重与同步规则](topic-dedup-and-sync.md) 和本文。代码及任务配置位于 `feature/v1-community-build-20261106`。
2. 用 GitHub 连接器读取开发分支上的 `.github/spine-collector-request.json`，取得其当前 blob SHA。用 `github_update_file` 提交一条新请求，`request_id` 每次唯一。仅修改该请求文件，脚本和工作流已固定。请求提交触发 `.github/workflows/spine-collector-on-demand.yml`。不需要 Actions dispatch 权限。
3. 新搜索前，先以 `mode: "inspect"`、空 `candidates` 获取选定来源的完整排除清单并确认预览接口可达。检查 Actions 日志中的 `plan` 和 `site_error`。已接通的来源再用搜索工具找公开候选链接，使用搜索结果的 URL 和简要元数据筛选，正文和回复由采集器在获准认领后打开。若只有候选检查需求，可把链接交给 `inspect` 对照排除清单。39 的只读检查额外探测四页官方目录。
4. 只有用户要求采集时，才提交新的 `mode: "collect"` 请求，选定 `sites` 并填入对应 `candidates`。每站最多提交 12 个规范 HTTPS 主题链接，每站 `limit` 为 1–7 个新增主题。工具在搜索后再次完整读取 exclusions，过滤、逐帖 claim，只处理 granted，原子 complete，失败 release。成功后回读标题、正文、原文语言、回复数量及父子关系，并复核 completed 标记。
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

使用与上面相同的请求格式及 `mode: "collect"`。本地程序先验证候选 URL，读取完整 exclusions，取得租约后再读取对应私有文件。每帖最多 49 条回复、8 层、单次提交小于 150 KB。授权导出流程目前没有实样本验收。

## 本轮验收

开发分支代码提交 `937ff21243f50eab245ed779548545c6a2a63ae9`。在 [只读运行](https://github.com/119shenhao/spine-community/actions/runs/42355074051) 中，六个来源的预览 exclusions 都成功读取。寻医问药及 Patient.info 两条历史样本成功排除，39 的四个分类页每页读到 15 条候选链接，未据此认定候选合格。现有 [开发分支检查](https://github.com/119shenhao/spine-community/actions/runs/42355074029) 通过。本轮验收没有调用 claim 或 complete，也没有执行数据库迁移。三个已接通来源此前通过真实导入，新的固定入口本轮验证范围为触发、预览访问、排除和候选检查。
