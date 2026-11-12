# 社区内容来源统计生产发布（2026-11-12）

## 发布范围与授权
用户明确指令：「发布新版本从开发环境到生产环境」。本次按现有 Production D1 与 PR 发布流程执行，包含后台内容当前总量、来源分项与期间新增，以及0014/0015两份来源元数据迁移；不执行帖子同步、不复制开发库业务数据。

- 开发源码：`4576261eed8d5dacf4d35efde085318bba3af448`，开发预览131项测试、Cloudflare构建及实际数据库对账成功。
- 原生产基线：`1752923b1e21f7bbab975fc0bc117016cfce3352`。
- 发布候选：`ae8abac0bdec9d8dd94f37a662b501752e5783eb`，分支 `release/spine-20261112-content-statistics`。
- 发布PR：[23](https://github.com/119shenhao/spine-community/pull/23)，仅9个文件：src/admin.ts、src/content-statistics.ts、public/app.js、public/content-stats-ui.js、public/i18n.js、public/i18n-zh-tw.js、migrations/v1/0014_content_origin_statistics.sql、migrations/v1/0015_collection_reply_entry_dates.sql、tests/community.test.mjs。
- 候选保留main的全部生产配置、keep_vars、站点验证文件、文档、生产/预览隔离、同步脚本与现有采集工作流。开发分支独有的研究/临时探测工具和审计测试不随本次发布；发布候选本地类型检查、129项回归测试全部通过。

## 兼容性修复
既有Production D1校验把 applied 当成按文件名排序列表的前缀。历史0099昵称数据修正已早期执行，此后新增0014/0015会在文件名排序中位于0099前，需修正该兼容性判断，避免重复执行0099或误判历史。

[PR24](https://github.com/119shenhao/spine-community/pull/24) 已合并，维护提交 `ae45d2beacba9d94c4c43661db4b64efcf3a5fc4`：
- 仅对历史0099固定Git blob哈希 `934c160f4daf826f3691f3e9ce87aa34417fa2b0` 单独核对。
- 其他迁移仍必须严格有序前缀；未知、重复、缺失、乱序或0099内容变更均拒绝。
- pending按文件名缺失集合筛选，按文件顺序执行；不修改已有迁移文件。
- 现有目标UUID、授权检查、恢复点和Wrangler迁移流程均保留；只读applied/pending/blocking_reason与聚合统计输出日志。
- 对工作流中实际Python代码完成语法及有效/无效历史回归验证。工作流已在Cloudflare构建排除路径内，不发布网站代码。
- 第一次只读inspect：[43126129877](https://github.com/119shenhao/spine-community/actions/runs/43126129877)，成功但旧版仅把迁移清单写Summary；未执行迁移。
- 修复后的inspect：[43126451684](https://github.com/119shenhao/spine-community/actions/runs/43126451684)，正在核对实际最终结果。

## 执行状态
- 修复后生产inspect [43126451684](https://github.com/119shenhao/spine-community/actions/runs/43126451684) 成功：blocking_reason=null，仅0014/0015待执行。
- 生产apply [43126641400](https://github.com/119shenhao/spine-community/actions/runs/43126641400) 成功，job 130880304443 的「Record a restore point and apply migrations」成功；Time Travel恢复点已由原工作流保存到该运行Summary。两份SQL在日志中均显示✅。
- 迁移后只读inspect [43126738414](https://github.com/119shenhao/spine-community/actions/runs/43126738414) 成功：applied包含0014/0015，pending=[]，blocking_reason=null。
- 生产实际对账：导入732篇／3341条评论；用户前台1篇／5条评论；当前总量733篇／3346条评论。来源账本缺失0条，外键错误0条。
- 生产历史导入的本环境入库日期缺少本地回执证据：732篇／3341条评论保留未知。它们计入当前总量，不计期间新增；不能沿用开发环境的64条未知日期数字。新导入/同步将由触发器记录本环境实际首次写入时间。
- 发布PR23已合并，正式merge SHA `45f3e92649eb9e42246e362feefa2e4d305a8dc8`。
- Cloudflare正式Build `579e8abc-50d2-4896-84a6-cfa3be8e4f04` 正在构建，部署后HTTP和资源版本验收待完成。此处不声明全部发布成功。

## 回滚与数据边界
0014/0015是兼容式新增来源元数据，不改帖子正文/语言、不清理用户内容，不覆盖生产人工语言修正。若应用异常，优先回退Worker到发布前兼容版本；来源表与触发器可保留。整库Time Travel恢复可能丢失恢复点之后的新内容，必须单独评估并获授权后执行。

历史生产导入/同步的本环境入库日期，若没有本环境可靠证据则保留未知；不从预览库猜测或复制日期。未知日期内容计入当前总量，暂不计期间新增，后台显示提示。
