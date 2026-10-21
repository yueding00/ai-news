# AI 晨报 Skill · 完整包

每日 AI 资讯晨报：**采集 17 个信源 → 直连 LLM API 分段生成 → HTML 网站版 → 企业微信推送**。
全流程纯 node 脚本（无 claude CLI / 无 MCP / 无交互），每次调用带超时，可跑在 Windows 计划任务或 GitHub Actions。

## 文件结构

```
ai-news/
├── SKILL.md              # skill 主文件（规则与流程，供 Claude 交互式使用）
├── run.cmd               # Windows 计划任务入口（STAGE 1/2 + 防重 + 推送）
├── insight.ps1           # 推送前在标题下插入「今日洞察」
├── push.ps1              # 企业微信 webhook 推送（含 U+FFFD 兜底拦截）
├── check.ps1             # 推送后质量审计
├── alert.ps1             # 失败告警
└── scripts/
    ├── fetch-all.js      # 并行抓 17 源 → tmp/candidates-YYYY-MM-DD.txt
    ├── generate.js       # 三段式直连 API 生成完整版 md
    ├── generate-push.js  # 直连 API 生成企业微信推送版
    └── md2html.js        # md → 单文件 HTML（复用最近一天页面做模板）+ 更新 index.html
```

## 依赖与配置

1. **Node.js 18+**（使用全局 fetch）。
2. **LLM 凭据**：`C:\Users\<你>\.claude\settings.json` 的 `env` 中：
   - `ANTHROPIC_BASE_URL`（Anthropic 兼容网关）
   - `ANTHROPIC_AUTH_TOKEN`
   - `ANTHROPIC_MODEL`（默认 deepseek-v4-flash[1M]）
   `generate.js` / `generate-push.js` 从该文件读取，不打印、不落日志。
3. **企业微信**：`D:\ai-news\webhook.txt` 写入群机器人 webhook URL。
4. **数据目录**：`D:\ai-news\`（md、push.md、html/、tmp/、日志）。路径按需修改脚本内常量。

## 手动运行（完整链路）

```bat
node D:\ai-news\fetch-all.js
node D:\ai-news\generate.js
node D:\ai-news\generate-push.js
node D:\ai-news\md2html.js
powershell -File insight.ps1
powershell -File push.ps1
```

## Windows 计划任务

- 程序：`wscript` → `run-hidden.vbs` → `run.cmd`（或直接 `run.cmd`）
- 触发：每日 **09:20** 主触发 + **09:40 / 10:10 / 10:20** 补跑 + 登录触发
- 设置：`WakeToRun=true`（睡眠自动唤醒）、`ExecutionTimeLimit=PT1H`、`MultipleInstances=IgnoreNew`
- 幂等：run.cmd 开头检查 `push.log`，当天已推送则直接跳过（多触发不会重复推群）

## 部署到 GitHub Actions（云端，保证每天）

本目录即仓库根，已含 `.github/workflows/daily.yml`：
每天 **09:20（北京时间）** 自动执行 fetch → generate → push → html → 企业微信推送，并把结果 commit 回 `data/`。

### 一次性部署（3 步）

1. **GitHub 新建空仓库**（Private 也可以），例如 `ai-news`。
2. **加 SSH 公钥**：本机 `~/.ssh/id_rsa.pub` → GitHub Settings → SSH and GPG keys → New SSH key。
3. **加 Secrets**（仓库 Settings → Secrets and variables → Actions）：
   - `ANTHROPIC_BASE_URL`（来自本机 `.claude/settings.json` 的 env）
   - `ANTHROPIC_AUTH_TOKEN`（同上，绝不要写进仓库）
   - `ANTHROPIC_MODEL`（如 `deepseek-v4-flash[1M]`）
   - `WECOM_WEBHOOK`（本机 `D:\ai-news\webhook.txt` 的内容）

然后 `git init && git add . && git commit && git remote add origin git@github.com:<你>/ai-news.git && git push -u origin main`。
Actions 页面手动 **Run workflow** 验证一次；之后每天 09:20 自动跑（cron 高峰期可能延迟几分钟）。

> 运行产物（md/push.md/html/index）会自动提交到 `data/`，机器人工作流可用 `raw.githubusercontent.com/<你>/ai-news/main/data/YYYY-MM-DD.md` 拉取（仓库需公开，或机器人侧带 token）。
> 注意：GitHub runner 位于海外，访问国内源（量子位/IT之家/AIHOT）可能较慢或被限流；`fetch-all.js` 会列出失败源并继续。本机通道与云端通道可同时开启（双保险）。

## 安全

- **绝不要**把 `ANTHROPIC_AUTH_TOKEN`、webhook URL 提交进仓库（用 Secrets / 本地文件）。
- 生成失败时脚本 exit≠0：run.cmd 走告警 + 等下一个补跑点；push.ps1 另有 U+FFFD 硬拦截，乱码拒绝推送。
