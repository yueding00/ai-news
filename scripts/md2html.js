// md2html.js — 把 ai-news 的 md 日报转换成单文件 HTML 日报。
// 样式与页面骨架复用 html/ 目录里最近一天的 .html 作为模板（手术式替换），
// 保证样式永远与最新页面一致，且生成过程不依赖大文件进入 LLM 上下文。
//
// 用法:
//   node md2html.js                     # 默认处理今天的 D:\ai-news\YYYY-MM-DD.md
//   node md2html.js <mdFile> [htmlDir]  # 指定输入
//   node md2html.js --dry               # 只打印解析结果，不写文件
'use strict';
const fs = require('fs');
const path = require('path');

const now = new Date();
const pad2 = n => String(n).padStart(2, '0');
const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';
const mdFile = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(ROOT, `${today}.md`);
const htmlDir = process.argv[3] || path.join(ROOT, 'html');
const isDry = process.argv.includes('--dry');

const md = fs.readFileSync(mdFile, 'utf8');

// ---------- 元信息 ----------
const dateMatch = md.match(/^# AI 资讯日报 · (\d{4}-\d{2}-\d{2})（(周[一二三四五六日])）/m);
const date = dateMatch ? dateMatch[1] : today;
const weekday = dateMatch ? dateMatch[2] : '';
const footerMatch = md.match(/\*生成时间 (\d{1,2}:\d{2}) · 来源数 (\d+)/);
const genTime = footerMatch ? footerMatch[1] : '';
const srcCount = footerMatch ? footerMatch[2] : '';

// ---------- 分区定义（顺序即页面顺序） ----------
const SECTIONS = [
  { key: 'hot',    id: 'hot',    cls: 's-hot',   emoji: '🔥', name: '头条' },
  { key: 'models', id: 'models', cls: 's-model', emoji: '🧠', name: '模型 & 产品' },
  { key: 'oss',    id: 'oss',    cls: 's-oss',   emoji: '🛠', name: '框架 & 开源项目' },
  { key: 'papers', id: 'papers', cls: 's-paper', emoji: '📄', name: '技术方向 & 论文' },
  { key: 'new',    id: 'new',    cls: 's-new',   emoji: '✨', name: '新品速递' },
  { key: 'biz',    id: 'biz',    cls: 's-biz',   emoji: '🏢', name: '公司 & 融资' },
  { key: 'cn',     id: 'cn',     cls: 's-cn',    emoji: '🇨🇳', name: '国内动态' },
  { key: 'hn',     id: 'hn',     cls: 's-hn',    emoji: '💬', name: '社区热议' },
];

function sectionKeyOf(heading) {
  if (heading.includes('头条')) return 'hot';
  if (heading.includes('模型 & 产品')) return 'models';
  if (heading.includes('框架')) return 'oss';
  if (heading.includes('论文')) return 'papers';
  if (heading.includes('新品')) return 'new';
  if (heading.includes('公司')) return 'biz';
  if (heading.includes('国内')) return 'cn';
  if (heading.includes('社区')) return 'hn';
  return null;
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- 条目解析：- **TITLE** [badge] — desc（sources）[url] ----------
function parseItem(line) {
  const m = line.match(/^-\s*\*\*(.+?)\*\*(.*)$/);
  if (!m) return null;
  let title = m[1];
  let rest = m[2];
  let url = '#';
  const lm = rest.match(/\[[^\]]*\]\((https?:\/\/[^)]+)\)\s*$/);
  if (lm) { url = lm[1]; rest = rest.slice(0, lm.index); }
  let sources = '';
  const sm = rest.match(/（([^）]*)）\s*$/);
  if (sm) { sources = sm[1]; rest = rest.slice(0, sm.index); }
  let badge = '';
  const bm = rest.match(/^（([^）]*)）/);
  if (bm) { badge = bm[1]; rest = rest.slice(bm[0].length); }
  rest = rest.replace(/^\s*—\s*/, '').trim();
  let star = '';
  const st = title.match(/（([\d,]+★)）$/);
  if (st) { star = st[1]; title = title.slice(0, st.index).trim(); }
  return { title, url, sources, badge, star, desc: rest };
}

const items = {};
let current = null;
for (const raw of md.split('\n')) {
  const t = raw.trim();
  if (t.startsWith('## ') || t.startsWith('### ')) {
    current = sectionKeyOf(t);
  } else if (t.startsWith('- ') && current) {
    const it = parseItem(t);
    if (it && it.title) (items[current] = items[current] || []).push(it);
  }
}

// ---------- 卡片与分区 HTML ----------
function paragraphs(desc) {
  const parts = desc.match(/[^。！？]+[。！？]/g) || [desc];
  const p2 = parts.slice(1).join('');
  return p2.trim() ? [parts[0].trim(), p2.trim()] : [parts[0].trim()];
}

