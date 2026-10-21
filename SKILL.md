---
name: ai-news
description: 每日 AI 资讯日报。自动抓取最近 24 小时的中英文 AI 新闻（模型发布、新框架/开源项目、技术研究、产品、公司动态、社区热议），生成中文 digest 保存到 D:\ai-news\，并推送企业微信。当用户说「AI 日报」「AI 早报」「AI 资讯」「今天 AI 圈有什么新闻」，或每日定时任务触发时使用。
---

# AI 每日资讯日报

生成一份精炼的中文 AI 资讯日报：**只收录最近 24 小时内的新闻**，多源去重，按重要性排序，保存为 Markdown 文件，生成企业微信推送版，并在对话中给出精华摘要。**「模型 & 产品」是用户最关心的板块，条数优先给足**，其次是新框架、开源项目、论文、新概念。

## 阶段划分（无头定时任务分两阶段执行，每次调用都是全新上下文）

Windows 定时任务通过 run.cmd 分**两次** `claude -p` 调用本技能，调用词里会写明阶段。按调用词执行对应阶段；交互式会话（用户当面要日报）则 1→4 一次性全做。

- **STAGE 1（采集与成稿，纯脚本）**：`node D:\ai-news\fetch-all.js`（并行抓 17 源 → 紧凑候选清单）→ `node D:\ai-news\generate.js`（三段式直连 API 生成 ①完整版 md）。**无 claude CLI、无交互**；任一步 exit≠0 即失败，run.cmd 告警并等下一个补跑点。
- **STAGE 2（推送版与网站版，纯脚本）**：`node D:\ai-news\generate-push.js`（直连 API 生成 ②推送版）→ `node D:\ai-news\md2html.js`（生成 ③HTML 并自动更新 index.html）→ 执行 步骤4 落盘自检。

## 步骤

### 1. 采集（脚本化，~1 分钟内完成）

**首选（无头与交互式都先跑它）**：运行 `node D:\ai-news\fetch-all.js` —— 并行抓取下方全部信源、自动过滤最近 24h、去 HTML 标签并截断，输出紧凑候选清单 `D:\ai-news\tmp\candidates-YYYY-MM-DD.txt`（头部含成功/失败源列表、各源条数与耗时，约 30~40KB）。然后 Read 该清单，按 步骤2 规则筛选去重。**只有清单头部列出的失败源，才用 WebSearch / webReader 补抓**。禁止逐个源抓原文塞进上下文。

以下为脚本内置的信源清单（参考与兜底用）。⚠️ 脚本未含：hf-mirror 论文镜像（arXiv 已覆盖主源）、mcp.so（历史 404）、36氪（AI 浓度低需过滤）——确需时 webReader 手动补：

按优先级依次尝试：

1. **官方一手信源（webReader，最高优先级——新模型/新产品的第一发布地）**：
   - OpenAI 官方 RSS：`https://openai.com/news/rss.xml`（原生 RSS 带日期；⚠️ 标题字段是空的，条目只有 URL，需从 URL slug 还原标题，如 `the-defenders-window` → "The Defenders Window"；只取最近 24h 的）
   - Anthropic 新闻页：`https://www.anthropic.com/news`（官方无 RSS，直接抓页面，取最新条目的标题+日期；备用：RSSHub 路由 `https://rsshub.app/anthropic/news`，⚠️ 公共实例缓存滞后约一年，2026-08 实测不可用作当日源）
   - Apple Newsroom RSS：`https://www.apple.com/newsroom/rss-feed.rss`（原生 Atom 带标题+一句话摘要，**2026-09-10 实测本机可达**；发布会期间取条目并按上文例外 2 成稿；9to5mac 备用源 `https://9to5mac.com/feed/` 也可达）
   - 官方信源的条目直接进「模型 & 产品」板块，标注「官方博客」
2. **AIHOT 中文聚合 RSS**（webReader，高质量中文摘要源）：
   `https://aihot.virxact.com/feed.xml`
   聚合 IT之家/HN 中文/OpenAI/Anthropic/NVIDIA/Google 官博/X 大V/HP内公众号，带现成中文摘要与分类；⚠️ 别用 /rss 路径（旧缓存），认准 /feed.xml；取最近 24h 条目，与其他源去重。
