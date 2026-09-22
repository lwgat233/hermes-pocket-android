/* 设备端复验台：连**真机 WebView** 的 CDP（adb forward tcp:9222 → webview_devtools_remote_<pid>）。
 * 为什么不用 playwright 的 connectOverCDP：Android WebView 的 CDP 不支持 Browser 级命令
 *   （报 "Browser.setDownloadBehavior: Browser context management is not supported"），所以这里直接走
 *   页面级 WebSocket + 手写最小 CDP 调用（只用 Runtime.evaluate / Runtime.enable）。
 *
 * 用法： node dev-probe.mjs <驱动.mjs>
 *   驱动默认导出 { name, check: async (page) => ({...}) }，page 提供 evaluate / waitForTimeout / reload。
 */
import { pathToFileURL } from 'url';
import path from 'path';

const DRIVER = process.argv[2];
if (!DRIVER) { console.error('用法: node dev-probe.mjs <驱动.mjs>'); process.exit(2); }

const tabs = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const targetPage = tabs.find((t) => t.type === 'page' && /appassets|index\.html/.test(t.url));
if (!targetPage) { console.error('没找到 App 页面，现有:', tabs.map((t) => t.url)); process.exit(3); }
console.error('# 连上设备页面:', targetPage.url, '|', targetPage.title);

const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws 连不上: ' + (e.message || ''))); });

let seq = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = (ev) => {
  let m;
  try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch (e) { return; }
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    pageErrors.push('未捕获异常: ' + (m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || '').slice(0, 300));
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push('console.error: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 250));
  }
};
const call = (method, params) => {
  const id = ++seq;
  const timeoutSuffix = ' 超时';
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(method + timeoutSuffix)); }, 60000);
    pending.set(id, (m) => { clearTimeout(t); res(m); });
    ws.send(JSON.stringify({ id, method, params }));
  }).then((m) => {
    if (m.error) throw new Error(method + ' → ' + JSON.stringify(m.error).slice(0, 300));
    return m.result;
  });
};

await call('Runtime.enable');
await call('Page.enable');

const page = {
  /** 在真页面里求值：fn 会被序列化后带参数调用；返回值按值带回 */
  evaluate: async (fn, arg) => {
    const expression = '(' + fn.toString() + ')(' + (arg === undefined ? '' : JSON.stringify(arg)) + ')';
    const r = await call('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true, userGesture: true, timeout: 55000 });
    if (r.exceptionDetails) throw new Error('页面里抛错: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text || '').slice(0, 400));
    return r.result.value;
  },
  waitForTimeout: (ms) => new Promise((r) => setTimeout(r, ms)),
  /** 真·触摸一点（坐标是页面 CSS 像素；交给浏览器映射，不用自己算状态栏偏移） */
  tap: async (x, y) => {
    const pt = [{ x: Math.round(x), y: Math.round(y), radiusX: 8, radiusY: 8, force: 1 }];
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await new Promise((r) => setTimeout(r, 60));
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  },
  /** 真·鼠标点（同样的坐标体系） */
  clickAt: async (x, y) => {
    const point = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
    await call('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, point));
    await call('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, point));
  },
  reload: async () => { await call('Page.reload', { ignoreCache: false }); await new Promise((r) => setTimeout(r, 2500)); },
  /**
   * 真·滑动：走 CDP 的手势管线（Input.synthesizeScrollGesture）。
   * 为什么不用 dispatchTouchEvent 发 touchMove —— 实测在 Android WebView 上 touchMove 送不进页面（拖了 viewportY 一动不动），
   * 而 tap（touchStart+touchEnd）是好的；手势管线才是"真手指滑动"的那条路。
   */
  swipe: async (x, y, dy, speed = 800) => {
    await call('Input.synthesizeScrollGesture', {
      x: Math.round(x), y: Math.round(y),
      xDistance: 0, yDistance: Math.round(dy),
      speed, gestureSourceType: 'touch', repeatCount: 0
    });
  },
  /** 真·拖动（一根手指）：按下 → 分步移动 → 抬起。用页面坐标。 */
  drag: async (x0, y0, x1, y1, steps = 8) => {
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 8, radiusY: 8, force: 1 }];
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
    for (let i = 1; i <= steps; i += 1) {
      await new Promise((r) => setTimeout(r, 40));
      await call('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pt(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps)
      });
    }
    await new Promise((r) => setTimeout(r, 40));
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
};

const driver = (await import(pathToFileURL(path.resolve(DRIVER)).href)).default;
const result = {};
try {
  result[driver.name] = { check: await driver.check(page) };
} catch (e) {
  result[driver.name] = { error: String((e && e.stack) || e).slice(0, 900) };
}
if (pageErrors.length) result.pageErrors = [...new Set(pageErrors)].slice(0, 20);
console.log(JSON.stringify(result, null, 2));
ws.close();
