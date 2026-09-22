#!/usr/bin/env node
/**
 * Hermes Pocket — 屏幕重绘取证
 *
 * 「界面到底有没有跟着 SSH 刷新」这种问题，光读 buffer 是证明不了的：
 * xterm 可能把数据写进了缓冲但屏幕没重绘（渲染器卡住、WebGL 上下文丢失等）。
 * 这里直接让 WebView 截图，对每张图取 sha256 —— 图变了就是真的重绘了。
 *
 * 用法:
 *   node tools/screendiff.mjs --n 6 --gap 1000 [--save /tmp/hpk-shots]
 */
import WebSocket from '../bridge/node_modules/ws/index.js';
import crypto from 'node:crypto';
import fs from 'node:fs';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = parseInt(get('--port', '9222'), 10);
const N = parseInt(get('--n', '6'), 10);
const GAP = parseInt(get('--gap', '1000'), 10);
const SAVE = get('--save', null);
const LABEL = get('--label', '');

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page') || list[0];
if (!page) { console.error('没有可用的 CDP target'); process.exit(3); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
await new Promise((r) => ws.on('open', r));

if (SAVE) fs.mkdirSync(SAVE, { recursive: true });
console.log(`# 截图取证 ${LABEL}  共 ${N} 张，间隔 ${GAP}ms`);
const hashes = [];
for (let i = 0; i < N; i++) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(r.data, 'base64');
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  hashes.push(h);
  const file = SAVE ? `${SAVE}/shot-${i}.png` : null;
  if (file) fs.writeFileSync(file, buf);
  console.log(`  [${String(i).padStart(2)}] sha256=${h.slice(0, 16)}  ${buf.length} bytes${file ? '  ' + file : ''}`);
  if (i < N - 1) await new Promise((r) => setTimeout(r, GAP));
}
const uniq = new Set(hashes).size;
console.log(`\n  不同截图数 = ${uniq}/${N}  →  ${uniq >= Math.ceil(N / 2) ? '屏幕确实在跟着刷新' : '屏幕基本没变（没刷新）'}`);
const adjacent = hashes.filter((h, i) => i > 0 && h !== hashes[i - 1]).length;
console.log(`  相邻两张有变化的次数 = ${adjacent}/${N - 1}`);
ws.close();
process.exit(0);
