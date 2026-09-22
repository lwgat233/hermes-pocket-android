#!/usr/bin/env node
/**
 * Hermes Pocket — WebView CDP 探针
 *
 * debug 构件的 WebView 会开出 devtools socket（webview_devtools_remote_<pid>），
 * `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 之后就能用
 * 标准 CDP 直接读**真实 App 里**的页面状态 —— 比截图可靠（也绕开了「这个模型看不了图」）。
 *
 * 用法:
 *   node tools/cdp.mjs --expr "document.title"
 *   node tools/cdp.mjs --file /tmp/probe.js --timeout 15000
 *   node tools/cdp.mjs --expr "HP.App.state" --logs     # 同时打印控制台/异常
 */
import WebSocket from '../bridge/node_modules/ws/index.js';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = parseInt(get('--port', '9222'), 10);
const TIMEOUT = parseInt(get('--timeout', '20000'), 10);
const wantLogs = args.includes('--logs');

let expr = get('--expr', null);
const file = get('--file', null);
if (file) {
  const fs = await import('node:fs');
  expr = fs.readFileSync(file, 'utf8');
}
if (!expr && !get('--script', null)) { console.error('需要 --expr 或 --file 或 --script'); process.exit(2); }

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === 'page') || list[0];
if (!page) { console.error('没有可用的 CDP target:', JSON.stringify(list)); process.exit(3); }
console.error(`[cdp] target: ${page.title || '(no title)'}  url=${page.url}`);

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
let seq = 0;
const pending = new Map();
const logs = [];

const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq;
  pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params }));
});

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    return;
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push('console.' + m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('EXCEPTION: ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Log.entryAdded') {
    logs.push('log[' + m.params.entry.level + ']: ' + m.params.entry.text);
  }
});

await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
const timer = setTimeout(() => { console.error('[cdp] 超时'); process.exit(4); }, TIMEOUT);

await send('Runtime.enable').catch(() => {});
await send('Log.enable').catch(() => {});

/* ---- 脚本模式：按顺序执行 eval / 真实输入事件，用来验证「点得动点不动」这类问题 ----
   合成 DOM 事件绕不过命中测试，所以必须用 CDP 的 Input 域发真事件。 */
const scriptFile = get('--script', null);
if (scriptFile) {
  const fs = await import('node:fs');
  const steps = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
  const results = [];
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
    return r.result?.value;
  };
  const rectOf = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),w:Math.round(r.width),h:Math.round(r.height),text:(e.textContent||'').trim().slice(0,26),shown:!!(r.width&&r.height)};})()`);

  for (const st of steps) {
    try {
      if (st.eval !== undefined) {
        results.push({ eval: String(st.eval).replace(/\s+/g, ' ').slice(0, 70), value: await ev(st.eval) });
      } else if (st.cdp) {
        results.push({ cdp: st.cdp, result: await send(st.cdp, st.params || {}) });
      } else if (st.sleep) {
        await new Promise((r) => setTimeout(r, st.sleep));
        results.push({ sleep: st.sleep });
      } else if (st.tap || st.longPress) {
        const sel = st.tap || st.longPress;
        // 支持两种写法：
        //   {"tap": "#some-selector"}             —— 按选择器找元素（推荐）
        //   {"tap": {"x": 28, "y": 708}}          —— 直接给坐标
        // ⚠ 以前只认选择器，传坐标对象时会**静默跳过**（记一条 err 就往下走），
        //   于是"真实点击"什么都没点，看起来像"应用没反应"——白排查了好几轮。
        let box;
        if (sel && typeof sel === 'object' && typeof sel.x === 'number') {
          box = { x: sel.x, y: sel.y, text: '(坐标)', shown: true };
        } else {
          box = await rectOf(sel);
        }
        if (!box || !box.shown) {
          results.push({ tap: sel, err: '元素不可见或不存在', box });
          throw new Error('tap 目标不可见或不存在: ' + JSON.stringify(sel));
        }
        const touch = st.touch !== false;
        if (touch && !st.longPress) {
          // 注意：Input.dispatchTouchEvent 只送 pointer 事件，**不合成 click**
          // （实测：touch 点击后 click 计数为 0，鼠标为 1）。要验证「点得动点不动」
          // 必须用 synthesizeTapGesture，它才产生完整的 tap→click 序列。
          await send('Input.synthesizeTapGesture', {
            'x': : box.x, y: box.y, duration: st.ms || 60, tapCount: 1, gestureSourceType: 'touch'
          });
          results.push({ tapGesture: sel, at: { x: box.x, y: box.y }, text: box.text });
          continue;
        }
        const press = async () => touch
          ? send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] })
          : send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        const release = async () => touch
          ? send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          : send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        await press();
        if (st.longPress) await new Promise((r) => setTimeout(r, st.ms || 700));
        await release();
        results.push({ tapped: sel, at: { x: box.x, y: box.y }, text: box.text, touch, hold: st.longPress ? (st.ms || 700) : 0 });
      }
    } catch (e) { results.push({ step: JSON.stringify(st).slice(0, 60), error: String(e.message) }); }
  }
  console.log(JSON.stringify(results, null, 1));
  ws.close();
  process.exit(0);
}

let out;
try {
  const r = await send('Runtime.evaluate', {
    'expression': : expr, returnByValue: true, awaitPromise: true, allowUnsafeEvalBlockedByCSP: false
  });
  if (r.exceptionDetails) {
    out = { ok: false, error: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  } else {
    out = { ok: true, value: r.result?.value };
  }
} catch (e) { out = { ok: false, error: String(e.message) }; }

clearTimeout(timer);
console.log(JSON.stringify(out, null, 2));
if (wantLogs || !out.ok) {
  if (logs.length) { console.error('--- 页面控制台/异常 ---'); logs.forEach((l) => console.error('  ' + l)); }
}
ws.close();
process.exit(out.ok ? 0 : 1);