function card(it) {
  let chips = '';
  if (it.star) chips += `<span class="chip star">${esc(it.star)}</span>`;
  if (it.badge) chips += `<span class="chip up">${esc(it.badge)}</span>`;
  if (it.sources) chips += `<span class="chip src">${esc(it.sources)}</span>`;
  const ps = paragraphs(it.desc).map(p => `<p>${esc(p)}</p>`).join('');
  return `<article class="card"><div class="head"><a class="t" href="${esc(it.url)}" target="_blank">${esc(it.title)}</a>${chips}</div>${ps}</article>`;
}

function section(sec, list) {
  if (!list || !list.length) return '';
  return `<section id="${sec.id}" class="${sec.cls}">
  <h2 class="sec">${sec.emoji} ${sec.name}<small>${list.length} 条</small></h2>
  <div class="grid">
    ${list.map(card).join('\n    ')}
  </div>
</section>`;
}

const sectionsHtml = SECTIONS.map(s => section(s, items[s.key])).join('\n\n');

// 今日速览：头条 3 + 模型第一条（取前 4）
const tldrItems = [...(items.hot || []), ...(items.models || []).slice(0, 1)].slice(0, 4);
const tldrHtml = `<div class="tldr">
  <h2>⚡ 今日速览</h2>
  <ul>
${tldrItems.map(it => `    <li>${esc(it.title)}</li>`).join('\n')}
  </ul>
</div>`;

const total = SECTIONS.reduce((n, s) => n + (items[s.key] || []).length, 0);
const statsHtml = `<div class="stats">
    <span class="stat">📊 ${total} 条</span><span class="stat">🛰 ${srcCount} 个来源</span><span class="stat">🕙 生成于 ${genTime}</span><span class="stat"><a style="color:#fff;text-decoration:none" href="index.html">🏠 往期归档</a></span>
  </div>`;
const footerHtml = `<footer>AI 资讯日报 · 由 Claude Code 自动生成 · ${total} 条 / ${srcCount} 来源<br><a href="index.html">📅 查看往期归档</a></footer>`;

// ---------- 模板复用（手术式替换） ----------
const templates = fs.readdirSync(htmlDir)
  .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
  .sort();
if (!templates.length) { console.error('html 目录没有可用模板'); process.exit(1); }
const templateFile = templates[templates.length - 1];
let out = fs.readFileSync(path.join(htmlDir, templateFile), 'utf8');

out = out.replace(/<title>[^<]*<\/title>/, `<title>AI 资讯日报 · ${date}</title>`);
out = out.replace(/<div class="date">[^<]*<\/div>/, `<div class="date">${date} · ${weekday}</div>`);
out = out.replace(/<div class="stats">[\s\S]*?<\/div>/, statsHtml);
out = out.replace(/<div class="tldr">[\s\S]*?<\/div>/, tldrHtml);
const sIdx = out.indexOf('<section id="hot"');
const eIdx = out.lastIndexOf('</section>') + '</section>'.length;
if (sIdx < 0 || eIdx < sIdx) { console.error('模板 section 边界未找到'); process.exit(1); }
out = out.slice(0, sIdx) + sectionsHtml + out.slice(eIdx);
out = out.replace(/<footer>[\s\S]*?<\/footer>/, footerHtml);

const outFile = path.join(htmlDir, `${date}.html`);
if (isDry) {
  console.log(`[dry] 模板=${templateFile} 日期=${date}(${weekday}) 生成=${genTime} 来源=${srcCount} 总条数=${total}`);
  for (const s of SECTIONS) console.log(`  ${s.key}: ${(items[s.key] || []).length} 条`);
  console.log('  star:', SECTIONS.flatMap(s => items[s.key] || []).filter(i => i.star).map(i => i.star).join(', '));
  console.log('  badge:', SECTIONS.flatMap(s => items[s.key] || []).filter(i => i.badge).map(i => i.badge).join(' | '));
} else {
  fs.writeFileSync(outFile, out, 'utf8');
  console.log(`written ${outFile} (${out.length} chars, template=${templateFile})`);
  // index.html 归档更新（当天条目已存在则替换内容，不存在则插入到最前）
  const idxFile = path.join(htmlDir, 'index.html');
  if (fs.existsSync(idxFile)) {
    let idx = fs.readFileSync(idxFile, 'utf8');
    const entry = `<a class="day" href="${date}.html"><span class="d">${date}${weekday ? ' · ' + weekday : ''}</span><span class="n">${total} 条 · ${srcCount} 来源</span></a>`;
    const re = new RegExp(`<a class="day" href="${date}\\.html">[\\s\\S]*?</a>`);
    if (re.test(idx)) {
      idx = idx.replace(re, entry);
    } else {
      const pos = idx.indexOf('<a class="day"');
      if (pos < 0) { console.log('index.html: no day list found, skipped'); }
      else idx = idx.slice(0, pos) + entry + '\n' + idx.slice(pos);
    }
    fs.writeFileSync(idxFile, idx, 'utf8');
    console.log('index.html updated');
  }
}