3. **WebSearch**（英文，模型/产品优先）：
   - `new AI model release today OpenAI Anthropic Google Meta`
   - `AI model API pricing update launch {今天日期}`
   - `AI news today {今天日期}`
   - `AI startup funding acquisition news this week`（补公司&融资）
4. **WebSearch**（中文）：
   - `大模型 发布 上线 新功能`
   - `AI 产品 更新 发布`
   - `人工智能 今日 要闻`
   - `AI 融资 收购 开源 动态 本周`（2026-09-08 实测中文 WebSearch 内容很全，如蚂蚁 Ring-1T/昆仑万维 Skywork/星火 X2.5）
5. **Hacker News** 最新 AI 帖（用 web_reader MCP 的 `webReader` 工具抓 JSON，无需登录；模型发布/产品上线基本都会上 HN）：
   `https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&hitsPerPage=30&restrictSearchableAttributes=title`
   注意：①带 `numericFilters=` 长参数的 URL 会被 webReader 报 -400，别用；②**必须带 `restrictSearchableAttributes=title`**（2026-08-31 实测：不带它 HN 会把命中帖的 story 全文塞进 `_highlightResult`，单次响应膨胀到 6 万字符，直接挤爆无头运行上下文；带上后单条 ~600 字符，标题/URL/日期/分数全保留）；③拿到结果后自己按 `created_at` 过滤最近 24h、按 `points` 排序。
6. **GitHub 社区热门（技术侧主力，webReader；2026-09-04 通道重测）**：
   - **Agent Skills 榜**（skills.sh，本机可达）：`https://skills.sh`
     返回 All Time / Trending(24h) / Hot 榜单与安装量（如 784.0K installs）；按安装量+热度挑热门 skill **5~7 个**（如 agent-browser、find-skills、code-review、技能包大户 mattpocock/skills、anthropics/skills、vercel-labs、飞书 lark、azure-skills 等），记安装量。⚠️ 榜单表格很长（**HTML 转文本后前 ~6KB 即含 Trending(24h) 部分，maxChars 传 8000，别抓全页**）
   - **GitHub 新星项目**（GitHub Search API，webReader `raw=true`）：`https://api.github.com/search/repositories?q=created:%3E{今天3天前}&sort=stars&order=desc&per_page=8`
     挑 4~7 个记 stars：**AI/LLM/agent/推理基础设施/Skills/MCP 相关优先；非 AI 的高星新项目（开发者工具/框架/效率/DIY 等）同样收录 2~3 个**（2026-09-08 用户要求：GitHub 板块不限 AI 与否）。⚠️ JSON 每项含大量冗余字段（约 5~6KB/条），**per_page=8、maxChars=35000 封顶，别加大**；看 full_name / description / stargazers_count / language / topics 字段即可
   - **GitHub 年度高星榜**（2026-10-12 加，脚本已内置）：`created:>{近 365 天} stars:>20000 sort:stars per_page=15`——覆盖「慢热型超级热门仓」：创建数月、靠生态口碑涨到数万星但从未进入新闻流（如 REA 半年 10.8 万★，HN 零热帖，此前所有通道都漏）。榜单每天出现属常态：**只收当日有新版本/新事件/新讨论的；用户在别处提到的漏报项目从这个榜回补**
   - **Agent Skills/MCP 生态新库**（同上 API，可选补充）：`https://api.github.com/search/repositories?q=topic:agent-skills+created:%3E{今天3天前}&sort=stars&order=desc&per_page=8`
     skills.sh 没覆盖的新技能包/新仓库 2~3 个，记 ★
   - **MCP 新 server**（同上 API）：`https://api.github.com/search/repositories?q=topic:mcp+created:%3E{今天3天前}&sort=stars&order=desc&per_page=8`
     挑 MCP server/工具新库 **2~4 个**，记 ★，与 GitHub 新星/生态新库去重
   - **OpenAI 官方生态**（2026-09-08 用户要求）：`https://api.github.com/search/repositories?q=org:openai&sort=updated&order=desc&per_page=8`
     OpenAI 官方 GitHub 组织最近更新的仓库（skills/MCP/agent 工具/开源项目，不限于新仓），挑 **1~3 个**记 ★
   - `https://mcp.so` — MCP 市场（能通则挑 1~2 个；404 或失败直接跳过）
   - ⚠️ `https://github.com/trending` 页面及 ghfast.top / gh-proxy.com 镜像本机不可达（403/超时），**不要尝试抓 Trending 页**
