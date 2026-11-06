# Spine Community — D1 数据库设计 v1（评审草案）

> 日期：2026-11-06。**仅设计，未建表、未执行迁移、未修改网站代码。** 正式业务依据：[需求总览](../requirements/README.md)、[决策记录](../requirements/decisions.md) 以及同目录各专题文档。本文字段、表名与索引是工程建议，不等于新增了未经用户确认的业务规则。

## 1. 设计原则

- 使用 Cloudflare D1（SQLite），所有核心实体使用稳定、不易猜的内部文本 ID；统一 UTC Unix 秒时间戳。账号与帖子通过内部用户 ID 关联，不用 Google 邮箱或公开昵称做关联主键。
- **旧的 migrations/0001_initial.sql 不能直接执行**：它将一个帖子固定到一个分类，并有独立 journal_entries 表；新版要允许零或多个分类，楼主进展就是一条特殊评论。
- 将身份、帖子、分类、翻译、互动、审核、统计分离，界面结构与数据结构解耦。允许将来增加语言、症状、登录方式或栏目。
- 只存储必要的公开内容与账户资料；不要将登录令牌、完整 IP 或敏感医疗信息复制进统计、日志和搜索建议表。
- 这些是**逻辑模型**；配套的 SQL 如果后续生成，也必须先在 D1 测试库验证，不得擅自上线。

## 2. 数据表方案：27 张（按照功能分组）

### A. 用户和权限：6 张

| 表名 | 主要字段 | 规则 |
| --- | --- | --- |
| users | id, nickname, preferred_locale, public_region?, status, created_at, updated_at | public_region 只由用户自愿填写，不推断位置；注销可保留匿名占位 |
| auth_identities | id, user_id, provider, provider_subject | Google 的不可变主体标识；(provider, provider_subject) 唯一；不以邮箱做主键 |
| user_sessions | id, user_id, token_hash, expires_at, revoked_at | 只存会话令牌摘要，不存明文 |
| user_roles | user_id, role, granted_by, granted_at | admin/moderator，权限在服务端验证；初期只启用站长 |
| user_sanctions | id, user_id, sanction_type, starts_at, ends_at?, lifted_at?, actor_id, reason | 记录版主 1/3/7/30 天禁言及站长处罚 |
| privacy_requests | id, user_id, request_type, status, requested_at, resolved_at? | 账号注销、个人数据删除/导出申请；保留期上线前决定 |

### B. 文章、分类和回复：6 张

| 表名 | 主要字段 | 规则 |
| --- | --- | --- |
| taxonomy_terms | id, term_type, slug, is_active, sort_order | 分类、身体部位、症状、治疗方式可动态增加 |
| taxonomy_labels | term_id, locale, label | 同一概念的多语言展示名称 |
| taxonomy_aliases | id, term_id, locale, alias, normalized_alias | 腰痛 / lower back pain 等跨语言同义词关联同一概念；同一词可对应多个概念 |
| topics | id, author_id, title?, body?, source_lang, content_version, status, symptom_duration_days?, reply_count, like_count, created_at, updated_at, deleted_at? | 发布时标题与正文必填；分类不必填；删除时正文清空但主帖占位仍在 |
| topic_terms | topic_id, term_id | 多对多，0 条关联也允许；替代旧版单一 category |
| comments | id, topic_id, author_id, parent_comment_id?, kind, progress_seq?, body?, source_lang, content_version, status, like_count, created_at, updated_at, deleted_at? | 楼中楼关系；kind 为 regular 或 progress；楼主进展使用同一条评论记录 |

服务端必须校验父评论属于同一主题，防循环；progress 只能由主帖作者发布，且应为根回复。进展序号建议稳定递增，删除后不自动重排，此项仍属技术建议。

### C. 互动及通知：5 张

| 表名 | 主要字段 | 规则 |
| --- | --- | --- |
| topic_likes | user_id, topic_id, created_at | 复合主键；本人也能点赞，再点取消 |
| comment_likes | user_id, comment_id, created_at | 同上，进展点赞也复用此表 |
| bookmarks | user_id, topic_id, created_at | 收藏帖子，与关注独立 |
| topic_follows | user_id, topic_id, created_at | 关注单篇帖子，进展更新才生成订阅通知 |
| notifications | id, recipient_id, actor_id?, event_type, topic_id?, comment_id?, event_key, read_at?, created_at | 回复、赞、进展通知；(recipient_id,event_key) 唯一保证幂等；禁止自我通知 |

点赞聚合是展示逻辑，不需要第二份点赞数据。各种互动应通过唯一约束阻止双击重复记录；计数缓存由服务端事务维护。

### D. 翻译：3 张

| 表名 | 主要字段 | 规则 |
| --- | --- | --- |
| topic_translations | topic_id, locale, source_version, title_text, body_text, provider, created_at | 按需生成的帖子译文；来源版本变化后旧缓存失效 |
| comment_translations | comment_id, locale, source_version, body_text, provider, created_at | 回复和楼主进展统一使用 |
| translation_usage_daily | provider, day_utc, characters, requests | 管理翻译服务用量；计数不等于硬性收费上限 |

必须保存原文和源语言，且只能把公开、获准处理的内容送第三方翻译。过期译文不允许展示。

### E. 举报、申诉、管理日志：3 张

| 表名 | 主要字段 | 规则 |
| --- | --- | --- |
| reports | id, reporter_id, topic_id? / comment_id?, reason, detail?, priority, status, created_at | 每条举报恰好一个对象；同一用户对同一对象最多一条有效举报；多举报不自动隐藏 |
| appeals | id, appellant_id, topic_id? / comment_id? / sanction_id?, reason, status, created_at | 被拦截/处罚后复核；高风险内容可以保存为 blocked 但不公开 |
| moderation_actions | id, actor_id, target_type, target_id, action, reason, created_at | 管理操作的不可随意修改审计记录；严禁记录凭证明文 |

