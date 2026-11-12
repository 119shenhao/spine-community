# 2026-11-12 首页摘要与翻译缓存修复：生产发布记录

## 用户授权及范围
用户明确指令「发布新版本从开发环境到生产环境」。根据 main/docs/release-version-workflow.md 的既有 PR 流程，从当前 main 基线建立受控 release 分支，将开发分支中已确认的摘要/翻译修复定向复制到 11 个源码与回归测试文件。未整体合并有数百个分叉提交的开发分支，避免带入采集、审计、临时工作流与文档冲突。

- 发布基线：`9d3e82e28eaef5d353fe512970e3af801951e886`
- 候选：`release/spine-20261112-summary-translation-fix`，变更仅 11 个文件。
- PR：[25](https://github.com/119shenhao/spine-community/pull/25)，GitHub 成功合并，正式 merge SHA `e43569cb268f0ff96a3c4cb34524aee39a73b89b`。
- 合并后核对 main 与上述 merge SHA 一致，`src/excerpt.ts` 的新版摘要引擎标识存在。
- 无新增 `migrations/v1` SQL；不需生产 D1 apply。不执行独立的帖子同步、用户数据复制或生产端人工译文覆盖。

## 功能变更
- 首页卡片的原文摘要 UTF-8/Unicode 完整单词截断、移动端最多三行/桌面四行省略号；
- Azure 摘要翻译优先截完整句，不再任意截在英文句子中间；
- 摘要翻译缓存增加 `nmt-summary-sentence-v2` 版本标识，避免将历史错误 Azure 摘要当作有效缓存；
- 用户访问旧摘要时，通过已有 D1 翻译缓存检查/按需生成自动修复；已存在全文译文时优先复用而不再次调用 Azure；
- 分离 R2/CDN locale JSON 带摘要版本标记，旧 CDN 摘要在前端不再被直接采信；刷新由已有 public_projection 按需工作流执行；
- 新增回归测试，覆盖旧异常摘要、句子截断、全文复用、跨语言及缓存版本逻辑。

## 验收状态与未完成项
- GitHub merge 与源码变更核对：已确认。
- 本次发布候选的独立 GitHub Actions CI Success 及 Cloudflare Production Build/Version ID：**尚未取得可核验记录**，不能标记正式生产部署成功。
- 外部网络无法访问 `https://spine.nbn369.com/api/health`，线上健康和实际手机端卡片验收未完成。
- 本次没有批量重翻译/清理所有历史摘要。旧的 R2/CDN 数据仍需随访问、投影刷新和缓存到期逐步替换，不能将源码更新等同于全量历史修复。

## 生产保护
保留 main 的 wrangler.jsonc、keep_vars、生产与预览 D1/R2 绑定、OAuth、SEO、原有 GitHub Actions 与同步规则；不执行生产数据库迁移或 Time Travel 恢复。若 Cloudflare 构建失败，应按日志修复后再重试，不擅自整库回滚。