7. **HuggingFace Daily Papers**（技术侧主力，webReader；⚠️ 原站被墙，走镜像）：
   `https://hf-mirror.com/papers` — **本机可达（2026-09-04 实测）**，取每日论文：标题 + 作者数 + 一句话技术点，挑概念新、与 AI agent/LLM 相关度高的 **3~6 篇**；镜像无 upvote 数就写「Sep 8 新论文」或机构名。原站 `https://huggingface.co/papers` 本机被墙，别试。
   **arXiv 结构化 API**（2026-10-08 实测加入，webReader；与 hf-mirror 按标题去重）：
   `https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20`
   当日新稿（下午采即有当天条目），比镜像更早更新、带准确日期与 author 字段；挑相关度高的 **3~6 篇**，与 hf-mirror 重合条目以 arXiv 为准（日期更准）。可把 `cat:cs.AI` 换成 `cat:cs.AI+OR+cat:cs.CL` 扩大范围；HF Papers API `https://huggingface.co/api/papers` 2026-10-08 实测本机不通，别试。
8. **HN Show HN** 新品流（webReader，挑 AI 相关的）：
   `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=30&restrictSearchableAttributes=title`
   挑 AI 工具/agent 相关的新产品，1~3 个即可。
9. **中文 RSS**（用 webReader，能通哪个用哪个）：
   - 量子位：`https://www.qbitai.com/feed`（⚠️ 2026-10-08 实测可达，日更 5~10 条、当日源，中文 AI 垂类主力；与 AIHOT/IT之家去重）
   - IT之家：`https://www.ithome.com/rss/`
   - 36氪：`https://36kr.com/feed`（⚠️ 2026-10-08 实测可达但 AI 浓度 30~40%，需按 AI 关键词过滤，可选）
   - 机器之心：`https://www.jiqizhixin.com/rss`（⚠️ 2026-08 实测 RSS 停更在 2026-02，2026-10-08 复测 /rss 返回 HTML 导航页确认已死，仅作参考）
10. **英文媒体 & 融资**（webReader；2026-10-08 实测可达统一加入，补英文产品动态与融资，偏「🏢 公司 & 融资」与英文官方动态；每个源挑 **2~4 条**）：
   - TechCrunch AI：`https://techcrunch.com/category/artificial-intelligence/feed/`
   - The Verge AI：`https://theverge.com/rss/ai-artificial-intelligence/index.xml`（与 TechCrunch 内容重叠约 1/3，按标题去重）
   - Tech Funding News AI：`https://techfundingnews.com/category/ai/feed/`
   - GitHub Blog AI&ML：`https://github.blog/ai-and-ml/feed/`（低频 1~2 条/天、常有非当日稿；官方工程稿可进「🧠 框架 · 开源」）
   - Claude Code 更新日志（可选，低频）：`https://code.claude.com/docs/en/changelog`（2026-10-08 实测可达；仅当有当日新版号条目时收录 1 条，标注官方博客）
   - BestBlogs 出口（可选，低频）：`https://www.bestblogs.dev/en/feeds/rss?category=ai&minScore=90`（2026-10-08 实测可达但聚合滞后——最新条目 pubDate 停在 10-01；feed 全文 291866 字符、条目按时间倒序，**前 ~8000 字符即含最新条目，maxChars 传 8000 别抓全文**）

> 通道可达性由 fetch-all.js 运行时自动检测（失败源写入清单头部，用 WebSearch 补即可）。WebSearch 遇 500 跳过、WebFetch 被墙不可用。

### 2. 筛选与去重

