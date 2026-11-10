# Spine Community — 原文语言与 SEO 安全升级正式发布记录（2026-11-10）

> **生产发布：成功**。按长期固定的「[发布新版本，从开发环境到生产环境](release-version-workflow.md)」任务执行；未建立或启用新正式发布流程。此次仅发布代码，不同步开发帖子，不修改生产历史语言字段。

## 发布版本和代码范围

- 生产仓库：`119shenhao/spine-community`；生产目标分支：`main`。
- 基于当时的 `main` 建立独立最小候选分支 `release/original-language-seo-20261110`，避免整合与生产显著分叉的开发分支。
- [正式发布 PR #20](https://github.com/119shenhao/spine-community/pull/20)：**merged**，采用 squash merge。
- **生产合并提交**：`e5c1086e3e6c9f8e1e348fa858877be7882b27b3`。
- 只修改四个文件：
  1. `src/source-language.ts`：不能可靠确认采集原文语言时，使用 `und`，不把外部来源提示当作确定原文语言。
  2. `src/seo.ts`：独立帖子原文的 `html lang` 发生不确定时使用 `und`，而不是默认 `en`；现有 SSR Title、Description、H1、Canonical、Sitemap 继续沿用原逻辑。
  3. `scripts/sync-preview-to-production.mjs`：预留新版一次性同步的当前版本语言验证、证明传递及写入后回读校验；**本次未执行同步**，也未改变 `main/.github/workflows/sync-posts.yml` 对旧版本的 SHA 锁定。
  4. `tests/community.test.mjs`：与新语言回退规则对齐的回归断言。
- 未纳入额外候选 CI 工作流文件；临时验证文件已从发布候选移除，`main` 没有新增发布工作流。
- 对比原生产版本没有新增或更改任何 `migrations/v1/` SQL 文件。

## 发布前验证

- [候选分支完整检查 #42827929195](https://github.com/119shenhao/spine-community/actions/runs/42827929195)：**Success**。Node **119/119** 测试通过；Python 测试、语言 benchmark、Wrangler dry-run 及前端版本检查也通过。首次候选运行有 1 条旧测试断言失败，已依据需求修复并经后续完整检查通过。
- [开发分支完整检查 #42825618468](https://github.com/119shenhao/spine-community/actions/runs/42825618468)：**Success**，Node 124/124、Python 20/20。
- [预览 D1 原文语言审计与中英德 SEO 线上检查 #42824879065](https://github.com/119shenhao/spine-community/actions/runs/42824879065)：**Success**。
- [预览浏览器语言切换检查 #42825437660](https://github.com/119shenhao/spine-community/actions/runs/42825437660)：**Success**（翻译接口被拦截以避免费用）。
- 使用现有 `main/docs/release-requests/production-d1.json` 请求入口调用原有 Production D1 `inspect`，即 [只读迁移检查 #42828128287](https://github.com/119shenhao/spine-community/actions/runs/42828128287)：**Success**，生产 D1 标识通过检查，迁移 `apply` 步骤被跳过；本次代码无新增 SQL 迁移。

## Cloudflare 生产构建

- GitHub PR #20 合并确认成功，`main` 指向 `e5c1086e3e6c9f8e1e348fa858877be7882b27b3`。
- GitHub 该提交关联的 **Workers Builds: spine-community** 检查为 **Success**。
- [Cloudflare Workers 构建记录](https://dash.cloudflare.com/289976272520a38732bef34108585e11/workers/services/view/spine-community/production/builds/ed3e5a76-f99e-4d1f-acd0-da5d39a7f837)：
  - Build ID：`ed3e5a76-f99e-4d1f-acd0-da5d39a7f837`
  - Worker Version ID：`e1b5a631-b12f-47f5-a3bd-83e57d8ca4b3`

## 生产上线后实测

- 复用现有的、仅 GET 的 [SEO / Sitemap 生产回归 #42773802931（第 2 次运行）](https://github.com/119shenhao/spine-community/actions/runs/42773802931)：**Success**。
- `https://spine.nbn369.com/robots.txt`：HTTP **200**，Allow 并声明生产 sitemap URL。
- `https://spine.nbn369.com/sitemap.xml`：HTTP **200**，返回标准 sitemap index。
- `https://spine.nbn369.com/api/health`：HTTP **200**，`environment=production`，`status=ok`。
- 复用现有、无生产内容写入的 [真实浏览器访客流程 #42775778561（第 2 次运行）](https://github.com/119shenhao/spine-community/actions/runs/42775778561)：**Success**，共 **14/14** 项通过：真实帖子列表、History API、直接打开并刷新帖子 SSR、canonical、匿名回复/点赞/收藏登录提示、搜索、语言切换、浏览器前进后退、390px 手机流程及无前端未捕获异常。

## 未执行与保留风险

- **未同步**开发环境的帖子、回复、楼中楼；未来执行「同步帖子」需独立授权，正式同步工作流锁定 SHA 尚未切换为新版，不得绕过原有同步安全规范。
- **未写入或修改**生产 D1 数据，也未做历史语言元数据回填；本次 Production D1 工作流为只读 `inspect`，无 `apply`。
- **生产 D1 内部 `content_language_verifications` 明细聚合审计仍待安全入口**；此前仅完成生产站点公开 API 的 550 篇帖子语言分布 GET-only 盘点，不能与生产 D1 证明表审计混为一谈。
- **未单独实测生产已发布 `und` 帖子的原始 SSR 标签**；发布代码和预览 SSR 功能已验证。此项可用未来受控只读检查补充，不应伪称已完成。
- 本次生产浏览器测试没有执行付费翻译服务端到端验证；现有真实生产访客交互与基础 SEO 已通过。

## 结论

**生产代码发布与构建成功；基础 SEO、生产 API 和访客浏览器回归已完成。** 历史语言数据修复和新的帖子同步属于后续独立工作，不属于本次发布。
