// generate.js — 读当日候选清单，分两段直连 API 生成完整版 md（替代 claude CLI 无头调用）
// 用法: node generate.js [--dry]
// 依赖: settings.json 的 ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN（不打印）
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

// 昨天（或最近一份）日报的标题，用于去重
let prevTitles = [];
try {
  const files = fs.readdirSync(ROOT)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f) && f.slice(0, 10) < today)
    .sort();
  if (files.length) {
    const prev = fs.readFileSync(path.join(ROOT, files[files.length - 1]), 'utf8');
    prevTitles = (prev.match(/^- \*\*(.+?)\*\*/gm) || []).map(s => s.replace(/^- \*\*|\*\*$/g, ''));
  }
} catch (e) { /* 无历史则跳过 */ }

const common = `你是资深 AI 资讯编辑。只使用下面「候选新闻清单」里的信息与链接，不得编造。每条至少两句、重点条目 3~4 句（是什么 + 关键数字/细节 + 影响）；对「发品·商品分类·AI 产品开发」可直接落地的条目，描述末尾加「（⭐项目可用）」。来源写作（来源A/来源B），链接用清单里的 URL。去重：以下标题已在前一天日报发过，不要重复：${prevTitles.length ? prevTitles.join('；') : '（无）'}

候选新闻清单：
${candidates}`;

const segA = `生成今日《AI 资讯日报》的【前半部分】，只输出以下三个分区（不要输出标题行、不要输出其他分区、不要输出页脚）：

## 🔥 头条
（3 条，每条一行：- **标题** — 描述（来源）[链接](url)）

## 🧠 模型 · 产品 · 技术

### 模型 & 产品
（7~10 条）

### 框架 · 开源 · MCP · Skills
（7~9 条）

${common}`;

const segB = `接续今日《AI 资讯日报》，只输出以下两个分区（不要输出标题行、不要输出其他分区、不要输出页脚）：

### 技术方向 & 论文
（4~6 条）

### 新品速递（Show HN）
（3~4 条）

${common}`;

const segC = `接续今日《AI 资讯日报》，只输出以下三个分区（不要输出标题行、不要输出其他分区、不要输出页脚）：

## 🏢 公司 & 融资
（2~3 条）

## 🇨🇳 国内动态
（2~4 条）

## 💬 社区热议
（4~6 条）

${common}`;

function loadAuth() {
  const provider = process.env.AI_PROVIDER || 'anthropic';
  if (provider === 'github-models') {
    if (!process.env.GITHUB_TOKEN) throw new Error('missing GITHUB_TOKEN for github-models provider');
    return { provider, model: process.env.GH_MODEL || 'openai/gpt-4.1' };
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
    if (auth.provider === 'github-models') {
      const r = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.GITHUB_TOKEN },
        body: JSON.stringify({ model: auth.model, max_tokens: Math.min(maxTokens, 8000), messages: [{ role: 'user', content: prompt }] }),
      });
      const txt = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
      const j = JSON.parse(txt);
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (!text) throw new Error('empty completion');
      console.error(`segment done: ${text.length} chars, finish_reason=${(j.choices && j.choices[0] && j.choices[0].finish_reason) || '?'}`);
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
    console.error(`segment done: ${text.length} chars, stop_reason=${j.stop_reason || '?'}`);
    return text;
  } finally { clearTimeout(t); }
}

async function callWithRetry(auth, prompt, maxTokens) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await callAPI(auth, prompt, maxTokens, 180000); }
    catch (e) { lastErr = e; console.error(`generate: attempt ${attempt} failed: ${e.message}`); }
  }
  throw lastErr;
}

function cleanSeg(s) {
  return s.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

// 从正文（来源）[链接] 标签里统计独立来源
function countSources(md) {
  const set = new Set();
  for (const m of md.matchAll(/（([^（）]+)）\[/g)) {
    const s = m[1].trim();
    if (/^[\d.,]+\s*分/.test(s)) continue; // Show HN 分数徽章
    s.split('/').forEach(x => { const v = x.trim(); if (v) set.add(v); });
  }
  return [...set];
}

(async () => {
  const auth = loadAuth();
  console.error('generate: segment A (head + models + oss)...');
  const a = cleanSeg(await callWithRetry(auth, segA, 16000));
  console.error('generate: segment B (papers + new)...');
  const b = cleanSeg(await callWithRetry(auth, segB, 16000));
  console.error('generate: segment C (biz + cn + hn)...');
  const c = cleanSeg(await callWithRetry(auth, segC, 16000));

  let md = `# AI 资讯日报 · ${today}（周${weekday}）\n\n${a}\n\n${b}\n\n${c}\n`;
  const sources = countSources(md);
  md += `\n---\n*生成时间 ${genTime} · 来源数 ${sources.length}（${sources.join('、')}）*\n`;

  const items = (md.match(/^- \*\*/gm) || []).length;
  const required = ['## 🔥 头条', '### 模型 & 产品', '### 框架 · 开源 · MCP · Skills', '### 技术方向 & 论文', '### 新品速递', '## 🏢 公司 & 融资', '## 🇨🇳 国内动态', '## 💬 社区热议'];
  const missing = required.filter(k => !md.includes(k));
  if (missing.length) { console.error('generate: missing sections: ' + missing.join(' | ')); process.exit(1); }
  if (items < 30) { console.error(`generate: too few items (${items})`); process.exit(1); }

  if (md.includes('�')) { console.error('generate: mojibake (U+FFFD) detected'); process.exit(1); }
  if (process.argv.includes('--dry')) { console.log(md.slice(0, 3000)); console.error(`[dry] ${items} items, ${md.length} chars`); return; }
  const outFile = path.join(ROOT, `${today}.md`);
  fs.writeFileSync(outFile, md, 'utf8');
  console.log(`generate: wrote ${outFile} (${items} items, ${sources.length} sources, ${md.length} chars)`);
})().catch(e => { console.error('generate fatal:', e.message); process.exit(1); });
