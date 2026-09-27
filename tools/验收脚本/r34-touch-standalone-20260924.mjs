/* R-34 复测 · 真触摸段（独立脚本，避免驱动里"上一张窗还开着/页面刚 reload"污染命中）：
 *   ① 频道页点角色卡 → 信息窗真开（adb shell input tap，系统触摸）
 *   ② ✕ 真触摸关窗
 *   ③ 单聊点消息头 → 信息窗（有频道 qqbot / 无频道 未接）
 * 用法： node /vol1/1000/airesults/hermes-pocket/tools/验收脚本/r34-touch-standalone-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const target = list.find((t) => t.type === 'page' && /appassets/.test(t.url));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (method, params) => new Promise((res) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); const rr = r.result || {}; if (rr.exceptionDetails) return { __err: (rr.exceptionDetails.exception || {}).description || rr.exceptionDetails.text }; return rr.result ? rr.result.value : undefined; };
await call('Runtime.enable', {});
await call('Page.enable', {});
await call('Page.reload', {});
await new Promise((r) => setTimeout(r, 2500));

const stubs = `HP.App.rpc = async (op) => {
  if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
    { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', pending: 0, channels: ['qqbot'] },
    { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', pending: 0, channels: [] },
    { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', pending: 0, channels: [] },
    { full_name: 'owner.me', title: '我（经理）', online: true, state: 'running', pending: 0, channels: [] },
    { full_name: 'home.maid', title: '可爱女仆', online: false, state: 'paused', pending: 0, channels: [] }] }], channels: { qqbot: 1, wechat: 1 } };
  if (op === 'talk.since') return { messages: [], last: 0 };
  if (op === 'talk.asks') return { count: 0, asks: [] };
  if (op === 'talk.thread') return { items: [{ who: 'role', body: '他说的第一句', at: 1790200000 }, { who: 'me', body: '我说的', at: 1790200100 }, { who: 'role', body: '他说的第二句', at: 1790200200 }] };
  if (op === 'talk.sessions') return { sessions: [] };
  if (op === 'talk.deliveries') return { items: [] };
  return {};
};`;
await ev(stubs);

/* 地址→设备像素 */
const dev = (px, py) => ({ x: Math.round(px * (1080 / 393)), y: Math.round(136 + py * (2138 / 778)) });

/* ① 频道页：卡坐标 + 真触摸开窗 */
const ch = await ev(`(async () => {
  HP.App.sessionId='probe'; HP.App.state='connected';
  HP.App.showBoard('talk'); HP.Talk.tab='channel'; HP.Talk.view='channel';
  await new Promise(r=>setTimeout(r,2500));
  const cards=[...document.querySelectorAll('#tab-talk [data-testid="talk-role"]')].map(c=>{const r=c.getBoundingClientRect();const ch2=c.querySelector('[data-testid="talk-rolechans"]');return {role:c.getAttribute('data-role'),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),chan:ch2?ch2.textContent.trim():null};});
  window.__cards=cards; return cards;
})()`);
const out = { cards: ch, taps: {} };
const author = ch.find((c) => c.role === 'pipeline.author');
const p1 = dev(author.x + author.w / 2, author.y + author.h / 2);
tap(p1.x, p1.y);
for (const ms of [300, 800]) {
  await new Promise((r) => setTimeout(r, ms === 300 ? 300 : 500));
  out.taps['card+' + ms] = await ev(`(() => { const c=document.querySelector('.tk-sheetcard'); if(!c) return {sheet:false};
    const rows=[...c.querySelectorAll('.tk-sheetrow')].map(d=>({k:(d.querySelector('.tk-k')||{}).textContent,v:(d.querySelector('.tk-v')||{}).textContent}));
    return {sheet:true, head:(c.querySelector('.tk-sheethead .name')||{}).textContent, chanRow: rows.find(r=>r.k==='接入频道')||null, keys: rows.map(r=>r.k)}; })()`);
}
/* ② ✕ 真触摸关窗 */
const xb = await ev(`(() => { const x=document.getElementById('tk-sheetx'); if(!x) return null; const r=x.getBoundingClientRect(); return {cx:r.x+r.width/2, cy:r.y+r.height/2}; })()`);
if (xb) { const p = dev(xb.cx, xb.cy); tap(p.x, p.y); await new Promise((r) => setTimeout(r, 700)); }
out.taps.afterClose = await ev(`({ sheet: !!document.querySelector('#tk-sheet') })`);

/* ③ 单聊点消息头（有频道 / 无频道） */
for (const role of ['pipeline.author', 'pipeline.tester']) {
  await ev(`(async () => { try{HP.Talk.closeSheet();}catch(e){} HP.Talk.tab='channel'; await HP.Talk.openRole('${role}'); await new Promise(r=>setTimeout(r,1500)); })()`);
  const b = await ev(`(() => { const bub=document.querySelector('#tk-chat .tk-bub'); if(!bub) return null; const r=bub.getBoundingClientRect(); return {cx:r.x+r.width/2, cy:r.y+16, bubbles: document.querySelectorAll('#tk-chat .tk-bub').length}; })()`);
  if (!b) { out.taps[role] = { error: 'no bubble' }; continue; }
  const pb = dev(b.cx, b.cy);
  tap(pb.x, pb.y);
  await new Promise((r) => setTimeout(r, 1000));
  out.taps[role] = await ev(`(() => { const c=document.querySelector('.tk-sheetcard'); if(!c) return {sheet:false};
    const rows=[...c.querySelectorAll('.tk-sheetrow')].map(d=>({k:(d.querySelector('.tk-k')||{}).textContent,v:(d.querySelector('.tk-v')||{}).textContent}));
    return {sheet:true, head:(c.querySelector('.tk-sheethead .name')||{}).textContent, chanRow: rows.find(r=>r.k==='接入频道')||null, oldKey: rows.some(r=>/能接入/.test(String(r.k))), labelRow: rows.find(r=>r.k==='标签')||null}; })()`);
}
console.log(JSON.stringify(out));
ws.close();
process.exit(0);