- 只保留最近 24 小时的消息（超过 24h 但特别重大的可酌情保留 1-2 条并标注日期）；同一事件多源报道合并成一条，**官方博客与媒体报道冲突时以官方为准**
- 🚫 **以下几类一律不收**（2026-09-04 加，2026-09-10 修订）：车企动态（自动驾驶 AI 除外）、CEO 换任/人事八卦、纯文娱/电商/饮食新闻——直接放弃宁少勿水；「公司 & 融资」「国内动态」只收 AI 相关，且公司&融资最多 3 条
- ✅ **例外 1：GitHub 开源/新星/Skills/MCP 板块不限 AI 相关**——非 AI 的优质新项目、新技能、开发者工具照收（2026-09-08 用户要求）
- ✅ **例外 2：大厂年度旗舰发布会必收**（苹果/Google/三星等）——AI 内容重点写（Apple Intelligence/端侧模型/AI 芯片/Siri 等），有官方专稿优先引官方
- ✅ **例外 3：热门消费硬件收 1~3 条**（2026-09-10 用户要求「消费硬件曝光也放进来，主要是热门的」）——苹果/英伟达/华为等发布会新品、热搜/销量/抢购级硬件话题（爆款手机、显卡、AI 眼镜/机器人硬件），写「热点在哪 + 关键亮点 + 为什么值得关注」；冷门常规上架曝光仍不收。信源：IT之家 RSS / AIHOT 的科技条目
- ✅ **例外 4：大会类大事件的「重磅子发布」须独立成条**（2026-09-30 加）——DevDay / 年度发布会等一口气发布多项时，凡社区有独立讨论度的单点（新 API / 新模型 / 新品类 / 单独上线的产品），须作为独立条目写清「是什么 + 与谁对标 + 关键参数」，不得只在综述里一句带过（反面案例：2026-09-30 DevDay 的 Decisions API 只埋进评测行，用户感知为未收录）
- ✅ **例外 5：社区刷屏级 demo/现象须加「现象综述」条目**（2026-09-30 加）——同一演示/能力在 ≥3 个独立来源（X/B站/公众号/HN/IT之家）形成热议或连续多天上榜（如 Claude Opus 5.5「代码直出视频」浪潮），除收录相关 repo 外必须补一条现象综述：现象是什么 + 为什么刷屏 + ≤2 个代表案例 + 与相邻领域的边界（如代码渲染 vs 专业视频模型）；权威人物亲自演示（如 Dario 画头像）也是强触发信号。采集兜底：中文 WebSearch 加一轮「{主题} AI 刷屏 热议 演示」确认多源
- ✅ **例外 6：公司新产品发布加量**（2026-10-10 用户要求）——除大厂旗舰外，各公司（含知名创业公司/开源团队）当日上线的明确新产品、新功能、新版本都收（1~3 条/天）：写清「是什么 + 关键能力 + 对标谁」；冷门上架/常规曝光仍不收
- ✅ **例外 7：新概念独立成条**（2026-10-10 用户要求）——当日出现的新术语/新范式/新协议（如 agent 互操作协议、AgentOS、决策模型赛道、蒸馏安全等）独立成条，写清「概念是什么 + 主要玩家 + 意义」
- ⭐ **项目可用性偏好**（2026-10-10 用户要求；用户项目=发品/商品分类场景）——对「发品·商品分类·AI 产品开发」可直接落地的信息优先收录并在描述里写明「能怎么用」：低延迟决策模型与 API（对标 Jev）、图像/视频生成、分类/路由、MCP/Skills、低成本小模型、agent 编排、RAG
- ⭐ **常设重点关注：国内对标 Jev 的低延迟决策模型**（2026-09-30 加；需求来源叶萌 9/30；场景：**发品时的商品分类选择**，核心诉求=推理速度快）——凡国内出现对标 TypeSafe Jev / OpenAI Decisions API（基于 Luna、~150ms 实时决策/路由）的新动态一律优先收进「🧠 模型 & 产品」或「🇨🇳 国内」板块，写明：延迟（ms）、参数量、对标 Jev 的跑分、API/私有化部署是否可用。已知玩家（有新版本/新跑分/新价格就跟进）：上海 AI 实验室 **Intern-Decision（书生·明决）** 0.8B/2B/4B 多模态、基元律动 **NeoHorse-Jev-4B**（tokenrhythm.studio 有 API）、**Laya-SystemOne**（基石智算云）、阿里云百炼 **decision-model-preview**（一次前向出分类/判断/评分+置信度）、快档小模型（Qwen-flash / GLM-Flash / 豆包-lite 级）做分类路由的重大升级。采集检索词加一轮：`决策模型 Jev 国产 对标`、`Intern-Decision 书生 明决`、`低延迟 分类 路由 小模型 API`
- 优先级：**新模型发布 / 新产品 > 新框架、开源项目、有意思的论文与技术概念 > 大厂重要动作/融资并购 > 政策监管 > 其他**
- **「模型 & 产品」子板块每天至少 7 条**（含 0~3 条热门硬件）：新模型/新版本、API 调价与限流、跑分榜单变化、新产品上线、大模型 App 大更新、硬件/端侧推理、region 开放都算；小动态可合并成一条综述（如"本周 API 调价一览"）
- 每条至少两句、**重点条目 3~4 句**：是什么 + 关键数字/细节 + 亮点/影响（为什么值得关注）（2026-09-10 用户要求「信息可以多一点」）；开源/GitHub 项目带 ★ 数，skills 带 installs，论文带机构名；只有一行干巴巴的事实描述 = 不合格条目，补上影响或删掉
- 总数控制在 **40~48 条**（2026-10-10 用户要求内容加量，尽量顶格 44~48），其中技术板块（🧠）20~26 条；没有足够多的一手消息时宁可少写，不要拿旧闻凑数
- 未经证实的传闻标注「传闻」

