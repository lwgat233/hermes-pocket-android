/* R-41 定位探针：聊天输入框「按回车没反应」——
 *   ① 现状：两个真输入框（群聊 #tk-shoutin / 单聊 #tk-sayin / 授权回复框 tk-askin）各挂什么、哪条路会发；
 *   ② 事件形状对照：真 Enter / 输入法提交（insertText）/ Shift+Enter 在桌面 Chromium 里各产生哪些事件（只作形状参考）；
 *   ③ 候选接线（页面里新建真输入框）：enterkeyhint + keyup(13) + beforeinput 三层兜底 + 防重复，逐条实测会不会重复发。
 * 只读不写：不改工程文件。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r41-enter.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R40-定位-20260924/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const ROLES = read('roles-json.json');
const SESS = read('sessions-json.json');
const THREAD = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../evidence/R37-定位-20260924/fixtures/thread-home.maid.json'), 'utf8'));

export default {
  name: 'R-41 定位：聊天输入框回车发送（现状 / 事件形状 / 候选接线）',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    await page.evaluate(({ ROLES, SESS, THREAD }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.__sent = { say: [], shout: [] };
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.thread') { setTimeout(() => reply(m._rid, THREAD), 3); return; }
        if (m && m.t === 'talk.say') { window.__sent.say.push(m.body || ''); setTimeout(() => reply(m._rid, { to: m.role, kind: m.kind, delivered: true }), 5); return; }
        if (m && m.t === 'talk.shout') { window.__sent.shout.push(m.body || ''); setTimeout(() => reply(m._rid, { broadcast: true, raw: { results: [] } }), 5); return; }
        return orig(t);
      };
    }, { ROLES, SESS, THREAD });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

    const sent = () => page.evaluate(() => ({ say: window.__sent.say.length, shout: window.__sent.shout.length, bodies: window.__sent.say.concat(window.__sent.shout) }));
    const reset = () => page.evaluate(() => { window.__sent = { say: [], shout: [] }; });

    /* 真键盘：Enter / Shift+Enter */
    const realEnter = async (opts = {}) => {
      const base = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: opts.shift ? 8 : 0 };
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: '\r' });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await page.waitForTimeout(250);
    };
    /* 真键盘：keyup(13) —— 单独补一次（有的输入法只给 keyup） */
    const realKeyUp13 = async () => {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await page.waitForTimeout(250);
    };
    /* 输入法提交：insertText（只出 beforeinput/input，不出 keydown/keyup） */
    const imeCommit = async (text) => {
      await cdp.send('Input.insertText', { text });
      await page.waitForTimeout(200);
    };

    /* ---------- ① 现状：三个输入框各挂什么 ---------- */
    out.a_接线现状 = await page.evaluate(() => {
      const info = (el, name) => {
        if (!el) return { 缺失: name };
        return {
          选择器: name, id: el.id || null, 标签: el.tagName, type: el.getAttribute('type') || '(默认 text)',
          enterkeyhint: el.getAttribute('enterkeyhint'), inputmode: el.getAttribute('inputmode'),
          有value: !!el.value
        };
      };
      return {
        群聊: info(document.querySelector('#tk-shoutin'), '#tk-shoutin'),
        单聊: info(document.querySelector('#tk-sayin'), '#tk-sayin'),
        授权回复框: info(document.querySelector('.tk-askline .tk-askin'), '.tk-askline .tk-askin')
      };
    });

    /* 进群聊页，量真 Enter 能不能发 */
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 500)); });
    out.a2_群聊输入框属性 = await page.evaluate(() => {
      const el = document.querySelector('#tk-shoutin');
      return el ? { id: el.id, 标签: el.tagName, type: el.getAttribute('type') || '(默认 text)', enterkeyhint: el.getAttribute('enterkeyhint'), inputmode: el.getAttribute('inputmode') } : { 缺失: '#tk-shoutin' };
    });
    out.a3_授权回复框属性 = await page.evaluate(() => {
      const el = document.querySelector('.tk-askline .tk-askin');
      return el ? { 标签: el.tagName, enterkeyhint: el.getAttribute('enterkeyhint') } : { 缺失: '授权回复框（该页当前没有等你授权的条目）' };
    });
    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-shoutin'); el.focus(); el.value = '现状-真Enter'; });
    await realEnter();
    out.b_群聊_真Enter = await sent();

    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-shoutin'); el.focus(); el.value = ''; });
    await imeCommit('现状-输入法提交');
    await realKeyUp13();
    out.c_群聊_输入法提交后keyup13 = await sent();

    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-shoutin'); el.focus(); el.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true })); el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' })); });
    await page.waitForTimeout(200);
    out.d_群聊_只派beforeinput = await sent();

    /* 单聊 */
    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); await HP.Talk.openRole('home.maid'); await new Promise((r) => setTimeout(r, 800)); });
    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-sayin'); el.focus(); el.value = '现状-单聊真Enter'; });
    await realEnter();
    out.e_单聊_真Enter = await sent();

    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-sayin'); el.focus(); el.value = ''; });
    await imeCommit('现状-单聊输入法提交');
    await realKeyUp13();
    out.f_单聊_输入法提交后keyup13 = await sent();

    /* 授权回复框（talk.js:598 的 askRow 输入框） */
    out.g_授权回复框_有没有挂Enter = await page.evaluate(() => {
      const el = document.querySelector('.tk-askline .tk-askin');
      return { 存在: !!el, 说明: 'talk.js:598-620 只建了输入框 + 发送键 ok（talk.js:622 一带），全仓 keydown 只有 talk.js:509 与 talk.js:1083 两处官方挂点 ⇒ 这个框只有点发送键一条路' };
    });

    /* ---------- ② 事件形状对照（桌面 Chromium 的真实按键序列；只是形状参考） ---------- */
    out.h_事件序列 = await page.evaluate(() => new Promise((resolve) => {
      const el = document.createElement('input');
      el.id = 'r41-probe-input';
      el.style.cssText = 'position:fixed;left:4000px;top:0';
      document.body.appendChild(el);
      const log = [];
      ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'].forEach((t) => {
        el.addEventListener(t, (e) => log.push({ 事件: t, key: e.key, keyCode: e.keyCode, inputType: e.inputType || null, isComposing: !!e.isComposing, data: (e.data || '').slice(0, 8) }));
      });
      window.__r41log = log;
      window.__r41el = el;
      el.focus();
      resolve({ 就绪: true, 输入框: el.id });
    }));

    const collectLog = async () => {
      const l = await page.evaluate(() => window.__r41log.splice(0, window.__r41log.length));
      return l;
    };
    await page.evaluate(() => window.__r41el.focus());
    await realEnter();
    out.i_真Enter的事件序列 = await collectLog();

    await page.evaluate(() => { window.__r41el.focus(); window.__r41el.value = ''; });
    await imeCommit('输入法提交');
    out.j_输入法提交的事件序列 = await collectLog();

    await realEnter({ shift: true });
    out.k_ShiftEnter的事件序列 = await collectLog();

    let imeCompose = null;
    try {
      await cdp.send('Input.imeSetComposition', { text: '拼', selectionStart: 1, selectionEnd: 1 });
      await page.waitForTimeout(120);
      imeCompose = await collectLog();
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 });
      await page.waitForTimeout(120);
    } catch (e) { imeCompose = '不支持：' + String(e).slice(0, 120); }
    out.l_输入法组字的事件序列 = imeCompose;

    /* ---------- ③ 候选接线：三层兜底 + 防重复（挂在新建的真输入框上） ---------- */
    out.m_候选接线_结果 = await page.evaluate(() => {
      const el = document.getElementById('r41-probe-input');
      el.value = '';
      let fired = 0;
      const fire = () => { fired += 1; };
      let lastAt = 0;
      const guard = () => { const now = performance.now(); if (now - lastAt < 300) return false; lastAt = now; return true; };
      const tryFire = (why) => { if (!guard()) return; window.__r41why.push(why); fire(); };
      window.__r41why = [];
      el.setAttribute('enterkeyhint', 'send');
      /* ① keydown（原样保留） ② keyup + keyCode 13 兜底 ③ beforeinput / insertLineBreak 兜底 */
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tryFire('keydown'); } });
      el.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.keyCode === 13) tryFire('keyup'); });
      el.addEventListener('beforeinput', (e) => { if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') tryFire('beforeinput'); });
      el.addEventListener('input', (e) => { if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') tryFire('input'); });
      window.__r41fired = () => fired;
      window.__r41hint = () => el.getAttribute('enterkeyhint');
      return { 接线: ['keydown', 'keyup', 'beforeinput', 'input'], 防重复: '300ms 内只认一次', enterkeyhint: el.getAttribute('enterkeyhint') };
    });

    const firedCount = () => page.evaluate(() => ({ 发了: window.__r41why.length, 触发路径: window.__r41why.slice() }));
    const clearState = async () => { await page.waitForTimeout(500); await page.evaluate(() => { window.__r41why.length = 0; }); };
    /* 重新挂一遍（用计数器数组） */
    await page.evaluate(() => {
      const el = document.getElementById('r41-probe-input');
      el.replaceWith(el.cloneNode(true));
      const el2 = document.getElementById('r41-probe-input');
      window.__r41fired = () => window.__r41why.length;
    });
    await page.evaluate(() => {
      const el = document.getElementById('r41-probe-input');
      let lastAt = 0;
      window.__r41why = [];
      const guard = () => { const now = performance.now(); if (now - lastAt < 300) return false; lastAt = now; return true; };
      const tryFire = (why) => { if (!guard()) return; window.__r41why.push(why); };
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tryFire('keydown'); } });
      el.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.keyCode === 13) tryFire('keyup'); });
      el.addEventListener('beforeinput', (e) => { if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') tryFire('beforeinput'); });
      el.addEventListener('input', (e) => { if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') tryFire('input'); });
    });
    await page.evaluate(() => window.__r41el && window.__r41el.focus());
    await page.evaluate(() => document.getElementById('r41-probe-input').focus());
    await realEnter();
    out.n_候选接线_一次真Enter = await firedCount();

    await clearState();
    await imeCommit('输入法提交');
    await realKeyUp13();
    out.o_候选接线_输入法提交后keyup13 = await firedCount();

    await clearState();
    await page.evaluate(() => document.getElementById('r41-probe-input').dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' })));
    await page.waitForTimeout(150);
    out.p_候选接线_只派beforeinput = await firedCount();

    await clearState();
    await page.evaluate(() => {                       /* 同一次按键里三条路都被触发 —— 看会不会重复 */
      const el = document.getElementById('r41-probe-input');
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' }));
    });
    await page.waitForTimeout(150);
    out.q_候选接线_一次按键三条路都触发 = await firedCount();

    await clearState();
    await realEnter();
    await page.waitForTimeout(400);
    await realEnter();
    out.r_候选接线_连按两次 = await firedCount();

    await clearState();
    await realEnter({ shift: true });
    out.s_候选接线_ShiftEnter = await firedCount();

    out.t_enterkeyhint全仓 = await page.evaluate(() => ({
      '当前页面里带 enterkeyhint 的元素数': document.querySelectorAll('[enterkeyhint]').length,
      单聊输入框的值: (document.querySelector('#tk-sayin') || {}).getAttribute && document.querySelector('#tk-sayin') ? document.querySelector('#tk-sayin').getAttribute('enterkeyhint') : null
    }));

    await page.evaluate(() => { const el = document.getElementById('r41-probe-input'); if (el) el.remove(); });
    return out;
  }
};
