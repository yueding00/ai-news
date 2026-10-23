// run-daily.js — 完整日报流水线（纯 node，替代 run.cmd 里的批处理逻辑）
// 由 run.cmd 调用: node D:\ai-news\run-daily.js >> D:\ai-news\run.log 2>&1
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const stamp = `${today} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
const log = (...a) => console.log(`[${stamp}]`, ...a);

function fail(msg) { log('FAILED:', msg); process.exit(1); }

log('run start');

// ---- dedupe: today already pushed? ----
const pushLogFile = path.join(ROOT, 'push.log');
if (fs.existsSync(pushLogFile)) {
  const pushLog = fs.readFileSync(pushLogFile, 'utf8');
  const already = pushLog.split('\n').some(l => l.includes(today) && l.includes('push ok'));
  if (already) { log('run skip (already pushed today)'); process.exit(0); }
}

const steps = [
  ['fetch-all', 'fetch-all.js', 300000],
  ['generate', 'generate.js', 900000],
  ['push-version', 'generate-push-rule.js', 120000],
  ['html', 'md2html.js', 120000],
];

for (const [name, file, timeout] of steps) {
  log(`step ${name} start`);
  try {
    execFileSync(process.execPath, [path.join(ROOT, file)], { stdio: 'inherit', timeout, cwd: ROOT });
  } catch (e) {
    fail(`step ${name} exited: ${e.message}`);
  }
  log(`step ${name} ok`);
}

if (!fs.existsSync(path.join(ROOT, `${today}.md`))) fail('no digest md');
if (!fs.existsSync(path.join(ROOT, `${today}.push.md`))) fail('no push md');

log('step push start');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'push-http.js')], { stdio: 'inherit', timeout: 180000, cwd: ROOT });
} catch (e) {
  fail(`push exited: ${e.message}`);
}
log('step push ok');

// ---- verify push.log now has today ----
const after = fs.existsSync(pushLogFile) ? fs.readFileSync(pushLogFile, 'utf8') : '';
if (!after.split('\n').some(l => l.includes(today) && l.includes('push ok'))) fail('push.log missing today record');

log('run end (exit 0)');
