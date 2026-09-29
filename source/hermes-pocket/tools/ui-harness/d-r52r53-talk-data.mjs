/* R52R53#4 验证探针：① 会话钉住（sel 失效不再静默取 list[0]）② 聊天页装数据（真平台回包 / 命令失败两种）
 * 真回包＝当场跑 `python3 /vol1/1000/airesults/roles-chat/tools/talk.py since-json --id 0` 的原样 JSON（不是编的）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r52r53-talk-data.mjs
 */
import { execFileSync } from 'node:child_process';

const TALK = '/vol1/1000/airesults/roles-chat/tools/talk.py';

export default {
  name: 'R52R53#4：会话钉住显式化 + 聊天页装数据（真平台回包/失败形状）',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    let real = null, realErr = '';
    try {
      const txt = execFileSync('python3', [TALK, 'since-json', '--id', '0'], { encoding: 'utf-8', timeout: 30000 });
      real = JSON.parse(txt);
    } catch (e) { realErr = String(e.message || e).slice(0, 160); }
    out['00_真平台回包'] = real ? { last: real.last, 条数: (real.messages || []).length, hidden_count: real.hidden_count,
      首条: (real.messages || [])[0] ? { id: real.messages[0].id, from: real.messages[0].from, len: (real.messages[0].body || '').length } : null }
      : { err: realErr };

    /* ① 会话：造 3 条 + sel 失效 ⇒ 不许静默 attach */
    out['01_会话_sel失效'] = await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      window.__sent2 = [];
      if (!window.__patched2) {
        const o = HP.App.send.bind(HP.App);
        HP.App.send = (d) => { window.__sent2.push(String(d)); return o(d); };
        window.__patched2 = true;
      }
      HP.Sessions.list = [{ name: 'hermes' }, { name: 'r52t' }, { name: 'roles' }];
      HP.Sessions.sel = '已经没了的会话';
      HP.Sessions.refresh = async () => HP.Sessions.list;          /* 别去打真 tmux.list */
      HP.App.closePanel();
      window.__sent2 = [];
      const r = await HP.Sessions.bootstrap();
      await new Promise((x) => setTimeout(x, 200));
      return { bootstrap: r, 发出去的字节: window.__sent2.slice(),
               '有没有 attach': window.__sent2.some((s) => s.indexOf('tmux attach') >= 0),
               toast: (document.getElementById('toast') || {}).textContent || '',
               面板开着吗: !document.getElementById('overlay').classList.contains('hidden'),
               lastPick: HP.Sessions.lastPick || null };
    });

    /* ①b sel 有效 ⇒ 正常 attach（钉住那条） */
    out['02_会话_sel有效'] = await page.evaluate(async () => {
      HP.Sessions.sel = 'r52t';
      window.__sent2 = [];
      const r = await HP.Sessions.bootstrap();
      await new Promise((x) => setTimeout(x, 150));
      return { bootstrap: r, 发出去的字节: window.__sent2.slice(),
               钉住的就是它: window.__sent2.some((s) => s.indexOf("tmux attach -t 'r52t'") >= 0) };
    });

    /* ①c 只有一条会话 ⇒ 不是猜，直接连 */
    out['03_会话_只有一条'] = await page.evaluate(async () => {
      HP.Sessions.list = [{ name: 'hermes' }];
      HP.Sessions.sel = '';
      window.__sent2 = [];
      const r = await HP.Sessions.bootstrap();
      await new Promise((x) => setTimeout(x, 150));
      return { bootstrap: r, 发出去的字节: window.__sent2.slice() };
    });

    /* ② 聊天页装数据：真回包 ⇒ 气泡 > 0 */
    out['04_聊天页_真回包'] = await page.evaluate(async (payload) => {
      const origRpc = HP.App.rpc.bind(HP.App);
      HP.App.rpc = async (type, p) => {
        if (type === 'talk.since') return payload;
        if (type === 'talk.roles') return { scenes: [{ scene: 'roles', roles: [{ full_name: 'pipeline.author', name: 'pipeline.author', title: '作者', state: 'running', online: true }] }], channels: {} };
        if (type === 'talk.asks') return { asks: [] };
        if (type === 'talk.sessions') return { sessions: [] };
        return origRpc(type, p || {});
      };
      const tab = () => { const e = document.querySelector('.tk-chat'); return e ? e.children.length : -1; };
      const r = {};
      r['view=channel'] = await (async () => {
        HP.Talk.last = 0; HP.Talk.msgs = []; HP.Talk.rpcErr = '';
        HP.Talk.tab = 'talk'; HP.Talk.view = 'channel';
        HP.App.showBoard('talk');
        await HP.Talk.render();
        await new Promise((x) => setTimeout(x, 300));
        return { last: HP.Talk.last, msgs: (HP.Talk.msgs || []).length, 流子节点: tab(),
                 bub: document.querySelectorAll('.tk-bub').length, rpcErr: HP.Talk.rpcErr || '',
                 页面文字: (document.getElementById('tab-talk') || {}).textContent ? document.getElementById('tab-talk').textContent.slice(0, 90) : '' };
      })();
      r['view=role'] = await (async () => {
        HP.Talk.sel = { full_name: 'pipeline.author', title: '作者', name: 'pipeline.author' };
        HP.Talk.tab = 'talk'; HP.Talk.view = 'role';
        await HP.Talk.render();
        await new Promise((x) => setTimeout(x, 300));
        return { 流子节点: tab(), bub: document.querySelectorAll('.tk-bub').length,
                 页面文字: (document.getElementById('tab-talk') || {}).textContent ? document.getElementById('tab-talk').textContent.slice(-110) : '' };
      })();
      return r;
    }, real);

    /* ②b 命令失败形状（桥回 {raw,cmd}）⇒ 错误要看得见，气泡仍 0 */
    out['05_聊天页_命令失败'] = await page.evaluate(async () => {
      const origRpc = HP.App.rpc.bind(HP.App);
      HP.App.rpc = async (type, p) => (type === 'talk.since'
        ? { raw: 'python3: command not found', cmd: 'since-json --id 0' } : (type === 'talk.roles' ? { scenes: [] } : (type === 'talk.asks' ? { asks: [] } : origRpc(type, p || {}))));
      HP.Talk.last = 0; HP.Talk.msgs = []; HP.Talk.rpcErr = '';
      HP.App.showBoard('talk');
      await HP.Talk.render();
      await new Promise((x) => setTimeout(x, 300));
      const chat = document.getElementById('tk-chat');
      return { tk_bub数: document.querySelectorAll('#tk-chat .tk-bub, .tk-bub').length,
               rpcErr: HP.Talk.rpcErr || '', rpcCmd: HP.Talk.rpcCmd || '',
               toast: (document.getElementById('toast') || {}).textContent || '',
               状态行里能看到失败: (document.body.innerText || '').indexOf('取数失败') >= 0,
               tk_chat_子节点: chat ? chat.children.length : -1 };
    });

    out['06_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
