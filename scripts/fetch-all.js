// fetch-all.js — 并行抓取 ai-news 全部信源，输出紧凑候选清单（STAGE 1 的采集步骤由它完成）
// 用法: node D:\ai-news\fetch-all.js [--hours 24] [--dry]
// 输出: D:\ai-news\tmp\candidates-YYYY-MM-DD.txt
// 设计: 所有机械抓取/过滤由脚本完成, LLM 只读紧凑清单做筛选去重, 避免大文本进入模型上下文
'use strict';
const fs = require('fs');
const path = require('path');

const pad = n => String(n).padStart(2, '0');
const localNow = new Date();
const localToday = `${localNow.getFullYear()}-${pad(localNow.getMonth() + 1)}-${pad(localNow.getDate())}`;
const localTime = `${pad(localNow.getHours())}:${pad(localNow.getMinutes())}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOURS = parseInt(process.argv.find(a => a.startsWith('--hours'))?.split('=')[1] || '24', 10);
const MAX_AGE_MS = HOURS * 3600 * 1000;
const isDry = process.argv.includes('--dry');

const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';
const OUT_DIR = path.join(ROOT, 'tmp');
const OUT_FILE = path.join(OUT_DIR, `candidates-${localToday}.txt`);

// ---------- 基础抓取 ----------
async function fetchText(url, { timeout = 15000, retries = 1 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' },
      });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
    }
  }
  throw lastErr;
}

const clean = s => (s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

function keep24h(d, now = localNow) {
  if (!d) return true; // 无日期条目保留(多数源只给近期条目, 交给 LLM 判断)
  return (now - d) <= MAX_AGE_MS + 12 * 3600 * 1000; // 留半天余量防时区差
}

// ---------- 各源解析 ----------
function parseRSS(xml) {
  const items = [];
  let re = /<item>([\s\S]*?)<\/item>/g, m;
  while ((m = re.exec(xml))) items.push(m[1]);
  if (!items.length) { re = /<entry>([\s\S]*?)<\/entry>/g; while ((m = re.exec(xml))) items.push(m[1]); }
  return items.map(b => {
    const get = tag => { const mm = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>')); return mm ? clean(mm[1]) : ''; };
    const linkM = b.match(/<link[^>]*href="([^"]+)"/);
    const title = get('title');
    const link = get('link') || (linkM ? linkM[1] : '');
    const pub = get('pubDate') || get('published') || get('updated');
    const desc = (get('description') || get('summary')).replace(/^<[^>]+>|<\/[^>]+>$/g, '');
    return { title, link, pub, desc };
  }).filter(i => i.title && i.link);
}

// OpenAI RSS 标题为空, 从 URL slug 还原标题
function openaiSlugTitle(item) {
  if (item.title) return item;
  const seg = (item.link.split('/').filter(Boolean).pop() || '')
    .split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
  item.title = seg || '(title from slug failed)';
  return item;
}

function parseHN(json) {
  try {
    const j = JSON.parse(json);
    return (j.hits || []).map(h => ({
      title: clean(h.title), link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      pub: h.created_at, desc: `${h.points ?? 0} 分 · ${h.num_comments ?? 0} 评论`, pts: h.points ?? 0,
    }));
  } catch { return []; }
}

function parseGH(json) {
  try {
    const j = JSON.parse(json);
    return (j.items || []).map(r => ({
      title: clean(r.full_name), link: r.html_url, pub: r.created_at,
      desc: `${r.stargazers_count}★ · ${clean(r.description)}`,
    }));
  } catch { return []; }
}

// skills.sh Trending(24h) 榜：转文本后每 4 行一组（排名/技能名/owner-repo/安装量）
function parseSkills(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, '\n').replace(/&[a-z#0-9]+;/g, ' ').replace(/\n{2,}/g, '\n');
  const ti = text.indexOf('Trending (24h)');
  const seg = ti >= 0 ? text.slice(ti, ti + 3500) : text;
  const out = [];
  const re = /^\s*(\d+)\s*\n([\w-]+)\n([\w./-]+)\n([\d.]+[KM]?)/gm;
  let m;
  while ((m = re.exec(seg))) out.push({ title: m[2], link: 'https://skills.sh', pub: '', desc: `${m[4]} installs · ${m[3]}` });
  return out.slice(0, 20);
}

function parseAnthropic(html) {
  const out = [];
  const re = /<a[^>]+href="(\/news\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const title = clean(m[2]);
    if (title && title.length > 3 && title.length < 120) out.push({ title, link: 'https://www.anthropic.com' + m[1], pub: '', desc: '' });
  }
  return out.slice(0, 10);
}

const createdFrom = new Date(localNow.getTime() - 3 * DAY_MS).toISOString().slice(0, 10);
// 年度高星榜窗口：近 365 天创建（覆盖「慢热型超级热门仓」，如 REA 半年涨到 10 万★但从未上新闻流）
const yearAgo = new Date(localNow.getTime() - 365 * DAY_MS).toISOString().slice(0, 10);

// ---------- 信源表 ----------
const SOURCES = [
  { name: 'OpenAI RSS', url: 'https://openai.com/news/rss.xml', parse: parseRSS, post: openaiSlugTitle },
  { name: 'Anthropic 新闻页', url: 'https://www.anthropic.com/news', parse: parseAnthropic },
  { name: 'Apple Newsroom', url: 'https://www.apple.com/newsroom/rss-feed.rss', parse: parseRSS },
  { name: 'AIHOT 聚合', url: 'https://aihot.virxact.com/feed.xml', parse: parseRSS },
  { name: '量子位', url: 'https://www.qbitai.com/feed', parse: parseRSS },
  { name: 'IT之家', url: 'https://www.ithome.com/rss/', parse: parseRSS },
  { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', parse: parseRSS },
  { name: 'The Verge AI', url: 'https://theverge.com/rss/ai-artificial-intelligence/index.xml', parse: parseRSS },
  { name: 'TechFundingNews AI', url: 'https://techfundingnews.com/category/ai/feed/', parse: parseRSS },
  { name: 'GitHub Blog AI', url: 'https://github.blog/ai-and-ml/feed/', parse: parseRSS },
  { name: 'arXiv cs.AI', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=20', parse: parseRSS },
  { name: 'HN AI', url: 'https://hn.algolia.com/api/v1/search_by_date?query=AI&tags=story&hitsPerPage=30&restrictSearchableAttributes=title', parse: parseHN, sorter: (a, b) => (b.pts || 0) - (a.pts || 0) },
  { name: 'HN Show HN', url: 'https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=30&restrictSearchableAttributes=title', parse: parseHN, sorter: (a, b) => (b.pts || 0) - (a.pts || 0) },
  { name: 'skills.sh 榜', url: 'https://skills.sh', parse: parseSkills },
  { name: 'GitHub 新星', url: `https://api.github.com/search/repositories?q=created:%3E${createdFrom}&sort=stars&order=desc&per_page=8`, parse: parseGH },
  { name: 'GitHub 年度高星', url: `https://api.github.com/search/repositories?q=created:%3E${yearAgo}+stars:%3E20000&sort=stars&order=desc&per_page=15`, parse: parseGH, noDateFilter: true },
  { name: 'GitHub org:openai', url: 'https://api.github.com/search/repositories?q=org:openai&sort=updated&order=desc&per_page=8', parse: parseGH },
];