### 3. 输出（三份文件：① STAGE 1 必写，②③ STAGE 2 必写）

**① 完整版**（STAGE 1 产出）：`node D:\ai-news\generate.js` 生成（分三段直连 API：头条+模型+开源 / 论文+新品 / 公司+国内+热议，自动带入昨日标题去重、自动统计来源数）；交互式会话也可手写。保存到 `D:\ai-news\YYYY-MM-DD.md`（用今天日期；文件已存在则覆盖），格式：

```markdown
# AI 资讯日报 · YYYY-MM-DD（周X）

## 🔥 头条（最多 3 条）
- **标题** — 一句话说明（来源）[链接]

## 🧠 模型 · 产品 · 技术（重点板块，10~16 条）
按小标题分组：

### 模型 & 产品（至少 5 条，用户最关心；官方博客条目优先排前）
- **名称** — 是什么+亮点（来源）[链接]

### 框架 · 开源 · MCP · Skills（GitHub 新星【AI+非AI 都收】+ Skills 榜 + MCP 新库 + OpenAI 官方生态合计 **7~12 条**，用户要求加量加厚）
- **owner/repo** — 干什么的+亮点，N★（GitHub Search API 无日增数据，只写 N★；skills.sh 的写 N.NM installs）[链接]

### 技术方向 & 论文（4~8 篇）
- **论文名**（机构）— 一句话技术点（hf-mirror 无 upvote 数，写日期/作者数即可）[链接]

### 新品速递（Show HN，2~4 条）
- **名称** — 干什么的+解决什么问题 [链接]

## 🏢 公司 & 融资（≤3 条，必须 AI 相关）
- ...

## 🇨🇳 国内动态（2~4 条，AI 相关，2026-10-10 起加量）
- ...

## 💬 社区热议（HN）
- ...

---
*生成时间 HH:MM · 来源数 N（N=实际引用的独立出处数：官方博客/权威媒体，按条目逐个计，别把 AIHOT/HN 中转站重复算进来源数）*
```

每条格式统一：`- **标题** — 一句话中文摘要（来源）[链接]`

**② 企业微信推送版**（STAGE 2 产出）：`node D:\ai-news\generate-push.js` 生成（直连 API，自动校验汉字数 ≥900）；交互式会话也可手写。保存到 `D:\ai-news\YYYY-MM-DD.push.md`，约束：**≤1250 个汉字（约 3700 UTF-8 字节，超了就删条目）；但要写满到 ≥1000 汉字，别短交**（2026-09-10 用户反馈「显示的还是很少」——推送版是即时可读的主版本，要尽量全）、无链接（手机上点不了 md 链接，标题就是内容）、企业微信 markdown 语法（支持加粗/引用/列表）。格式：

