# 2026-11-13 帖子返回列表位置恢复：生产发布记录

## 发布结果

用户明确要求「发布新版本从开发环境到生产环境」。本次发布已完成，线上精确资源版本、生产健康和真实公开帖子导航均验收通过。

- 开发验收 SHA：`8ddc555e2939998b16ed24c6fc9ba0496ea7510a`。
- 发布前 main：`7685783ac671d2e6cc62704b6f19ff01c9baa3bc`。
- 发布分支：`release/spine-20261113-list-position`，候选 SHA：`d3ce4adcd5ea9479e530739edf8094c5746cf75e`。
- [生产 PR #33](https://github.com/119shenhao/spine-community/pull/33) 已 squash 合并。
- 生产合并 SHA：`28340f37ccb1bf29100e6b2a7b3cf061c720e2f7`。
- 生产站：https://spine.nbn369.com/ 。

## 发布范围

在最新 main 基础上移植已验收的位置恢复补丁，仅变更：

1. `public/app.js`：按历史条目保留列表 DOM、分页、筛选、排序和滚动位置；详情返回链接回到实际来源列表；浏览器返回恢复完整列表后再启动分页观察器。
2. `public/translation-ui.js`：允许暂停列表翻译观察器，恢复时保留原文/译文状态。
3. `tests/navigation.browser.mjs`：手机宽度和桌面的真实 Chromium 回归，以及可配置目标站点的上线验收。
4. `.github/workflows/feature-verify.yml`：复用原有 PR/main 检查和 Production assets smoke check；增加浏览器回归，生产烟雾检查等待精确资源修订，再验收线上导航。运行器固定 Ubuntu 24.04。

保留已上线的 Safari 三行摘要、feed-preview.js 单词与省略号保护、分享菜单、阅读设置、后端翻译修复、生产配置和原有同步/迁移工作流。没有直接以开发分支覆盖 main。

## 数据库边界

逐一比对开发和生产的 `migrations/v1`：16 个正式 SQL 文件的 blob SHA 全部一致，没有新迁移，跳过 Production D1 apply。没有执行独立帖子同步、采集或生产数据清理，没有修改生产绑定、变量或密钥。

## 验收证据

- [候选 PR CI #43405546421](https://github.com/119shenhao/spine-community/actions/runs/43405546421)：success。TypeScript、143 项生产社区测试和 390×844 / 1440×1000 浏览器回归通过。
- [生产 main CI #43405665808](https://github.com/119shenhao/spine-community/actions/runs/43405665808)：verify 与 Production assets smoke check 均 success。
- 生产检查 job：`131819607354`。2026-11-13 18:00:38（北京时间）第一次实际 GET 仍为旧修订 `ea298af4ed4d1d92`，因此继续等待；18:00:50 返回预期新修订 **`fb410795c4775a06`**，与生产提交所有根目录 JS/CSS 内容计算出的修订一致。
- 同一检查验证生产 `/api/health` 为 `status=ok`、`environment=production`、`databaseReady=true`；Safari 摘要 CSS 和 feed-preview 模块回归通过。
- 18:01:02 / 18:01:03 的受控浏览器用例通过：加载 40 张卡片，打开第 34 张后返回，不重新获取列表，保留关键词和已加载页；浏览器前进、详情返回、重复往返通过。
- 18:01:05 / 18:01:06 的真实生产站浏览器用例通过：目标环境变量为 `https://spine.nbn369.com`，先核对线上 app.js 与生产提交一致，再在两个视口打开真实公开帖子、浏览器返回、再次进入并点击详情返回；卡片相对位置误差均小于 5px。脚本日志沿用了“deployed Preview”标签，但本次明确配置并访问生产地址，并非预览站。
- 未使用真实 iPhone Safari 或用户登录态验收；手机测试为 Chromium 的 390px 视口。

## 后续维护

列表记录仅保留在当前页面内存，最近最多 12 个；整页刷新或关闭页面后不保证恢复历史列表。以后修改导航、列表分页或翻译观察器时，应保留本次浏览器回归。不能将旧版本的烟雾测试绿灯当作新版本上线证据，必须匹配精确前端修订。