// ---------- 并发抓取 ----------
async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const start = Date.now();
  const results = await Promise.allSettled(SOURCES.map(async src => {
    const text = await fetchText(src.url);
    const items = (src.parse(text) || []).map(i => {
      if (src.post) i = src.post(i);
      const d = parseDate(i.pub);
      return { ...i, d, keep: src.noDateFilter ? true : keep24h(d) };
    });
    return { src: src.name, items };
  }));

  const ok = [], fail = [];
  const lines = [`# AI 资讯候选清单 · ${localToday} ${localTime}（最近 ${HOURS} 小时）`, ''];
  let keptTotal = 0;

  for (const [i, r] of results.entries()) {
    const name = SOURCES[i].name;
    if (r.status === 'fulfilled') {
      ok.push(name);
      let kept = r.value.items.filter(i => i.keep);
      if (SOURCES[i].sorter) kept = kept.slice().sort(SOURCES[i].sorter);
      kept = kept.slice(0, 30);
      const dropped = r.value.items.length - kept.length;
      keptTotal += kept.length;
      lines.push(`## ${name}（${kept.length} 条${dropped ? `，已滤旧 ${dropped}` : ''}）`);
      for (const it of kept) {
        const when = it.d ? `${pad(it.d.getMonth() + 1)}-${pad(it.d.getDate())} ${pad(it.d.getHours())}:${pad(it.d.getMinutes())}` : '--';
        lines.push(`- ${when} | ${clean(it.title).slice(0, 90)} | ${it.link}${it.desc ? ' | ' + clean(it.desc).slice(0, 110) : ''}`);
      }
      lines.push('');
    } else {
      fail.push(`${name}（${r.reason && r.reason.message ? r.reason.message : r.reason}）`);
    }
  }

  const head = [
    `抓取耗时 ${((Date.now() - start) / 1000).toFixed(1)}s · 成功源 ${ok.length}/${SOURCES.length} · 候选 ${keptTotal} 条`,
    `成功源: ${ok.join('、')}`,
    fail.length ? `失败源(可用 WebSearch 补): ${fail.join('；')}` : '全部源抓取成功',
    '',
  ];
  const out = head.concat(lines).join('\n');
  if (isDry) { console.log(out.slice(0, 2500)); return; }
  fs.writeFileSync(OUT_FILE, out, 'utf8');
  console.log(`written ${OUT_FILE} (${out.length} chars, ${keptTotal} candidates, ${ok.length}/${SOURCES.length} sources, ${((Date.now() - start) / 1000).toFixed(1)}s)`);
}

run().catch(e => { console.error('fatal:', e); process.exit(1); });