主题和评论的可见状态：published、pending_review、blocked、hidden、deleted；与举报是否已处理分开。只有 published 能对公众搜索与浏览；已删除占位只在关联讨论页体现。

### F. 社区和流量统计：4 张

| 表名 | 主要字段 | 规则 |
| --- | --- | --- |
| daily_community_metrics | day_utc, new_users, new_topics, new_comments, new_reports | 每日社区数据 |
| daily_traffic_metrics | day_utc, uv_estimate, pv, peak_active_5m_estimate, peak_hour_utc, peak_hour_pv | 每日 UV、PV 和两个峰值 |
| hourly_traffic_metrics | hour_start_utc, pv | 每小时页面访问次数 |
| traffic_5min_metrics | bucket_start_utc, pv, active_visitors_estimate | 每五分钟流量与活跃人数估计 |

**流量采集边界：** PV 是页面查看次数，不是所有 API 请求；最高同时活跃人数采用最近五分钟去重访客数的近似值，明确显示“估算”。建议先研究 Cloudflare 提供的统计/边缘汇总，再写入 D1 聚合表，**不要每次页面访问就直接向 D1 写多条原始事件**。不存储裸 IP，不按国家拆分，支持 7/30 天趋势。

## 3. 关键数据关系

- 用户 → 多篇帖子；帖子 → 多条评论；评论 → 多条子评论。楼主的进展本质上是 comments 中 kind=progress 的根评论，不另建 journal_entries。
- 帖子 ↔ 分类/症状/治疗词条：通过 topic_terms 多对多；词条在 taxonomy_labels 和 taxonomy_aliases 中按语言展示、匹配。
- 用户 ↔ 帖子：bookmarks、topic_follows、topic_likes 各自独立；用户 ↔ 评论：comment_likes。
- 主帖/评论 ↔ 翻译：按内容 ID、语言和 content_version 管理。编辑原文使译文过期；删除原文必须移除可公开查询的译文与索引。
- 通知关联接收者、触发者和具体帖子/评论 ID。本人发帖进展不通知本人；同一触发事件重试不能重复插入。
- 举报对象需支持严格外键：reports 分别使用可空 topic_id 和 comment_id，并检查“恰有一个有值”，分别建立有效举报的部分唯一索引，而非无约束的 target_type/target_id。

## 4. 索引与性能要点

1. 首页和最新帖：topics(status, created_at DESC, id)，用 (created_at,id) 游标分页；不要长期使用大 OFFSET。
2. 我的帖子/回复：topics(author_id,created_at)、comments(author_id,created_at)；回复列表 comments(topic_id,status,created_at) 和 parent_comment_id 索引。
3. 楼主进展：comments(topic_id,kind,progress_seq)；收藏/关注：(user_id,created_at)；通知：(recipient_id,read_at,created_at)。
4. 分类搜索：topic_terms(term_id,topic_id)，同义词：taxonomy_aliases(locale,normalized_alias)。
5. 全文搜索必须包括未填写标签的主帖原文；跨语言词典 + 关键词扩展与文本检索联合排序。是否使用 SQLite FTS5 及对应索引/触发器，**待在目标 D1 环境验证**，不能依赖“已经缓存了译文”才搜到外文原帖。
6. 译文按 (内容 ID,locale) 唯一，编辑加 content_version；并发限流与费用熔断由后端负责。
7. 所有写入权限、点赞唯一性、发进展作者身份、跨帖回复合法性和管理角色必须服务端校验；多步操作采用事务/批处理。

## 5. 删除、隐私与审核的约束

- **删主帖且有其他人回复**：保留“该帖子已删除”占位以及原关联；清空已删除正文/标题与公开译文，使搜索索引和缓存失效；其他用户的回复继续可读。删有子回复的评论同理。
- 用户注销不能直接级联删除整棵讨论树。建议撤销所有登录会话、解除 Google 身份映射、匿名化账号，保留必要的关系占位；具体数据保留和法律政策必须在上线前确认。
- 站长拥有最高业务管理权；版主不能查看 Google 邮箱、令牌、会话摘要等非必要资料，也不能执行永久封禁、永久删除或授予版主。
- 举报人数本身不能使已发布的帖子自动隐藏；新提交内容可因高风险规则进入 blocked 并提供复核。被禁言用户的发帖/回复必须由服务端拦截。
- 公共地区只允许作者自愿提供；不因 IP、语言、Google 登录资料自动推断。
- 翻译第三方合规、隐私条款、删除/导出、日志保存与年龄门槛留到上架/上线评审；**这不等于已经允许收集所有可选字段**。

## 6. 分批实施建议

- **P0 论坛基础：** users、auth_identities、user_sessions、user_roles、taxonomy_*、topics、topic_terms、comments。
- **P1 互动与语言：** 两种点赞、收藏、关注、通知、翻译缓存、翻译用量。
- **P2 审核与可公开上线：** 用户处罚、隐私申请、举报、申诉、管理员操作日志和四种聚合统计表。

正式建表前，先把这份模型编成迁移 SQL，在隔离的 D1 测试库检查约束、删除流程、跨语言查找及性能，再请用户明确批准执行迁移。**现在绝不改 migrations/ 里的旧草案，也不动生产 D1。**

## 7. 尚待技术评审

搜索的权重与词典来源；SQLite FTS 能力；评论折叠/草稿/编辑历史；内容及日志法定保留期限；审核阈值与禁言具体范围；数据统计去重、时区与保留期；翻译供应商、费用上限与用户健康资料跨境处理。本文不替用户决定这些开放问题。
