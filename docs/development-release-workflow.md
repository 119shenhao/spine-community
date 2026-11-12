# Spine Community — 开发、预览、数据库迁移与正式发布规范

> **状态：已确认的长期执行规范｜确定日期：2026-11-06**
>
> 本规范适用于本仓库的人工开发、ChatGPT 和 Codex。优先级：安全边界与用户最新明确指令 > 本规范 > 一般实现习惯。若与已确认的产品需求冲突，应停下核对，不擅自替用户修改业务规则。
>
> 相关文档：[第一版需求总览](开发需求/项目需求总览.md) · [需求决定记录](开发需求/需求决策记录.md) · [数据库设计草案](database/d1-v1-design.md) · [数据库审核报告](database/d1-v1-review-2026-11-06.md)。
>
> **注意：本文件管理长期流程；实际代码、测试和预览配置状态见 [最新开发进度](implementation-v1-2026-11-06.md)。开发预览可用不代表已获准正式发布。**

## 文档分支规则（2026-11-06 用户最新确认）

- **所有文档统一在 `main` 分支的 `docs/` 下创建、修改和提交**，包括需求、API 文档、JSON 示例、设计草案、测试/验收记录和开发进度；不再以开发分支维护文档。
- 这是对纯文档提交 `main` 的持续授权，无需每次重复确认。开发分支的 `docs/` 已清空；旧文档仍可从 Git 历史查阅。之后查看和引用文档一律使用 `main` 链接。
- 开发程序、测试代码、可执行迁移和部署配置仍在 feature 分支；**文档更新不授权合并或发布程序代码、不授权生产数据库操作**。
- 即使正在开发分支工作，也应先读取 GitHub `main` 上的最新文档，再开发程序；完成后将文档与进度单独提交至 `main/docs/`，不把开发分支旧文档覆盖回主分支。
- 文档可以记录开发预览已实现的能力，须明确对应代码分支/提交和验证环境；**文档已进入 main 不表示代码已进入生产**。
- 纯文档提交仅包含 `docs/` 文件；保持既有构建过滤规则，不为更新文档改动源码、根目录配置或数据库。

## 1. 固定环境与命名

