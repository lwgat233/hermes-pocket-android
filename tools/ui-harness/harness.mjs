/* Hermes Pocket — WebView 界面本地测试台（Chromium + 假原生桥）
 * ===========================================================================
 * 目的：在**不上模拟器**的情况下快速迭代渲染层（字号/滚动/抽屉/列表行），
 *       读的是真实 DOM 与 xterm 内部状态，不是"看着像"。
 *
 * 用法：  node harness.mjs <driver.mjs>
 *   driver.mjs 默认导出 { name, boot?: fn(page), set?: fn(page), afterReload?: fn(page) }
 *              set 跑完会自动 reload 一次页面，再跑 afterReload（用来验"设置存不存得住"）。
 * 浏览器：/vol1/1000/aicache/cache/ms-playwright/chromium-1234（本地，不联网）。
 * 注意：本地 Chromium 与 Android WebView 的**字体度量**不同（那里是 Roboto/Noto），
 *       所以"列数=多少"这类数字不能跨环境比；能比的是"设置生效了没有 / 存住了没有"。
 */
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import path from 'path';

const require = createRequire('/vol1/1000/aicache/npm/_npx/e41f203b7505f1fb/node_modules/');
const { chromium } = require('playwright');

const CHROME = '/vol1/1000/aicache/cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const UI = '/home/lwgat/hermes-pocket/app/src/main/assets/ui/index.html';
const DRIVER = process.argv[2];
if (!DRIVER) { console.error('用法: node harness.mjs <driver.mjs>'); process.exit(2); }

