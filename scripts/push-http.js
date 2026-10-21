// push-http.js — 纯 node 企业微信推送（云端用；本机也可用）
// webhook 来源: env WECOM_WEBHOOK 或 {AI_NEWS_DIR}/webhook.txt
// 行为: 1) 发 markdown（push.md） 2) 上传 html 并发送文件卡片
'use strict';
const fs = require('fs');
const path = require('path');

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const ROOT = process.env.AI_NEWS_DIR || 'D:\\ai-news';

function getWebhook() {
  if (process.env.WECOM_WEBHOOK) return process.env.WECOM_WEBHOOK.trim();
  const f = path.join(ROOT, 'webhook.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  return '';
}

async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (j.errcode && j.errcode !== 0) throw new Error(`wecom errcode=${j.errcode} errmsg=${j.errmsg || ''}`);
  return j;
}

(async () => {
  const webhook = getWebhook();
  if (!webhook) { console.error('push-http: no webhook (env WECOM_WEBHOOK or webhook.txt)'); process.exit(1); }
  const key = (webhook.match(/key=([^&]+)/) || [])[1];
  if (!key) { console.error('push-http: webhook has no key'); process.exit(1); }

  const pushFile = path.join(ROOT, `${today}.push.md`);
  const htmlFile = path.join(ROOT, 'html', `${today}.html`);

  // 1) markdown
  if (fs.existsSync(pushFile)) {
    let content = fs.readFileSync(pushFile, 'utf8');
    while (Buffer.byteLength(content, 'utf8') > 3900) content = content.slice(0, Math.floor(content.length * 0.95));
    await postJSON(webhook, { msgtype: 'markdown', markdown: { content } });
    console.log('push-http: markdown ok');
  } else {
    console.error('push-http: no push.md, skip markdown');
  }

  // 2) html file card
  if (fs.existsSync(htmlFile)) {
    const buf = fs.readFileSync(htmlFile);
    const form = new FormData();
    form.append('media', new Blob([buf], { type: 'text/html' }), `${today}.html`);
    const up = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=${encodeURIComponent(key)}&type=file`, { method: 'POST', body: form });
    const upj = await up.json();
    if (upj.errcode && upj.errcode !== 0) throw new Error(`upload errcode=${upj.errcode} ${upj.errmsg || ''}`);
    await postJSON(webhook, { msgtype: 'file', file: { media_id: upj.media_id } });
    console.log('push-http: file attachment ok');
  } else {
    console.error('push-http: no html, skip attachment');
  }
})().catch(e => { console.error('push-http fatal:', e.message); process.exit(1); });
