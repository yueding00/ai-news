// generate-push.js — 读当日完整版 md，直连 API 生成企业微信推送版 push.md
// 用法: node generate-push.js [--dry]
'use strict';
const fs = require('fs');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';
const MD = path.join(ROOT, `${today}.md`);
if (!fs.existsSync(MD)) { console.error(`generate-push: missing ${MD}`); process.exit(1); }
const md = fs.readFileSync(MD, 'utf8');

const prompt = `你是 AI 日报编辑。把下面这份完整版日报改写成「企业微信推送版」Markdown。

硬性要求：
1. 标题：# AI 日报 · ${now.getMonth() + 1}月${now.getDate()}日 周${weekday}
2. 结构：
**🔥 头条**（3 条，编号列表）
**🧠 模型 & 产品**（6~8 条，每条一行）
**🛠️ 开源 & 论文**（5~7 条短行）
**🏢 公司 / 🇨🇳 国内 / 💬 热议**（各 2~3 条，可用分号合并）
> 完整 N 条版以群文件同步发出（AI-daily-${today}.html，点开直接看）
3. 字数：正文 1000~1250 个汉字（必须 ≥1000，别短交）。
4. 无链接、无 markdown 表格；可用 **加粗**。
5. 保留原文关键数字与事实，不得编造；对项目可用的条目可加 ⭐。
6. 只输出推送版正文，不要任何解释。

完整版日报：
${md}`;

function loadAuth() {
  if (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN) {
    return { base: process.env.ANTHROPIC_BASE_URL.replace(/\/$/, ''), token: process.env.ANTHROPIC_AUTH_TOKEN, model: process.env.ANTHROPIC_MODEL || 'deepseek-v4-flash[1M]' };
  }
  const s = JSON.parse(fs.readFileSync('C:/Users/huangyicheng/.claude/settings.json', 'utf8'));
  const base = (s.env && s.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token = s.env && s.env.ANTHROPIC_AUTH_TOKEN;
  const model = (s.env && s.env.ANTHROPIC_MODEL) || 'deepseek-v4-flash[1M]';
  if (!base || !token) throw new Error('missing ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN');
  return { base, token, model };
}

async function callAPI(auth, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(auth.base + '/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': auth.token, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: auth.model, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
    const j = JSON.parse(txt);
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    if (!text) throw new Error('empty completion');
    return text;
  } finally { clearTimeout(t); }
}

(async () => {
  const auth = loadAuth();
  let out = '', lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { out = await callAPI(auth, 120000); lastErr = null; break; }
    catch (e) { lastErr = e; console.error(`generate-push: attempt ${attempt} failed: ${e.message}`); }
  }
  if (lastErr) process.exit(1);

  out = out.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/, '').trim() + '\n';
  if (out.includes('\ufffd')) { console.error('generate-push: mojibake (U+FFFD) detected'); process.exit(1); }
  const hanzi = (out.match(/[\u4e00-\u9fff]/g) || []).length;
  if (hanzi < 900) { console.error(`generate-push: too short (${hanzi} hanzi)`); process.exit(1); }
  if (process.argv.includes('--dry')) { console.log(out); return; }

  fs.writeFileSync(path.join(ROOT, `${today}.push.md`), out, 'utf8');
  console.log(`generate-push: wrote ${today}.push.md (${hanzi} hanzi)`);
})().catch(e => { console.error('generate-push fatal:', e.message); process.exit(1); });