/* 假原生桥：只实现界面用到的那些 op；pref.* 落到 localStorage，模拟原生 Store 的持久化 */
const BRIDGE = `
(() => {
  const LS = '__stub_prefs';
  const prefs = JSON.parse(localStorage.getItem(LS) || '{}');
  const hosts = JSON.parse(localStorage.getItem('__stub_hosts') || 'null') || [{
    id: 'h1', name: '测试主机', host: '127.0.0.1', port: 22, user: 'lwgat',
    auth: 'key', keyId: 'k1', keyName: 'id_ed25519',
    startCmd: "tmux new -As hermes 'hermes --tui'", autoReconnect: true, keepalive: 30
  }];
  localStorage.setItem('__stub_hosts', JSON.stringify(hosts));
  window.HermesPocket = { postMessage: (t) => { try { route(JSON.parse(t)); } catch (e) { console.error('bridge', e); } } };
  const reply = (o) => {
    const s = JSON.stringify(o);
    const wm = window.HermesPocket;
    if (wm && typeof wm.onmessage === 'function') wm.onmessage({ data: s });
    else if (window.HP && HP.recv) HP.recv(s);
  };
  /* 记录每一次请求（验收要读"哪几个 op 被调了几次"）：window.__calls[name] = 次数 */
  window.__calls = {};
  window.__count = (name) => { window.__calls[name] = (window.__calls[name] || 0) + 1; };
  /* 推一条原生事件（hostkey / state / metrics …） */
  window.__push = (o) => reply(o);
  const ok = (rid, data) => reply({ t: 'res', _rid: rid, ok: true, data });
  const err = (rid, msg) => reply({ t: 'err', _rid: rid, msg });
  window.__ev = (o) => reply(o);                       // 驱动脚本用来推事件
  window.__feed = (text) => {
    const b64 = HP.b64encode(HP.enc.encode(text));
    reply({ t: 'data', data: b64, seq: (window.__seq = (window.__seq || 0) + 1) });
  };
  window.__prefs = prefs;
  function route(m) {
    const rid = m._rid;
    if (m.t) window.__count(m.t);
    switch (m.t) {
      case 'hello': return ok(rid, { proto: 1 });
      case 'pref.all': return ok(rid, prefs);
      case 'pref.set': prefs[m.k] = m.v; localStorage.setItem(LS, JSON.stringify(prefs)); return ok(rid, { ok: true });
      case 'host.list': return ok(rid, hosts);
      case 'host.save': {
        const h = m.host || {};
        const i = hosts.findIndex((x) => x.id === h.id);
        if (i >= 0) hosts[i] = h; else if (h.id) hosts.push(h);
        localStorage.setItem('__stub_hosts', JSON.stringify(hosts));
        return ok(rid, { ok: true });
      }
      case 'key.list': return ok(rid, []);
      case 'session.open': reply({ t: 'state', state: 'connected', msg: '' }); return ok(rid, { sessionId: 's1' });
      case 'session.write': return ok(rid, { ok: true });
      case 'session.resize': return ok(rid, { ok: true });
      case 'session.since': return ok(rid, { chunks: [] });
      case 'session.spill': return ok(rid, { chunks: [] });
      case 'session.kick': case 'ping': case 'events.stop': return ok(rid, {});
      case 'app.configure': return ok(rid, { ok: true });
      case 'app.notification.state': return ok(rid, { granted: true, foreground: true });
      case 'app.power.state': return ok(rid, { save: false, state: '正常' });
      case 'hermes.info': return ok(rid, { home: '/home/lwgat/.hermes', count: 2, userLimit: 1375, memoryLimit: 2200,
        skills: [{ name: 'demo-skill', category: 'test', rel: 'test/demo-skill/SKILL.md', path: 'test/demo-skill/SKILL.md', desc: '演示用', size: 1234 }] });
      case 'hermes.memory': return ok(rid, { user: '用户档案', memory: '笔记', userChars: 4, memoryChars: 2 });
      case 'hermes.read': return ok(rid, { content: '# demo skill\\n正文' });
      // 装公钥：默认"装好了且验证通过"（验收要数"连接几次调了几次这个 op"）
      case 'key.install': return ok(rid, { ok: true, added: true, already: false, verified: true, msg: '公钥已装好并验证通过' });
      // 系统提示词：驱动脚本用 window.__promptText / window.__promptErr 控制"远端有什么"
      case 'hermes.prompt': {
        if (window.__promptErr) return ok(rid, { raw: '@@ERR 打不开 state.db: no such file or directory' });
        const full = window.__promptText !== undefined ? window.__promptText
          : ('You are Hermes Agent, built by Nous Research. Be direct.\\n' + '提示词正文行\\n'.repeat(200));
        const off = m.offset || 1, n = m.chars || 1200;
        return ok(rid, {
          raw: '@@STAT 20|21891|17658\\n@@HASH 84bab0584d4b\\n@@TOTAL ' + full.length +
            '\\n@@HEAD ' + full.split('\\n')[0].slice(0, 120) + '\\n@@TEXT\\n' + full.slice(off - 1, off - 1 + n)
        });
      }
      case 'tmux.list': return ok(rid, { raw: (window.__tmuxRaw !== undefined ? window.__tmuxRaw : window.__tmuxDefault), at: Date.now() });
      default: return ok(rid, {});
    }
  }
})();
`;

const driver = (await import(pathToFileURL(path.resolve(DRIVER)).href)).default;
const results = {};

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--font-render-hinting=none']
});
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1.5 });
page.on('console', (m) => { if (process.env.HP_DEBUG) console.log('  [page]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e && e.stack || e).slice(0, 600)));
await page.addInitScript(BRIDGE);

async function open() {
  await page.goto('file://' + UI);
  await page.waitForFunction(() => window.HP && HP.App && HP.App.term && HP.Panels && HP.Panels.prefs !== null, null, { timeout: 20000 });
  await page.waitForTimeout(400);   // 让 boot 后半段（applySettings/resetGeometry）跑完
}

try {
  await open();
  if (driver.boot) results.boot = await driver.boot(page);
  if (driver.set) {
    results.set = await driver.set(page);
    await page.reload();
    await page.waitForFunction(() => window.HP && HP.App && HP.App.term, null, { timeout: 20000 });
    await page.waitForTimeout(500);
    if (driver.afterReload) results.afterReload = await driver.afterReload(page);
  } else if (driver.check) {
    results.check = await driver.check(page);
  }
} catch (e) {
  results.error = String(e && e.stack || e);
} finally {
  console.log(JSON.stringify({ name: driver.name || path.basename(DRIVER), result: results }, null, 2));
  await browser.close();
}
