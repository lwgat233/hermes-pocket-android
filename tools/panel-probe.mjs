/* 本地跑 pocket 面板 JS，抓运行时报错（不改产品代码，纯诊断）
   node tools/panel-probe.mjs
   模拟：点角色 → 信息窗 → 点「跟他对话」→ 看是否抛异常、渲染出什么 */
import fs from 'node:fs';
import path from 'node:path';

const UI = process.argv[2] || '/vol1/1000/airesults/hermes-pocket/source/hermes-pocket/app/src/main/assets/ui';

/* ---------- 最小 DOM ---------- */
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.style = { cssText: '' }; this.dataset = {};
    this._attrs = {}; this._html = ''; this.textContent = ''; this.value = ''; this.id = '';
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  remove() { if (this.parent) this.parent.removeChild(this); }
  addEventListener(t, fn) { (this._ev = this._ev || {})[t] = fn; }
  querySelector(sel) {
    const id = String(sel || '').replace(/^#/, '');
    if (!id) return null;
    if (!this._q) this._q = {};
    if (!this._q[id]) { const e = new El('div'); e.id = id; this._q[id] = e; this.appendChild(e); byId[id] = e; }
    return this._q[id];
  }
  querySelectorAll() { return []; }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  scrollTop() {}
}
const byId = {};
function find(root, id, out = []) { for (const c of root.children) { if (c.id === id) out.push(c); find(c, id, out); } return out; }
global.document = {
  body: new El('body'),
  createElement: (t) => new El(t),
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
global.window = global;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'probe' }, configurable: true }); } catch (e) { /* node 自带的就够用 */ }
try { Object.defineProperty(global, 'location', { value: { href: 'file:///ui/index.html' }, configurable: true }); } catch (e) { /* 同上 */ }
global.confirm = () => true;
global.alert = () => {};

/* ---------- 打桩 HP.*（模拟器里没连 NAS，返回假数据） ---------- */
const calls = [];
const roles = [
  { full_name: 'home.maid', name: 'maid', title: '可爱女仆', tags: '生活', bind: '', state: 'running', session: true, online: true, channels: [], pending: 0 },
  { full_name: 'pipeline.author', name: 'author', title: '作者', tags: '', bind: '', state: 'running', session: true, online: true, channels: [], pending: 0 },
];
global.HP = {
  App: {
    toast: (m) => calls.push(['toast', m]),
    send: (l) => calls.push(['send', l]),
    rpc: async (op, args) => { calls.push(['rpc', op, args]); return { ok: true }; },
    showBoard: () => {},
  },
  Sessions: { list: [], attach: () => {} },
  Panels: {},
};
global.HPApp = global.HP.App;

/* ---------- 加载面板 JS ---------- */
const files = ['talk.js'];
for (const f of files) {
  const src = fs.readFileSync(path.join(UI, f), 'utf8');
  try {
    // 顶层若是 IIFE/对象挂载，直接 eval 到全局
    (0, eval)(src + '\n;globalThis.__TALK = (typeof HP!=="undefined" && HP.Talk) || globalThis.HP_TALK || null;');
    console.log('载入 OK:', f);
  } catch (e) {
    console.log('★ 载入就炸:', f, '→', e.message);
    console.log(e.stack.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
}
const T = globalThis.__TALK;
console.log('HP.Talk 拿到没有：', !!T);
if (!T) { console.log('HP.Talk 没挂上 —— 说明 talk.js 挂载方式不同，先看它最后几行'); process.exit(0); }

/* ---------- 造一个 #tk-page，按路径模拟点击 ---------- */
const page = new El('div'); page.id = 'tk-page'; byId['tk-page'] = page;
document.body.appendChild(page);

function run(label, fn) {
  try { fn(); console.log('  ✔', label, '没抛异常'); }
  catch (e) { console.log('  ★', label, '抛异常 →', e.message); console.log(e.stack.split('\n').slice(1, 5).join('\n')); }
}

run('打开频道页 render()', () => T.render && T.render());
run('点角色 → openRoleSheet(home.maid)', () => T.openRoleSheet && T.openRoleSheet('home.maid'));
const sheetBtns = find(document.body, 'tk-role-say');
console.log('  信息窗里的「跟他对话」按钮找到了没：', sheetBtns.length);
if (sheetBtns.length && sheetBtns[0]._ev && sheetBtns[0]._ev.click) {
  const btn = sheetBtns[0];
  Promise.resolve(btn._ev.click()).then(() => {
    console.log('  点了「跟他对话」之后没抛异常；view =', T.view, '| 场景 =', T.sel && T.sel.full_name);
  }).catch((e) => {
    console.log('  ★ 点「跟他对话」之后异步抛异常 →', e.message);
    console.log(e.stack.split('\n').slice(1, 5).join('\n'));
  });
} else {
  console.log('  （找不到按钮，直接调 openRole）');
  run('直接 openRole(home.maid)', () => { const p = T.openRole && T.openRole('home.maid'); if (p && p.catch) p.catch((e) => console.log('  ★ openRole 异步抛异常 →', e.message, '\n', e.stack.split('\n').slice(1, 5).join('\n'))); });
}
setTimeout(() => { console.log('RPC 调用记录：', JSON.stringify(calls.slice(0, 6))); }, 300);
