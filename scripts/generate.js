// generate.js — 读当日候选清单，分三段让 API 输出 JSON，再由脚本渲染成统一格式的 md。
// 用法: node generate.js [--dry]
// 依赖: settings.json 的 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN（不打印）；云端用 AI_PROVIDER=openai。
'use strict';
const fs = require('fs');
const path = require('path');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const weekday = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
const genTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';
const CAND = path.join(ROOT, 'tmp', `candidates-${today}.txt`);
if (!fs.existsSync(CAND)) { console.error(`generate: missing ${CAND} (run fetch-all.js first)`); process.exit(1); }
const candidates = fs.readFileSync(CAND, 'utf8');

// 前一天标题（去重基准）
let prevTitles = [];
try {
  const files = fs.readdirSync(ROOT)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) < today)
    .sort();
  if (files.length) {
    const prev = fs.readFileSync(path.join(ROOT, files[files.length - 1]), 'utf8');
    prevTitles = (prev.match(/^- \*\*(.+?)\*\*/gm) || []).map(s => s.replace(/^- \*\*|\*\*$/g, ''));
  }
} catch (e) { /* ignore */ }

const common = `你是资深 AI 资讯编辑。只使用下面「候选新闻清单」里的信息与链接，不得编造。
输出必须是**严格 JSON**（不要 Markdown、不要代码围栏、不要解释）。
去重：以下标题已在前一天日报发过，不要重复：${prevTitles.length ? prevTitles.join('；') : '（无）'}

JSON 中每个条目对象格式：{"title":"标题","desc":"3~4 句描述","source":"来源A/来源B","url":"候选清单里的链接"}

**desc 的硬性要求（精选感的来源）**：
1. 必须 3~4 句，不得少于 3 句；
2. 第 1 句：是什么（谁做了什么、什么产品/事件）；
3. 第 2~3 句：关键数字或细节（金额、参数量、跑分、日期、对比基准等），至少包含 1 个具体数字或专有名词；
4. 最后 1 句：影响判断——为什么值得关注、意味着什么、对哪类人有用；
5. 禁止空洞套话（如「值得关注」「意义重大」但不给出具体理由）；没有数字的条目要用细节替代（对标谁、取代什么、比什么快/便宜）。
示例（合格）：{"title":"OpenAI 发布 Decisions API","desc":"OpenAI 基于 GPT-6 Luna 推出 Decisions API，用于分类、路由、评分等有界答案问题。官方称速度最高比 Responses API 快 10 倍，定位低延迟、低成本的小决策场景。该接口可嵌入 Agent 工作流和产品后端，替代部分重推理调用。（⭐项目可用）","source":"OpenAI 官方博客","url":"https://openai.com/index/decisions-api"}

对「发品·商品分类·AI 产品开发」可直接落地的条目，在 desc 末尾加「（⭐项目可用）」。

候选新闻清单：
${candidates}`;

const segA = `生成今日《AI 资讯日报》的【前半部分】JSON，键为 hot / models / oss：
- hot：3 条头条
- models：10~12 条（模型 & 产品）
- oss：9~10 条（框架 · 开源 · MCP · Skills）
**条数必须写满上限，不足视为未完成。**

${common}`;

const segB = `接续今日《AI 资讯日报》的【中段】JSON，键为 papers / new：
- papers：6~8 条（技术方向 & 论文）
- new：3~4 条（新品速递 / Show HN）
**条数必须写满上限，不足视为未完成。**

${common}`;

const segC = `接续今日《AI 资讯日报》的【后段】JSON，键为 biz / cn / hn：
- biz：3 条（公司 & 融资）
- cn：3~4 条（国内动态）
- hn：6~7 条（社区热议）
**条数必须写满上限，不足视为未完成。**

${common}`;