| 项目 | 开发／预览 | 生产 |
| --- | --- | --- |
| GitHub 仓库 | `119shenhao/spine-community` | 同一私有仓库 |
| Git 分支 | `feature/v1-community-build-20261106`（目前第一版使用；将来可按任务建立其他 feature 分支） | `main` |
| Cloudflare Worker | 同一 `spine-community` Worker 的 **Worker Preview** 环境 | `spine-community` 的 Production |
| 网页地址 | [预览地址](https://feature-v1-community-build-20261106-spine-community.119shenhao.workers.dev/) | [生产自定义域名](https://spine.nbn369.com/)（旧 Worker 地址：`https://spine-community.119shenhao.workers.dev/`） |
| D1 名称 | `spine-community-db-preview` | `spine-community-db` |
| D1 ID | `4362537a-5748-4a05-b0c4-219c3db36996` | `5919ff78-b8fc-46ab-85f0-01fe5e6a41b0` |
| 配置路径 | 分支中的 `wrangler.jsonc → previews.d1_databases` | `wrangler.jsonc → d1_databases` |
| 测试数据 | 测试账号和虚构帖子，可在约定后重置 | 真实用户数据，不得当作测试数据重置 |
| 部署时机 | 开发分支提交自动预览构建（以实际构建成功为准） | 仅在用户确认后合并和发布 |

当前已确认：新版开发预览已部署，独立测试 D1 已初始化，远程健康检查返回 `databaseReady=true`，分类和空列表已读取。**真实Google登录及登录后的远程CRUD还需配置凭据并验收；一次构建成功不代表以后所有部署自动成功**。

**绝对禁止：**
- 让预览 Worker 连接生产 D1（即使名称和绑定变量都叫 `DB`）；
- 将生产用户、健康帖子、Google 身份信息或机密复制到预览数据库；
- 将预览库的**数据**同步或覆盖到生产库；
- 未经明确授权将程序代码提交/合并到 `main`，或执行任何生产 D1 写操作；纯 `docs/` 文档提交按上方长期授权执行；
- 因为有 Cloudflare 可回滚机制就跳过发布前备份与影响评估。

## 2. 日常开发流程（默认无需每个小改动都重新征求许可）

1. **读取规范与需求**：Codex 先读 GitHub `main` 的本文、`docs/开发需求/项目需求总览.md` 和相关专题；代码开发核实 feature 分支，文档维护使用 `main`。遇到冲突、未确认的产品决定要说明，不擅自填补重要需求。
2. **实现并自测**：在开发分支修改程序代码、测试和可执行数据库迁移；需求、设计草案和开发进度等文档单独提交至 `main/docs/`；禁止使用生产凭证或真实数据测试。需求决定与代码状态分开记录。
3. **提交预览**：推送开发分支，让 Cloudflare 自动预览构建（`npx wrangler preview`）；检查构建日志、预览 Worker 绑定、预览 URL 以及后端健康检查。**提交成功不代表部署成功**。
4. **预览验收**：将完整预览 URL 和变更说明提供给用户；测试手机/电脑页面及相关 API、权限、无障碍、跨语言、错误路径。用户可直接在预览站反馈问题。
5. **持续修复**：同一 feature 分支迭代，直到测试通过；允许多次预览发布。开发阶段不因小改动频繁请求用户批准生产发布。
6. **准备正式上线**：汇总代码 diff、SQL 迁移清单、兼容性/隐私/费用影响、测试结果、备份/恢复方法和风险，**请求用户明确确认**。
7. **正式发布**：获批后按第 4 节执行数据库/代码变更及上线检查。未经批准不得合并/推送程序代码到 main，也不得远程执行生产迁移；纯文档 main 提交不受此代码发布批准限制。

### 文档提交与 Cloudflare

现有 Cloudflare 构建监视路径已设置为包含 `*`、排除 `docs/*`，经先前用户测试，**纯 `docs/` 提交不会触发生产构建**。不要为更新需求和规范而改动站点代码或调整生产部署过滤器；如果更改了路径配置，要重新验证。根目录的 `AGENTS.md` 等文件不在排除范围内，**修改它可能触发构建**，不能将其误认为纯 `docs/` 更新。

## 3. 数据库版本管理：迁移结构与必要基础数据，不复制开发库业务数据

**核心原则：代码通过 Git 分支/合并发布；D1 表结构和本版本必需的系统基础数据通过经审核的版本化迁移 SQL 升级或初始化；真实用户与业务数据始终属于各自环境，不从开发库整库复制。**

- 迁移 SQL 统一纳入 Git 版本控制，按序编号，作为数据库结构的可审查历史；禁止手动在生产控制台随意改表后不留脚本。
- 每次功能涉及表/索引变更：先编写迁移，再在隔离的本地 SQLite / D1 测试环境验证，最后对 `spine-community-db-preview` 应用并测试。
- **早期 `migrations/0001_initial.sql` 已归档为 `docs/archive/0001-initial-legacy.sql`，不得执行；活跃实现迁移为 `migrations/v1/`，已在本地及独立测试 D1 初始化。** `docs/database/d1-v1-schema-draft.sql` 也只是设计草案，不能直接当正式迁移。
- 新版 schema 应处理多分类、楼中楼、楼主进展、多语言、删除占位、权限和索引；迁移需要具备重复执行安全性（由 D1 migration tracking 管理）、测试数据兼容性及失败处置。
- **预览库迁移应使用专门配置文件** `wrangler.preview-migrations.jsonc`（**本次开发已创建并用于测试库迁移**），其中将 `PREVIEW_DB` 顶层绑定到 **`4362537a-5748-4a05-b0c4-219c3db36996`**，并保持其数据库 ID 与 `wrangler.jsonc → previews.d1_databases` 完全一致。当前配置已固定并核对测试库 UUID；继续避免默认 Wrangler 顶层 `DB` 指向正式库。
- **示例命令（仅当上述预览迁移配置已创建并经过核对、正式迁移文件已通过测试后才允许运行）：**

  ```bash
  npx wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc
  ```

- 正式库执行迁移必须有**用户当次明确批准**；运行前核实账户、数据库名称与 ID、脚本 diff、影响行数和备份/恢复点。不得让普通开发分支推送自动触发生产 D1 迁移。
- **生产迁移不自动执行**仍是固定政策。本次开发已实现预览专用自动迁移：`scripts/prepare-build.mjs` 仅在 Cloudflare Builds 且分支严格匹配 `feature/v1-community-build-20261106` 时，先通过检查/测试、核对专用配置与预览绑定UUID，再尝试迁移测试库；未知旧结构立即停止，不覆盖现有数据，不在其他分支自动迁移。

官方参考：[Workers Preview 资源与 D1 迁移](https://developers.cloudflare.com/workers/previews/resources/) · [D1 Migrations](https://developers.cloudflare.com/d1/reference/migrations/)。

### 生产 D1 的受控 GitHub Actions 工作流（ChatGPT 触发，网页手动备用）

**只有发布涉及尚未应用的 SQL 迁移时，才需要操作生产 D1。** 纯界面或程序改动且确认没有待执行的迁移时，跳过数据库步骤，按第 4 节发布代码。生产库和开发预览库各自独立，迁移使用同一套版本化 SQL。分类、默认设置、「未知用户」等必要初始记录由 SQL 生成。开发库的帖子、回帖、楼中楼、用户和测试数据不随迁移复制。

#### 一次性配置

- 在 Cloudflare Worker `spine-community` 的「设置 → 构建 → 构建监视路径」里保留 `docs/*`，并排除 `.github/workflows/production-d1.yml`。单独更新这些文件时，Cloudflare 会跳过站点构建。
- 创建专用 Cloudflare Token，权限为 **Account → D1 → Edit**，范围限论坛所属账户。在本私有仓库 **Settings → Secrets and variables → Actions** 下保存为 `CLOUDFLARE_PROD_D1_API_TOKEN`。已配置的有效凭据可供后续迁移复用。令牌值只填 GitHub Secret，禁止放进源码、日志、聊天或预览环境。
- [Production D1 工作流](https://github.com/119shenhao/spine-community/actions/workflows/production-d1.yml) 已安装在 `main`。2026-11-07 增加了由 ChatGPT 向 `main/docs/release-requests/production-d1.json` 提交**明确的版本化请求**而触发原有 `workflow_dispatch` 的方式，先 `inspect`、必要时经明确授权才 `apply`；[实际只读验证 #42381742609](https://github.com/119shenhao/spine-community/actions/runs/42381742609) 已成功。GitHub 网页上的 Run workflow 保留为备用，用户默认**不需要手动点**。普通代码、文档推送和 Cloudflare 网站构建不会执行生产迁移；具体见 [固定任务：发布新版本](release-version-workflow.md)。

#### 每次有迁移时

1. **先验证开发预览库。** 在开发分支的 `migrations/v1/` 增加按序编号的 SQL，保留已应用的历史文件。先通过本地测试，再应用到 `spine-community-db-preview` 验证。准备发布 PR，记录包含已审核 SQL 的完整 40 位提交 SHA。这个提交须来自本仓库的 `main` 或 `release/*`。
2. **只读检查生产库。** 默认由 ChatGPT 在主分支写入对应的 `inspect` 请求，通过 GitHub 自动触发旧工作流；网页备用方法为在 **Actions → Production D1 → Run workflow** 选择 `main` 并填写 `inspect`。打开运行结果的 **Summary → Production D1 inspection**，查看 `Tables`、`Applied`、`Pending`。`Pending` 为空时跳过 `apply`；出现 `Migration blocked`、未知旧表、核心表缺失或迁移历史不一致时，先排查兼容性。运行状态为 `Success` 仍须查看摘要。
3. **获当次授权后应用。** 默认由 ChatGPT 用同一 SHA 提交明确批准的 `apply` 请求并自动触发原有工作流；网页备用方法为用同一 SHA 新建一次 `apply` 运行。工作流会重新核对生产库名称、UUID 和迁移历史，先记录 Time Travel 恢复点，再执行待应用的 SQL。若记录恢复点或执行 SQL 失败，先看日志与迁移历史，再判断如何安全续跑。恢复数据库需单独获批。
4. **核验后发布代码。** 在 `apply` 日志里确认每个待办迁移都成功，保留运行链接与恢复点。`apply` 摘要开头的 `Tables`、`Applied`、`Pending` 是执行前快照；如需确认执行后状态，用同一 SHA 再运行一次 `inspect`，检查 `Applied` 和 `Pending`。随后按第 4 节合并已获批的发布 PR，等待 Cloudflare 部署，并验证正式站 `/api/health` 的 `databaseReady=true`、受影响的接口与页面。

| GitHub 表单字段 | 只读检查 | 执行迁移 |
| --- | --- | --- |
| Use workflow from | `main` | `main` |
| `operation` | `inspect` | `apply` |
| `migration_sha` | 本次已审核发布提交的完整 SHA | 与只读检查相同 |
| `confirmation` | 留空 | `spine-community-db` |

2026-11-07 首次生产迁移已按此流程验证，完成 `0001` 至 `0005`。后续发布使用对应的发布提交，首次运行的 SHA 仅供追溯。 [只读检查](https://github.com/119shenhao/spine-community/actions/runs/42365305326) · [迁移执行与恢复点](https://github.com/119shenhao/spine-community/actions/runs/42365746245) · [正式发布记录](implementation-v1-2026-11-06.md#v1-正式发布记录2026-11-07)

### 单独开启生产翻译开关（必须当次授权）

本操作不同于数据库 schema 迁移，也不同于「从开发环境同步帖子」；不需要新增 SQL 迁移文件，不复制数据。仅针对生产 D1 `spine-community-db` 的 `settings.translation_enabled`。

- 用户当次明确批准后，复用现有 `Production D1` 工作流的 `enable-translation` 操作，不创建另一套 GitHub Actions。GitHub 入口仍是 `main/docs/release-requests/production-d1.json` 的 docs-only 提交，由已有自动转发流程调用 `workflow_dispatch`，不要求用户点击 Run workflow。
- 请求必须包含：`repository='119shenhao/spine-community'`、`operation='enable-translation'`、`migration_sha` 为已核实的 `main` 完整 40 位 SHA、`production_db_id='5919ff78-b8fc-46ab-85f0-01fe5e6a41b0'`、`setting='translation_enabled'`、`value='true'`、`confirmation='spine-community-db'`、`user_authorized=true`。提交消息必须是 `chatgpt-release-d1 enable-translation <migration_sha>`。
- 工作流在使用生产 D1 Secret 前验证请求，核对目标数据库名称与 UUID、迁移状态及现有标记；仅固定执行 `UPDATE settings SET value='true' WHERE key='translation_enabled' AND value='false'`，然后独立读取并验证为 `true`。操作具有幂等性，不能传入任意 SQL。
- 完成后将请求恢复为 `operation='inspect'`，再运行一次只读复核，确认 `translation_enabled=true` 并查看翻译缓存与预算摘要。两次运行结果记录到 `main/docs/release-records/`。
- 以上是**执行流程**，不是持续的生产写入授权；今后再次修改生产设置，仍需用户当次明确授权。不要将生产的关闭或开启操作默认为由开发环境自动同步。

## “发布版本（Release Version）”任务的完整范围

**发布版本不是单纯迁移 D1 表结构，也不是把整个开发数据库复制到生产库。** 它应当作为一个完整的发布流程，包含以下三类变更：

1. **代码发布**：将获批、测试通过的开发代码通过 PR 合并到 `main`，由 Cloudflare 构建部署正式 Worker；核验实际部署成功。
2. **数据库结构迁移**：将已在预览环境验证的版本化 SQL 按序应用到生产 D1，包含必要的建表、加字段和索引等；先核对待应用版本、备份和恢复点。没有待应用迁移时跳过写入。
3. **必要的系统基础表数据**：若本次版本确实需要，可**随经过审核的迁移 SQL**初始化或幂等更新分类、标签、默认系统设置、必要的系统账号（例如“未知用户”）等。它们属于版本依赖的基础数据，不是从开发库复制用户或论坛业务数据；应检查主键、唯一约束和已有生产记录，避免重复或覆盖。

**明确排除**：不把开发库的测试账号、普通用户、Google 登录信息、患者帖子、评论、点赞、收藏、关注等业务/私人数据作为“发布版本”的一部分复制到生产。另一个独立的“同步帖子（Sync Posts）”任务才负责按照专用规则同步尚未发布且符合条件的帖子及其回复，且不更新已同步帖子。

**推荐执行顺序**：准备发布清单与用户批准 → 预览测试、生产备份和只读检查 → 通过 `Production D1` 应用必要的结构及基础数据迁移 → 确认迁移成功 → 合并获批代码至 `main` → 核验 Cloudflare 部署和生产 API → 记录发布结果。若没有待迁移 SQL，则跳过数据库写入。当前这些步骤**已有规范，但尚未由一个统一的 `Release Version` GitHub Actions 工作流自动串联**；不得因此绕过现有生产审批。

## 4. 正式发布的完整检查（必须人工确认发布）

### 4.1 发布申请

向用户提交以下信息，得到明确同意才开始生产操作：

- 对比哪个开发分支/commit 合并到 `main`；功能改动及会影响的 URL。
- 自动化及手工测试结论（含失败项）、预览页面和 API 的实际检查。
- 新增/变更的迁移文件及生产数据库目前已执行迁移版本；是否可能锁表、重写、大量更新或丢数据。
- 对已有患者帖子/账号/搜索与翻译的兼容影响，预计停机或维护窗口。
- 生产 D1 备份/恢复方案和应用程序回滚方案。

### 4.2 获批后的发布顺序

1. 确认生产备份与可恢复性（保留恢复点；注意 D1 Time Travel 恢复到旧时间可能丢失之后的新数据，不可无审核直接回滚整库）。
2. 对兼容式升级采用 **Expand → Migrate → Contract**：先增加兼容性表/字段、验证旧代码仍可运行，再发布新代码；删除旧字段应另选维护窗口。生产迁移前再次检查目标 DB ID。
3. 有待执行的 SQL 时，按第 3 节执行已获批且在预览环境验证过的生产迁移；没有待执行的 SQL 时跳过此步。
4. 合并目标代码到 `main` 并触发生产 Worker 构建；**检查 Cloudflare 显示已部署版本，不因 GitHub 合并成功就宣布上线成功**。
5. 上线后进行必要的真实请求验证：网页、主要 API、Google 登录、读写权限、搜索、错误日志、生产 DB 核查；不创建真实患者假数据。
6. 将上线版本、迁移版本、测试结果和异常写入发布记录。如验证失败：优先回滚应用代码到兼容版本；数据库回退必须评估数据丢失风险并单独获批。禁止“自动覆盖生产库”。

### 4.3 需要用户再次明确授权的操作

- 将程序代码合并／推送 `main`、正式部署或修改生产 Worker 的运行参数/Secrets/Bindings（纯 `docs/` 文档提交已获长期授权）；
- 在生产 D1 建表、迁移、写入、删除、导入、备份恢复或 Time Travel；
- 开启 R2 图片功能、收费服务或修改计费、配额、安全控制；
- 可能暴露患者健康信息、改变公开范围的功能与配置。

## 5. 预览环境的安全边界与上线前验证

- 预览网站可通过公开 URL 访问；即使是测试功能，也要坚持基本鉴权、反刷和隐私保护，不要放入真实患者数据。
- Google OAuth 等预览环境机密必须使用 Preview 独立配置，不能将生产 Secret 写入 GitHub。若回调域名尚未配置，不得假称登录功能可用。
- 图像上传首版仍按已确认需求**代码/界面预留、权限开关默认关闭**，未批准前不能启用 R2 公共上传/读取。
- D1 数据库读取权限与表存在性必须通过实际 API 测试验证。本次除首页外已验证远程健康、分类和空列表；**登录后远程 CRUD 尚需独立OAuth配置与联调，不能用本地集成测试代替**。
- 记录上线前的安全检查：访问控制、管理员权限、举报审核、数据删除及译文索引清理、搜索滥用限制、额度熔断、备份及日志。

## 6. Codex 执行约定

每次 Codex 开发任务开始时：

1. **先阅读**本文件、`docs/开发需求/项目需求总览.md` 和本次功能专题文档；如仓库根目录有 `AGENTS.md` 同样遵守。
2. **先输出**本次要改的文件/表及预览验证方式；已确定的需求不要重复问用户，真正矛盾或高风险不确定点才询问。
3. **程序代码只在 feature 分支开发，文档只在 main 维护**；不要在 `main` 执行代码或迁移操作；不配置绕过人工审核的生产自动发布。
4. **默认完成测试和预览提交**，然后报告实际 commit、构建结果、预览 URL 和未完成项；未验证不得声称“已部署”或“功能可用”。
5. **严禁跨库**：涉及远程 D1 命令必须逐项核对 UUID；生产数据库任何写操作必须另获明确授权。
6. 所有文档均在 **main 分支只改 `docs/`**；不再在开发分支新写或更新文档，避免无意义触发 Cloudflare 发布。
7. 文档政策变更需用户明确同意，不得自行降低生产保护要求。

## 7. 开发阶段历史快照（2026-11-06）

- ✅ 用户已创建并浏览器验证 Worker 的独立预览网站；
- ✅ Cloudflare 预览环境绑定 `spine-community-db-preview`，生产绑定 `spine-community-db`；
- ✅ `feature/v1-community-build-20261106` 分支已建立，并配置 `npx wrangler preview`；
- ✅ 第一版核心代码已提交至开发分支，最终代码提交 `44f6b1855394d8967a9bcf9bbfa89010b4e19e68`；16项自动化测试通过；
- ✅ 最终代码 Cloudflare 构建成功，Build ID `28102adf-a738-4e3a-81cb-8d6936ae700e`；远程预览D1初始化及健康检查通过；
- ✅ 预览迁移专用配置和严格限分支/限UUID的测试库准备脚本已实现；
- ⏳ Google OAuth凭据、站长subject和统计盐值尚未配置；目前不能实际登录发帖；
- ⏳ 真实Google登录、登录后的远程全流程、翻译服务联调、手机验收及正式上线检查仍待完成；翻译保持关闭；
- ⛔ **截至该快照日期，生产 D1 迁移、数据同步及正式版本发布尚未获批。**

这套流程是长期规范；以后可按任务创建新 feature 分支，但**生产与预览隔离、生产审批、按版本迁移而不复制数据**三条原则不得因为分支名称变化而失效。

## 附录：Cloudflare 文档构建隔离的历史配置与验证（2026-11-06）

> 以下历史资料原在需求总览中；现集中保存于发布规范。配置若发生变化须重新验证。

### 文档提交跳过正式构建（历史记录）

**目标：讨论期间持续把需求保存在 GitHub，但不要因此重新构建或发布网站。**

### 2026-11-06 验证时的 Cloudflare Workers 设置
- 项目：`spine-community`，生产分支：`main`
- 控制台位置：Workers & Pages → spine-community → 设置 → 构建 → 构建监视路径（Build watch paths）
- **包含路径（Include paths）：`*`**
- **排除路径（Exclude paths）：`docs/*`**

### 必须遵守的工作规则
1. **需求、产品讨论结论、设计说明、决策记录、会议记录等纯文档文件，都放在仓库的 `docs/` 下**，特别是 `docs/开发需求/`；只更改这些文档时，**不触发 Cloudflare 自动构建和发布**。
2. 修改 `src/`、`public/`、`wrangler.jsonc`、`package.json`、数据库迁移脚本等网站程序/配置文件时，继续正常触发构建与发布（按 Cloudflare 实际路径过滤规则执行）。
3. **同一个提交既改 `docs/` 又改网站程序文件时，仍应触发构建**；不要误以为包含文档就一定跳过。需要避免部署时，必须提交纯文档变更。
4. 需求讨论阶段只更新 `docs/` 中的文档；**不擅自修改程序代码，不执行 D1 建表/迁移，不开启 R2/付费服务**。正式开发或改动部署配置前，须由用户明确同意。
5. 若以后更换 Cloudflare 项目、生产分支、构建设置或更改文档目录，须同步检查和更新此规则，并再次用“纯文档提交”验证跳过构建。
6. 本规则依赖 **Cloudflare 控制台的构建监视路径配置**，并不是 GitHub 的默认行为；GitHub 仍会保留文档提交历史，仓库代码不会因为构建跳过而丢失。

### 已完成的实际验证
- **2026-11-06**，用户已在 Cloudflare 控制台保存以上路径配置。
- 测试提交：[`52ac304`](https://github.com/119shenhao/spine-community/commit/52ac304916afbff48cb20a283e2f89f1c3214b34)，仅修改（当时路径）`docs/requirements/README.md`。
- **用户查看 Cloudflare 部署历史后确认：没有出现新部署。** 因此对本次纯文档提交，跳过发布的设置已经验证有效。
- 此记录只证明上述配置和本次测试有效；后续配置发生变化时需要重新检查。


## 2026-11-09 — 前端静态资源按内容版本发布（防止管理菜单旧版缓存）

- 现象：用户在开发预览 `/#/admin?tab=translationProviders` 中仍看到旧版管理菜单（没有翻译服务管理和原文语言核对），虽然 GitHub 开发分支和服务器提供的新版 `/app.js` 已包含入口，且用户确为管理员。
- 根因及保护：旧网站 HTML 始终直接引用固定的 `/app.js`、`/styles.css`；浏览器/静态缓存层可能混合不同发布批次的模块。改造 `scripts/prepare-build.mjs`：每次构建以所有 `public/*.js` 和 `public/*.css` 的 SHA-256 内容摘要生成单一 `public/_app/<16位哈希>/` 目录；HTML 改指向 `/_app/<哈希>/app.js` 和 `/_app/<哈希>/styles.css`。JS 依赖以相对路径加载，保证同版本；仍由 Cloudflare Assets/CDN 直接提供静态资源，不增加 Worker 的静态文件请求。
- 根路径及 `/index.html` 入口设置 `Cache-Control: no-store, max-age=0`、`Pragma: no-cache`，不更改现有 API、R2 翻译缓存策略。
- 自动化保障：`feature-verify.yml` 的 Wrangler dry-run 后校验 HTML、构建版前端目录与资源一致性；`preview-language-health.yml` 实际从 GitHub Actions 外部访问 Cloudflare 开发预览站，确认首页不缓存、版本摘要一致、14个 JS/CSS 文件可读取且和当前代码一致、管理导航包含 `translationProviders` 与 `languageReview`。
- 2026-11-09 真实检查：`Frontend revision confirmed 346c4f0390b36319 all 14 assets and owner-only tabs`，Worker `/api/health` HTTP 200，预览 D1 就绪，在线 Actions：https://github.com/119shenhao/spine-community/actions/runs/42610279956 成功。该检查验证匿名可访问的真实线上资源，不等同于读取用户浏览器当前 DOM；若用户一直停留旧版标签页，还需重新导航到新入口。
- **仅修改开发分支并验证预览部署**，未合并发布生产代码、不操作生产 D1。新增前端 JS 文件需放在 `public/` 根目录，自动进入版本打包。今后每次静态版本发布都应保持这种验证。



## 2026-11-12 — 开发预览验收失败复盘与强制交付门槛（后续每次发布必读）

> 本节是长期执行规范，不是某次部署成功回执。无论 ChatGPT、Codex 还是人工开发，均适用。**代码已提交 ≠ 自动测试通过 ≠ Cloudflare 已部署 ≠ 线上功能已验收。** 任一环未核实，严禁向用户说“开发完成”“发布成功”或“可以使用”。

### 本次事故的事实与边界

- 需求：改善 PageSpeed 无障碍文字对比度、添加游客可用的柔和暖色阅读模式及三级字号，不重新排版。
- 2026-11-12 开发分支提交 `6f418b232ee87a4705f9ddce38eac4f0153c5456` 后，`Spine Community feature checks` 的 [Actions #43153913705](https://github.com/119shenhao/spine-community/actions/runs/43153913705) **失败**：138 项测试中 136 通过、2 失败，后续 Wrangler dry-run 与静态版本验证被跳过。失败项均与此前“摘要不截半个单词”的改造及旧测试/投影不一致有关，不能因为它们与“阅读设置”不是同一功能就放行。
- 用户在开发预览站的已登录页面与 Safari 无痕/未登录页面均滑到页脚，**实际没有出现**新“阅读设置”入口。不能假设是用户没有找到或缓存问题；无痕模式也没有出现进一步否定了“仅需清浏览器缓存”的解释。
- 2026-11-12 的修复提交 `bda4aef29afb4e267c577493d3efc694af333ba6` 处理两个相关问题：CDN 全文译文生成摘要时先按字数截取会丢失末尾省略号；旧回复预览断言仍要求截断半个英文单词。**此提交的测试、Cloudflare 部署及线上结果必须以对应实时检查回执为准，不能从提交存在推断成功。**
- 目前缺少本轮 Cloudflare Preview 构建、部署版本与公开页面资源的闭环证据。**GitHub Actions 失败不必然导致 Cloudflare 失败**，不能未经实际日志就武断归因。2026-11-09 已有静态资源版本化防旧缓存机制，参见上节历史记录，但该机制存在也不等于每次预览自动验收通过。

### 必须执行的发布前门禁

1. **基线与回归测试**：开工前核对目标分支 HEAD、现有失败项和改动范围；开发后对最终同一个完整 SHA 运行全部项目检查（`npm run verify`、前端静态版本验证、相关构建/语言/集成测试）。有失败或被跳过的必需环节时修复后重跑；**不能只做 JS 语法检查就说功能完成**。测试不符预期时先判断真正产品规则，不允许仅为“刷绿”删掉安全断言。
2. **构建记录与版本对应**：分别核查 GitHub Actions 和 Cloudflare 预览部署历史（构建状态、构建/部署 ID、Git commit SHA、失败日志）。不得把一次 push 成功当成部署成功，不得以 GitHub 成功直接代替 Cloudflare 证据。
3. **真实预览资源校验**：外部请求实际 Preview URL，检查 HTML 入口 `/_app/<内容哈希>/app.js`、`styles.css` 及新增依赖文件均返回成功且内容确为本次版本，核对无缓存响应/资源哈希；存在本地/旧 CDN 缓存时进行实测定位，不直接把责任归于用户浏览器。
4. **真实页面功能验收**：按需求逐页实际操作。涉及游客设置的必须在**未登录或无痕**状态完成：看见页脚入口、能打开设置、切换配色与三个字号、刷新仍保留偏好；登录后菜单入口也要验证。覆盖 iOS/窄屏、桌面、多语言、正常/异常存储、键盘可达与 PageSpeed/WCAG 对比度。只确认代码里有 DOM 模板字符串不算验收。
5. **摘要/翻译关联回归**：修改 `excerptText`、全文/摘要翻译缓存、R2 投影时，同时测试中文、英文、混合语言、长词与空白、尾部省略号、**不截断单词**、源内容与翻译的版本一致性，并确认已有功能不倒退。本次新版本遇到的两项失败必须纳入常驻回归。
6. **准确报告与生产门禁**：交付报告必须分别列出“代码已提交 / 自动测试通过 / Cloudflare 预览部署成功 / 线上页面可操作验证 / 是否发布生产”，每项附可核实的 SHA、运行链接或部署记录，无法访问则标明“未核实”。上述门禁未全部通过只能说“开发中/尚未验收”。**生产合并、生产 D1 及正式部署仍遵守原有当次明确授权规则**；文档提交不代表生产发布授权。

### 失败时的处理顺序

- 发现测试失败：先读取失败任务与断言的完整日志、复现输入，再修复代码或过时测试；从开发分支提交最小补丁，检查最终 SHA 全量测试。
- 测试全绿而预览缺功能：先核实 Cloudflare 构建及部署的 SHA 和版本化资源，检查静态路由与 JS 加载错误，再排查 CDN/浏览器缓存。
- 预览资源正确却按钮缺失：用游客与登录用户分别检查前端渲染异常、事件绑定、样式/隐藏条件及多语言；修复后重新进行真实页面验收。
- 未拿到真实部署日志或外部页面验证结果时明确报告阻断点，不让用户通过反复截图代替开发方的验收。