```markdown
# AI 日报 · M月D日 周X

**🔥 头条**
1. **标题** — 一句话
2. ...
3. ...

**🧠 模型 & 产品**
- **名称** — 一句话亮点
- ...（6~8 条）

**🛠️ 开源 & 论文**
- ...（5~7 条短行）

**🏢 公司** / **🇨🇳 国内** / **💬 热议**（各 2~3 条）

> 完整 N 条版以群文件同步发出（AI-daily-YYYY-MM-DD.html，点开直接看）
```

> 注意：run.cmd 在推送前会自动调用 `insight.ps1`（内部 AI 网关 qwen3.7-plus）在标题下追加一段「💡 今日洞察」，**STAGE 2 不用生成它**。

**③ HTML 日报网站版**（STAGE 2 产出）：**生成方式：运行 `node D:\ai-news\md2html.js`**（读当日 md、复用最近一天页面的样式与结构、生成 `D:\ai-news\html\YYYY-MM-DD.html` 并自动更新 `D:\ai-news\html\index.html` 索引；`--dry` 可预览条数解析）。**禁止手写 HTML**（模板整读是上下文大头且样式易漂移）；脚本产物只需核验：条数/来源数/生成时间/8 分区/★徽章/U+FFFD。要求：
- 卡片式排版：每条一张卡（标题可点击跳原文、来源徽章、**3~4 句完整描述**，比 md 版更厚：是什么/关键数字/亮点/为什么重要）（2026-09-10 用户要求「信息多一点」）
- 页首 sticky 分区导航条；GitHub/MCP/Skills 项目带 ★/日增/安装量徽章、论文带机构/upvote 徽章；颜色按板块区分
- 头部含统计（条数/来源数/生成时间）与「今日速览」要点框；参考已有页面 D:\ai-news\html\2026-08-19.html 的结构与样式

保存成功后，在对话里输出 **5 条以内** 的今日精华（不用贴全文）。

### 4. 落盘自检（STAGE 2 必做，三份文件都查：md / push.md / html）

另有一道兜底：push.ps1 推送前会用 PowerShell 正则硬查 U+FFFD，发现乱码**拒绝推送**并在 push.log 记 `push BLOCKED`——模型自检漏网时由它拦住。

本机 Write/Edit 写含中文的文件存在**间歇性乱码 bug**（混入合法 UTF-8 的 U+FFFD 替换符）。保存后必须自检并修复，**只用已授权工具（Grep / Read / Edit / Write），不要尝试用 Bash**：

1. 用 Grep 工具分别查三个文件：pattern 填 `\uFFFD`，output_mode 用 `content`（带行号）
2. 无匹配 → 通过，结束
3. 有匹配 → Read 该行上下文，推断被损坏的原文，用 Edit 把坏串替换成正确中文，然后回到第 1 步复查
4. 若 Edit 的 old_string 参数也被乱码咬（报 String not found），改用 Write 整文件重写后再自检。本 bug 是**间歇性**的，重试通常 1~2 次即过；最多重试 3 次，仍失败就在文件末尾标注「含乱码，待人工修复」并放弃

## 定时任务与推送

Windows 任务计划 "AI News Digest" 每日 **08:00**（2026-09-23 用户定稿；开机晚于 08:00 则由 StartWhenAvailable + 登录触发器补跑）通过 `.claude\skills\ai-news\run.cmd` 无头调用本技能（wscript 隐藏窗口启动）。run.cmd 在 claude 生成完两份文件后、调用 `push.ps1` 之前，会先运行 `insight.ps1`：它调用内部 AI 网关（qwen3.7-plus，key 优先取环境变量 `VISION_API_KEY`，否则读 `D:\ai-news\gateway-key.txt`）在推送版标题下插入一段「💡 今日洞察」，失败不阻塞推送（全部失败路径 exit 0，已插入则跳过）。随后 `push.ps1` 把推送版 POST 到企业微信群机器人 Webhook，附件为当日 HTML 日报文件卡片（`D:\ai-news\html\` 下，缺失时回退 md）（地址放在 `D:\ai-news\webhook.txt`，文件缺失或无效时跳过推送不报错）。运行日志：`D:\ai-news\run.log`。