function loadAuth() {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  if (provider === 'openai') {
    const base = (process.env.LLM_BASE_URL || '').replace(/\/$/, '');
    const key = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL || 'deepseek-chat';
    if (!base || !key) throw new Error('missing LLM_BASE_URL / LLM_API_KEY for openai provider');
    return { provider, base, key, model };
  }
  if (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN) {
    return { provider, base: process.env.ANTHROPIC_BASE_URL.replace(/\/$/, ''), token: process.env.ANTHROPIC_AUTH_TOKEN, model: process.env.ANTHROPIC_MODEL || 'deepseek-v4-flash[1M]' };
  }
  const s = JSON.parse(fs.readFileSync('C:/Users/huangyicheng/.claude/settings.json', 'utf8'));
  const base = (s.env && s.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token = s.env && s.env.ANTHROPIC_AUTH_TOKEN;
  const model = (s.env && s.env.ANTHROPIC_MODEL) || 'deepseek-v4-flash[1M]';
  if (!base || !token) throw new Error('missing ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN');
  return { provider, base, token, model };
}

async function callAPI(auth, prompt, maxTokens, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    if (auth.provider === 'openai') {
      const r = await fetch(auth.base + '/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + auth.key },
        body: JSON.stringify({ model: auth.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
      const j = JSON.parse(txt);
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!text) throw new Error('empty completion');
      console.error(`segment done: ${text.length} chars, finish=${(j.choices && j.choices[0] && j.choices[0].finish_reason) || '?'}`);
      return text;
    }
    const r = await fetch(auth.base + '/v1/messages', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': auth.token, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: auth.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
    const j = JSON.parse(txt);
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    if (!text) throw new Error('empty completion');
    console.error(`segment done: ${text.length} chars, stop=${j.stop_reason || '?'}`);
    return text;
  } finally { clearTimeout(t); }
}

async function callWithRetry(auth, prompt, maxTokens) {
  let lastErr = null;
  const modelFallbacks = [auth.model, 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp[1M]'];
  const delays = [0, 20000, 60000];
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (delays[attempt - 1]) await new Promise(r => setTimeout(r, delays[attempt - 1]));
    const model = modelFallbacks[Math.min(attempt - 1, modelFallbacks.length - 1)];
    try { return await callAPI({ ...auth, model }, prompt, maxTokens, 240000); }
    catch (e) { lastErr = e; console.error(`generate: attempt ${attempt} (${model}) failed: ${e.message}`); }
  }
  throw lastErr;
}

function parseJSON(text) {
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in completion');
  return JSON.parse(s.slice(a, b + 1));
}

const esc = s => String(s || '').replace(/\r?\n/g, ' ').trim();

function renderItems(list) {
  return (list || []).map(it => {
    const title = esc(it.title), desc = esc(it.desc), source = esc(it.source), url = esc(it.url) || '#';
    return `- **${title}** — ${desc}（${source}）[${url}](${url})`;
  }).join('\n');
}

const SECTIONS = [
  ['hot', '## 🔥 头条'],
  ['models', '### 模型 & 产品'],
  ['oss', '### 框架 · 开源 · MCP · Skills'],
  ['papers', '### 技术方向 & 论文'],
  ['new', '### 新品速递（Show HN）'],
  ['biz', '## 🏢 公司 & 融资'],
  ['cn', '## 🇨🇳 国内动态'],
  ['hn', '## 💬 社区热议'],
];

(async () => {
  const auth = loadAuth();
  console.error('generate: segment A (hot/models/oss JSON)...');
  const a = parseJSON(await callWithRetry(auth, segA, 32000));
  console.error('generate: segment B (papers/new JSON)...');
  const b = parseJSON(await callWithRetry(auth, segB, 32000));
  console.error('generate: segment C (biz/cn/hn JSON)...');
  const c = parseJSON(await callWithRetry(auth, segC, 32000));
  const data = { ...a, ...b, ...c };

  const lines = [`# AI 资讯日报 · ${today}（周${weekday}）`, ''];
  const TECH_KEYS = new Set(['models', 'oss', 'papers', 'new']);
  let techHeaderAdded = false;
  let total = 0;
  for (const [key, heading] of SECTIONS) {
    const list = data[key] || [];
    if (!list.length) continue;
    if (TECH_KEYS.has(key) && !techHeaderAdded) {
      lines.push('## 🧠 模型 · 产品 · 技术', '');
      techHeaderAdded = true;
    }
    lines.push(heading, '', renderItems(list), '');
    total += list.length;
  }
  const mdBody = lines.join('\n');

  let md = mdBody + `\n---\n*生成时间 ${genTime} · 来源数 N（脚本统计）*\n`;
  // 统计来源
  const srcSet = new Set();
  for (const m of md.matchAll(/（([^（）]+)）\[/g)) {
    const s = m[1].trim();
    if (/^[\d.,]+\s*分/.test(s)) continue;
    s.split('/').forEach(x => { const v = x.trim(); if (v) srcSet.add(v); });
  }
  md = md.replace(/\*生成时间 .*?\*/, `*生成时间 ${genTime} · 来源数 ${srcSet.size}（${[...srcSet].join('、')}）*`);

  if (md.includes('\uFFFD')) { console.error('generate: mojibake detected'); process.exit(1); }
  if (total < 40) { console.error(`generate: too few items (${total}) — target 44~48, retry`); process.exit(1); }

  if (process.argv.includes('--dry')) { console.log(md.slice(0, 2500)); console.error(`[dry] ${total} items, ${md.length} chars`); return; }
  const outFile = path.join(ROOT, `${today}.md`);
  fs.writeFileSync(outFile, md, 'utf8');
  console.log(`generate: wrote ${outFile} (${total} items, ${srcSet.size} sources, ${md.length} chars)`);
})().catch(e => { console.error('generate fatal:', e.message); process.exit(1); });
