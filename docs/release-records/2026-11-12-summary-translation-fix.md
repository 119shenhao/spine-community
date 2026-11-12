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

## 2026-11-12 生产实际部署补充验收（覆盖上文“尚未验证”的旧状态）

用户 iPhone Safari 截图发现生产首页英文卡片显示约 5 行、且在 `pa` 处断词，证明前一次只凭 PR25 合并确认发布不充分。

- [PR26](https://github.com/119shenhao/spine-community/pull/26) 已合并（`01b5af0f5841313a10d165b3c5ea420d7dc8c099`）：增强 Safari 的三行 clamp 和 `max-height:5.4em` 高度兜底；客户端针对历史约 260 字符原文摘要，移除尾部半个拉丁单词并显示省略号；修复全文译文投影被 `substr` 空格尾部隐藏省略号的问题；恢复楼主进展预览原有 180 字符截取，避免功能回归。
- [完整测试](https://github.com/119shenhao/spine-community/actions/runs/43144566361)：**137/137 通过、0 失败**。此前一次 CI 发现 3 项失败，其中两项属于 PR25 引入的功能回归，另一个为新添加测试的正则断言错误；均已修复。此前未拿到 Cloudflare Build 失败日志，因此不能把 GitHub 测试失败推定为已证实的 Cloudflare 失败原因。
- [PR27](https://github.com/119shenhao/spine-community/pull/27) 为现有 `feature-verify.yml` 增加 main 合并后的只读生产资源检查，不创建新工作流、不添加定时任务。
- 首轮生产资源检查的 URL 正则被错误地双重转义，错误报告“旧 unversioned HTML”；这是**测试脚本误报**，不是实际证明线上仍是旧 HTML。[PR29](https://github.com/119shenhao/spine-community/pull/29) 已修复正式 CI 正则，merge SHA `3e580ff6483ac1c230192a48bf873f7954370b4d`。
- 经临时只读诊断 PR28 实际从 GitHub 运行器访问生产环境，[生产验证 #43146204963](https://github.com/119shenhao/spine-community/actions/runs/43146204963) **Success**，两个 job（verify、Production assets smoke check）均成功。生产首页真实引用的版本目录是 `/_app/731105ec10b38c0c/`，已从该目录 GET 获取 CSS、app.js、feed-preview.js 并核对三行 Safari 样式、max-height 兜底和旧摘要保护标记；`/api/health` 实际为 production / ok / databaseReady=true。临时审计 PR28 已关闭且未合并。
- 本次生产代码和运行资源**已完成服务器端验收**；不等同于重新取得同一用户 Safari 手机截图，也不表示历史多语摘要已全部批量重算。历史数据继续按既有按需修复规则处理。
- 本轮修复及验收不涉及 D1 新迁移、生产内容同步、账号资料复制、历史内容删除或数据库恢复。
