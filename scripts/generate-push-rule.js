// generate-push-rule.js — 规则化生成企业微信推送版（不调 API，稳定可控）
// 读当日 md，抽取各分区条目，用固定模板输出 1000+ 汉字。
'use strict';
const fs = require('fs');
const path = require('path');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';
const MD = path.join(ROOT, `${today}.md`);
if (!fs.existsSync(MD)) { console.error(`rule-push: missing ${MD}`); process.exit(1); }
const md = fs.readFileSync(MD, 'utf8');

const SECTIONS = [
  ['hot', /^## 🔥/],
  ['models', /^### 模型 & 产品/],
  ['oss', /^### 框架 · 开源/],
  ['papers', /^### 技术方向/],
  ['new', /^### 新品速递/],
  ['biz', /^## 🏢/],
  ['cn', /^## 🇨🇳/],
  ['hn', /^## 💬/],
];

const items = {};
let cur = null;
for (const line of md.split('\n')) {
  const t = line.trim();
  const sec = SECTIONS.find(([, re]) => re.test(t));
  if (sec) { cur = sec[0]; continue; }
  if (t.startsWith('## ') || t.startsWith('### ')) { cur = null; continue; }
  if (t.startsWith('- **') && cur) {
    const m = t.match(/^- \*\*(.+?)\*\*\s*—\s*(.+)$/);
    if (!m) continue;
    let title = m[1].trim();
    let rest = m[2];
    // 去掉来源与链接
    rest = rest.replace(/（[^（）]+）\s*\[[^\]]*\]\([^)]*\)\s*$/, '').trim();
    const first = (rest.split('。')[0] || rest).trim().replace(/[；;]$/, '');
    (items[cur] = items[cur] || []).push({ title, desc: first });
  }
}

function line(it, idx, numbered) {
  const prefix = numbered ? `${idx + 1}.` : '-';
  return `${prefix} **${it.title}** — ${it.desc}。`;
}

const out = [];
out.push(`# AI 日报 · ${now.getMonth() + 1}月${now.getDate()}日 周${['日', '一', '二', '三', '四', '五', '六'][now.getDay()]}`);
out.push('');
if ((items.hot || []).length) {
  out.push('**🔥 头条**');
  items.hot.slice(0, 3).forEach((it, i) => out.push(line(it, i, true)));
  out.push('');
}
if ((items.models || []).length) {
  out.push('**🧠 模型 & 产品**');
  items.models.slice(0, 8).forEach(it => out.push(line(it)));
  out.push('');
}
const oss = [...(items.oss || []).slice(0, 5), ...(items.papers || []).slice(0, 2)];
if (oss.length) {
  out.push('**🛠️ 开源 & 论文**');
  oss.forEach(it => out.push(line(it)));
  out.push('');
}
const misc = [...(items.biz || []).slice(0, 2), ...(items.cn || []).slice(0, 2), ...(items.hn || []).slice(0, 3)];
if (misc.length) {
  out.push('**🏢 公司 / 🇨🇳 国内 / 💬 热议**');
  misc.forEach(it => out.push(line(it)));
  out.push('');
}
const total = Object.values(items).reduce((n, a) => n + a.length, 0);
out.push(`> 完整 ${total} 条版以群文件同步发出（AI-daily-${today}.html，点开直接看）`);
out.push('');

const body = out.join('\n');
const hanzi = (body.match(/[\u4e00-\u9fff]/g) || []).length;
if (body.includes('\uFFFD')) { console.error('rule-push: mojibake'); process.exit(1); }
if (hanzi < 800) { console.error(`rule-push: too short (${hanzi})`); process.exit(1); }
fs.writeFileSync(path.join(ROOT, `${today}.push.md`), body, 'utf8');
console.log(`rule-push: wrote ${today}.push.md (${hanzi} hanzi, ${total} items)`);
