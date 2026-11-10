# Spine Community — SEO 与 Google 帖子收录技术改造（2026-11-10）

## 本轮目标与状态

用户明确同意先解决 Google 能否发现每篇公开帖子、是否无需 JavaScript 即可读取原文的技术问题。仅修改开发分支程序，文档单独提交 main/docs；**未经另行授权不发布生产版本、不修改生产 D1、不同步帖子。**

开发分支：feature/v1-community-build-20261106。
当前开发提交：0ddb1cf4bf6150cad7d4fd8b53bbd7cb4f49ad5c。
[完整自动测试](https://github.com/119shenhao/spine-community/actions/runs/42769217413) Success；[预览站真实抓取验证](https://github.com/119shenhao/spine-community/actions/runs/42769217272) Success。

## 审查发现

- 旧帖子 URL 以 /#/topic/ID 表示独立内容，Google 官方不推荐通过 fragment 控制 SPA 的内容。旧首页的原始 HTML 只有加载壳，没有主帖正文、独立 title 和 canonical。
- 之前没有由应用动态生成并只包含公开帖的 sitemap，Google 发现深层帖子缺乏可靠入口。
- 原先的多语言、R2/CDN 和不同 D1 环境隔离继续保留；首页不应因为 SEO 而新增每位用户的 D1 查询。

官方参考：[JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) · [Sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) · [讨论论坛结构化数据](https://developers.google.com/search/docs/appearance/structured-data/discussion-forum) · [noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing)。

## 本轮程序改造

### 1. 正式路径与初始 HTML

- 每篇帖子的规范地址为 https://spine.nbn369.com/topic/帖子ID ；旧的 /#/topic/帖子ID 在浏览器启动时自动转换，保留评论查询参数。
- 前端链接采用普通 HTML href 路径及 History API，后退/前进使用 popstate；内部切换依然是 SPA，不强制整页刷新。
- Worker 对初始 GET/HEAD 帖子 URL 读取本环境 D1 最新帖子状态，并将公开主帖的**完整原文、独立标题和描述、canonical、Open Graph 元信息**直接输出到服务端 HTML 中。搜索引擎不必等待 JS 执行才可读到正文。
- HTML 内容经过转义，保持 CSP、反嵌入、referrer 等安全头。首页仍沿用现有静态 HTML 壳，避免给每一次首页浏览新增 D1 读取。
- Google DiscussionForumPosting 结构化数据只用于原生本站普通用户的公开帖子；系统账号（如 Anonymous 导入帖）不冒充本站原创，不附该结构化数据。结构化数据不是排名或富结果保证。

### 2. 状态与隐私

| 状态 | HTTP | 搜索处理 |
| --- | --- | --- |
| 已公开 published | 200 | 原始主帖可阅读、可收录、纳入 sitemap |
| 已删除 deleted | 200 | 保留删帖占位/回帖入口，但不展示删掉的文字；noindex，不进 sitemap |
| 待审核、隐藏、阻断 | 404 | 不在 HTML 泄露私密正文；noindex，不进 sitemap；保留客户端壳供获授权作者查看 |
| 不存在 | 404 | 不泄露帖子内容 |
| 开发预览 | 页面正常可读 | 全站 X-Robots-Tag noindex、robots.txt 禁止抓取、没有可提交的生产 sitemap |

### 3. Sitemap 与 robots

- 生产 https://spine.nbn369.com/sitemap.xml 基于最新 D1 状态生成；公开帖子不超过 500 篇时是单个 sitemap，超过则返回 sitemap index，并使用 /sitemaps/topics-1.xml 等分片（每片最多 500 篇公开主帖，首片另外包含首页 URL）。
- Sitemap 仅放正式域名上的公开帖子，使用原始更新时间设置 lastmod；非公开或已删帖会从后续生成结果中排除。
- 生产 robots.txt 声明 sitemap 地址。对需 noindex 的页面允许 Google 访问以读取 HTTP 排除标记；API JSON 设置 X-Robots-Tag noindex，必要的公开 API 不被错误禁止抓取。
- 预览使用独立 D1、R2，防止将测试帖提交 Google。

## 成本与限制

- 浏览器通过内部链接切换帖子时，继续使用现有客户端 + R2/CDN 方案，不因切换链接额外产生新的 Worker 整页加载。
- 初次直达独立帖子 URL 会新增 Worker 和一次必要的 D1 状态/正文检索，保证删帖或审核状态不会被陈旧缓存覆盖。
- 生成 sitemap 也会产生 Worker 和 D1 读取，但只有访问 sitemap 时发生，且分页有界。暂不对需要严格隐私失效保护的帖子 HTML 进行长时间公共缓存。
- 当前优先为原始语言帖子建立唯一 canonical；未来再讨论可索引的多语言独立 URL 与 hreflang。本轮不制造多个机器译文 URL 导致重复索引。

## 自动测试与预览部署

2026-11-10 开发分支通过完整自动验证；测试覆盖：公开 HTML 中有标题/正文/独立 canonical；HTML/XSS 字符转义；HEAD；505 篇帖子 sitemap 分页；隐藏/未发布不出现在 sitemap；404 不泄露内容；已删除占位 200/noindex 且无删掉原文；预览 sitemap 404/noindex；真实用户结构化数据与导入系统账号区分；安全响应头；首页不访问 D1；History API 导航与旧链接兼容。

CI [#42769217413](https://github.com/119shenhao/spine-community/actions/runs/42769217413) Success，119 项测试通过；独立的 GitHub Actions [预览 SEO HTTP 抓取验证 #42769217272](https://github.com/119shenhao/spine-community/actions/runs/42769217272) Success，实测预览 robots.txt、首页 HTML/Canonical、预览 sitemap 404、真实已发布帖子的服务器 HTML/正文/Canonical、无效 ID 的 404。此验证不创建帖子、不修改用户内容。**通过预览 HTTP 验证不等于 Google 已收录**；Google Search Console 的真实抓取和覆盖范围仍需正式发布后检查。

## 生产发布后的操作清单

1. 经用户明确发布授权，把已测试版本按既有 release PR 流程部署生产；不复制开发库用户和帖子。确认 Cloudflare Production 构建成功。
2. 用浏览器打开 https://spine.nbn369.com/robots.txt 和 https://spine.nbn369.com/sitemap.xml ，确认生产 Sitemap 是 XML 且只含公开帖子。
3. 随机抽取已公开的真实主帖，打开 /topic/ID，检查 HTTP 200 与网页源代码直接包含标题、正文及 Canonical。通过浏览器关闭 JavaScript 再确认正文仍可阅读；对隐藏和删除状态分别核对 404/noindex 与无私密内容泄露。
4. 在 [Google Search Console](https://search.google.com/search-console) 验证 spine.nbn369.com 的站点所有权，并提交 https://spine.nbn369.com/sitemap.xml 。
5. 在 Search Console 的「网址检查」测试真实帖子的 Google 抓取/渲染，检查页面索引报告、Sitemap 发现数量、曝光与点击。Google 收录速度及排名不保证，属于上线后的持续运营验收。
6. 公开患者文字可能被搜索引擎及第三方缓存，应在论坛隐私文案中说明；转载/导入内容必须保持真实授权与来源可追溯，不应伪装成本站用户新写的经历。
