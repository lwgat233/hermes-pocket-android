/* 测试轮用：直连设备 WebView 页面级 CDP，求值一条 JS 并把结果/异常打回来（真机读数，不是看界面像不像）。
 * 用法： node panel-live.mjs '<js 表达式>'        （需先 adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>）
 * 输出： {"ok":true,"value":...} 或 {"ok":false,"error":...}；捕获到的未捕获异常一并打印到 stderr。
 */
const EXPR = process.argv[2];
if (!EXPR) { console.error('用法: node panel-live.mjs "<js 表达式>"'); process.exit(2); }

const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const tab = list.find((t) => t.type === 'page' && /appassets|index\.html/.test(t.url));
if (!tab) { console.error('没找到 App 页面，现有: ' + JSON.stringify(list.map((t) => t.url))); process.exit(3); }

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws 连不上: ' + (e.message || ''))); });

let seq = 0;
const pending = new Map();
const exceptions = [];
ws.onmessage = (ev) => {
  let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown');
  }
};
const call = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

await call('Runtime.enable', {});
const r = await call('Runtime.evaluate', { expression: EXPR, awaitPromise: true, returnByValue: true, userGesture: true });
const res = r.result || {};
let out;
if (res.exceptionDetails) {
  const d = res.exceptionDetails;
  out = { ok: false, error: (d.exception && (d.exception.description || d.exception.value)) || d.text };
} else {
  out = { ok: true, value: res.result ? res.result.value : undefined };
}
console.log(JSON.stringify(out));
if (exceptions.length) console.error('未捕获异常: ' + JSON.stringify(exceptions));
ws.close();
process.exit(out.ok ? 0 : 1);
