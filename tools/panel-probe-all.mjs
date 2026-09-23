/* 把 pocket 面板的主要路径都走一遍，逐个报「有没有运行时抛异常」
   node tools/panel-probe-all.mjs            # 全部路径
   node tools/panel-probe-all.mjs 群聊        # 只跑某条路径 */
import fs from 'node:fs';
import path from 'node:path';

const UI = process.env.UI_DIR || '/vol1/1000/airesults/hermes-pocket/source/hermes-pocket/app/src/main/assets/ui';
const only = process.argv[2] || '';

/* ---------- 最小 DOM ---------- */
const byId = {};
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = []; this.style = {}; this.dataset = {}; this._attrs = {}; this._html = '';
    this.textContent = ''; this.value = ''; this.id = '';
    this.classList = { add() {}, remove() {}, contains: () => false };
  }
  setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (String(k).startsWith('data-')) this.dataset[String(k).slice(5)] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  appendChild(c) { this.children.push(c); c.parent = this; return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); }
  remove() { if (this.parent) this.parent.removeChild(this); }
  addEventListener(t, fn) { (this._ev = this._ev || {})[t] = fn; }
  querySelector(sel) {
    const id = String(sel || '').replace(/^#/, '');
    if (!id) return null;
    this._q = this._q || {};
    if (!this._q[id]) { const e = new El('div'); e.id = id; this._q[id] = e; this.appendChild(e); byId[id] = e; }
    return this._q[id];
  }
  querySelectorAll() { return []; }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
}
global.document = {
  body: new El('body'),
  createElement: (t) => new El(t),
  getElementById: (id) => byId[id] || null,
  querySelector: () => null,
  querySelectorAll: () => [],
};
global.window = global;
global.localStorage = { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
global.confirm = () => true;
global.alert = () => {};
try { Object.defineProperty(global, 'navigator', { value: { userAgent: 'probe' }, configurable: true }); } catch (e) {}

/* ---------- 打桩：让 RPC 返回真形状的假数据 ---------- */
const calls = [];
const ROLE = { full_name: 'home.maid', name: 'maid', title: '可爱女仆', tags: '生活,中转', bind: '', state: 'running', session: true, online: true, channels: ['home'], pending: 2 };
const ROLES = { scenes: [{ scene: 'home', roles: [ROLE, Object.assign({}, ROLE, { full_name: 'pipeline.author', name: 'author', title: '作者', online: false })] }], channels: [] };
const SESS = { sessions: [{ name: 'hermes', role: null }, { name: 'roles', role: null }] };
const FIX = {
  'talk.roles': ROLES,
  'talk.sessions': SESS,
  'talk.doctor': { db: true, tmux: true, roles_total: 2, missing: ['pipeline.author'], relay: 'active' },
  'talk.hermesSessions': { ok: true, count: 2, items: [{ id: '20260922_1', title: 'owner.me' }, { id: '20260922_2', title: 'home.maid' }] },
  'talk.thread': { role: 'home.maid', count: 2, items: [{ id: 1, who: 'me', body: '在吗', at: 1758500000 }, { id: 2, who: 'him', body: '在的主人', at: 1758500060 }] },
  'talk.deliveries': { items: [{ msg_id: 1, role: 'home.maid', ok: 1, why: '已投递' }] },
  'talk.capture': { raw: '╭─ ☤ Hermes ─╮\n│ 在的主人 │\n╰────────────╯' },
  'talk.switch': { ok: true, role: 'home.maid', bind: 'roles:home-maid', cmd: '/resume home.maid' },
  'talk.sessionDel': { deleted: true, role: 'home.maid' },
  'talk.asks': { items: [{ from: 'pipeline.tester', what: '要改权限', options: '准/不准' }] },
  'talk.stream': { items: [{ id: 9, kind: 'broadcast', from: 'pipeline.author', body: '大家好' }] },
  'talk.member': { channels: [] },
};
global.HP = {
  App: {
    toast: (m) => calls.push(['toast', m]),
    send: (l) => calls.push(['send', l]),
    rpc: async (op, args) => { calls.push(['rpc', op, args]); return FIX[op] || { ok: true }; },
    showBoard: (b) => calls.push(['showBoard', b]),
  },
  Sessions: { list: [{ name: 'hermes' }, { name: 'roles' }], attach: (n) => calls.push(['attach', n]) },
  Panels: { renderSessions: () => calls.push(['renderSessions']) },
};

/* ---------- 载入面板 ---------- */
for (const f of ['talk.js', 'panels.js']) {
  const src = fs.readFileSync(path.join(UI, f), 'utf8');
  try { (0, eval)(src); } catch (e) { console.log('★ 载入 ' + f + ' 就炸 →', e.message); }
}
const T = globalThis.HP.Talk || (globalThis.HP && globalThis.HP.Talk);
console.log('HP.Talk:', !!T, '| HP.Panels.sessionSheet:', !!(globalThis.HP.Panels && globalThis.HP.Panels.sessionSheet));

const page = new El('div'); page.id = 'tk-page'; byId['tk-page'] = page;
document.body.appendChild(page);

const paths = [
  ['频道页', () => T.render()],
  ['群聊', () => { T.view = 'group'; T.render(); }],
  ['点角色（信息窗）', () => { T.view = 'channel'; T.render(); T.openRoleSheet('home.maid'); }],
  ['私聊（1:1 聊天界面）', () => T.openRole('home.maid')],
  ['私聊-终端形式', () => { T.style = 'term'; T.openRole('home.maid'); T.style = 'chat'; }],
  ['会话列表（在线/没在线/历史）', () => { T.view = 'channel'; T.render(); }],
  ['会话弹窗+删除', () => { T.openSessionSheet({ name: 'hermes', role: 'home.maid' }); }],
  ['聊天↔终端切换', () => { T.style = 'term'; T.render(); T.style = 'chat'; T.render(); }],
];
for (const [label, fn] of paths) {
  if (only && !label.includes(only)) continue;
  try { const p = fn(); if (p && p.catch) p.catch((e) => console.log('  ★', label, '（异步）→', e.message)); console.log('  ✔', label); }
  catch (e) { console.log('  ★', label, '→', e.message); console.log('     ', (e.stack || '').split('\n')[1] || ''); }
}
setTimeout(() => console.log('RPC/动作记录：', JSON.stringify(calls.slice(0, 8))), 400);
