/* R-45 定位探针：真机 Shift+Enter 被发出去（keydown Shift → keydown Enter(shift) → keyup Shift → keyup Enter(shiftKey=false)）。
 * 三段：
 *   ① 在**真输入框**（单聊 #tk-sayin / 群聊 #tk-shoutin）上跑 tester 给的按键序列 → 数 talk.say / talk.shout 各几次（复现）
 *   ② 在页面里新建输入框挂**现状接线**（照抄 bindEnterSend 的逻辑）→ 同序列 + 各种边角（beforeinput 兜底、组字、普通回车、连按两次）
 *   ③ 挂**候选改法**（A/B 合并：Shift 状态闩住 400ms、keyup 只记 true 不清 0）→ 逐条复量；再测候选 C（去掉 keyup 兜底）的代价
 * 只读不写：不改工程文件。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r45-shiftenter.mjs
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
  name: 'R-45 定位：Shift+Enter 被发出去（真键盘序列复现 + 候选改法对照）',

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
        if (m && m.t === 'talk.say') { window.__sent.say.push(m.body || ''); setTimeout(() => reply(m._rid, { to: m.role, delivered: true, ms: 1200 }), 5); return; }
        if (m && m.t === 'talk.shout') { window.__sent.shout.push(m.body || ''); setTimeout(() => reply(m._rid, { broadcast: true, raw: { results: [] } }), 5); return; }
        return orig(t);
      };
    }, { ROLES, SESS, THREAD });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

    /* 真键盘序列工具 */
    const key = async (type, k, code, vk, modifiers) => {
      await cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: modifiers || 0, text: (type === 'keyDown' && k === 'Enter') ? '\r' : undefined });
      await page.waitForTimeout(45);
    };
    const shiftEnterSeq = async () => {           /* tester 的序列：Shift 先松、Enter 后松 */
      await key('keyDown', 'Shift', 'ShiftLeft', 16, 0);      /* keydown Shift：本事件 shiftKey=false */
      await key('keyDown', 'Enter', 'Enter', 13, 8);           /* keydown Enter：shiftKey=true（主路该拦住） */
      await key('keyUp', 'Shift', 'ShiftLeft', 16, 8);         /* keyup Shift：shiftKey=true */
      await key('keyUp', 'Enter', 'Enter', 13, 0);             /* keyup Enter：shiftKey=false ← 祸根 */
      await page.waitForTimeout(250);
    };
    const plainEnterSeq = async () => {
      await key('keyDown', 'Enter', 'Enter', 13, 0);
      await key('keyUp', 'Enter', 'Enter', 13, 0);
      await page.waitForTimeout(250);
    };
    const sent = () => page.evaluate(() => ({ say: window.__sent.say.length, shout: window.__sent.shout.length, bodies: window.__sent.say.concat(window.__sent.shout) }));
    const reset = () => page.evaluate(() => { window.__sent = { say: [], shout: [] }; });

    /* ---------- ① 真输入框上复现 ---------- */
    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); await HP.Talk.openRole('home.maid'); await new Promise((r) => setTimeout(r, 1000)); });
    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-sayin'); el.focus(); el.value = 'R45-单聊-ShiftEnter'; });
    await shiftEnterSeq();
    out.A_单聊_ShiftEnter = await sent();

    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-sayin'); el.focus(); el.value = 'R45-单聊-普通Enter'; });
    await plainEnterSeq();
    out.B_单聊_普通Enter = await sent();

    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 600)); });
    await reset();
    await page.evaluate(() => { const el = document.querySelector('#tk-shoutin'); el.focus(); el.value = 'R45-群聊-ShiftEnter'; });
    await shiftEnterSeq();
    out.C_群聊_ShiftEnter = await sent();

    /* 真机上 shiftDown 被污染的读数 */
    out.D_输入框内部状态 = await page.evaluate(() => {
      const el = document.querySelector('#tk-shoutin');
      return el && el.__enterState ? el.__enterState() : '（没有 __enterState，说明该输入框没走 bindEnterSend）';
    });

    /* ---------- ② / ③ 页面里新建输入框：现状接线 vs 候选改法 ---------- */
    const mk = async (mode) => page.evaluate((mode) => {
      const old = document.getElementById('r45-inp'); if (old) old.remove();
      const el = document.createElement('input');
      el.id = 'r45-inp';
      el.style.cssText = 'position:fixed;left:4000px;top:0';
      document.body.appendChild(el);
      window.__r45 = { fired: [], shiftAt: 0, sentAt: 0 };
      const perf = () => performance.now();
      const fire = (why) => window.__r45.fired.push(why);
      if (mode === 'now') {
        /* 现状接线：照抄 talk.js:196-224 的逻辑（shiftDown 被 keyup 覆盖） */
        let shiftDown = false, sentAt = 0;
        const isEnter = (e) => !!(e && (e.key === 'Enter' || e.keyCode === 13));
        const shifted = (e) => (e && e.shiftKey === true) || shiftDown;
        const go = (e) => { if (shifted(e)) return; const t = perf(); if (t - sentAt < 400) return; sentAt = t; fire('go'); };
        el.addEventListener('keydown', (e) => { shiftDown = !!(e && e.shiftKey); if (!isEnter(e)) return; if (shifted(e)) { e.preventDefault(); return; } sentAt = 0; go(e); });
        el.addEventListener('keyup', (e) => { shiftDown = !!(e && e.shiftKey); if (isEnter(e)) go(e); });
        el.addEventListener('beforeinput', (e) => { const ty = e && e.inputType; if (ty === 'insertLineBreak' || ty === 'insertParagraph') go(e); });
      } else if (mode === 'fixAB') {
        /* 候选 A/B 合并：Shift 记成"闩住 400ms"的时间戳；keyup **只记 true、绝不用 keyup 清 0** */
        let shiftAt = 0, sentAt = 0;
        const isEnter = (e) => !!(e && (e.key === 'Enter' || e.keyCode === 13));
        const shifted = (e) => (e && e.shiftKey === true) || (shiftAt && perf() - shiftAt < 400);
        const go = (e) => { if (shifted(e)) return; const t = perf(); if (t - sentAt < 400) return; sentAt = t; fire('go'); };
        el.addEventListener('keydown', (e) => {
          if (e && (e.key === 'Shift' || e.shiftKey === true)) shiftAt = perf();   /* 含"Shift keydown 的 shiftKey=false"那种真机怪相 */
          if (!isEnter(e)) return;
          if (shifted(e)) { e.preventDefault(); return; }
          sentAt = 0; go(e);
        });
        el.addEventListener('keyup', (e) => {
          if (e && (e.key === 'Shift' || e.shiftKey === true)) shiftAt = perf();   /* 只记 true */
          if (isEnter(e)) go(e);
        });
        el.addEventListener('beforeinput', (e) => { const ty = e && e.inputType; if (ty === 'insertLineBreak' || ty === 'insertParagraph') go(e); });
      } else if (mode === 'fixC') {
        /* 候选 C：去掉 keyup 兜底（只在 keydown / beforeinput 两条路上发） */
        let shiftAt = 0, sentAt = 0;
        const isEnter = (e) => !!(e && (e.key === 'Enter' || e.keyCode === 13));
        const shifted = (e) => (e && e.shiftKey === true) || (shiftAt && perf() - shiftAt < 400);
        const go = (e) => { if (shifted(e)) return; const t = perf(); if (t - sentAt < 400) return; sentAt = t; fire('go'); };
        el.addEventListener('keydown', (e) => { if (e && (e.key === 'Shift' || e.shiftKey === true)) shiftAt = perf(); if (!isEnter(e)) return; if (shifted(e)) { e.preventDefault(); return; } sentAt = 0; go(e); });
        el.addEventListener('beforeinput', (e) => { const ty = e && e.inputType; if (ty === 'insertLineBreak' || ty === 'insertParagraph') go(e); });
      }
      window.__r45inp = el;
      return { 模式: mode, 接线好: true };
    }, mode);
    const count = () => page.evaluate(() => ({ 发了: window.__r45.fired.length, 路径: window.__r45.fired.slice() }));
    const clearR45 = async () => { await page.waitForTimeout(500); await page.evaluate(() => { window.__r45.fired.length = 0; }); };

    out.E_候选接线 = {};
    for (const mode of ['now', 'fixAB', 'fixC']) {
      const res = {};
      await mk(mode);
      /* 1) tester 的 Shift+Enter 序列 */
      await clearR45();
      await page.evaluate(() => window.__r45inp.focus());
      await shiftEnterSeq();
      res['①ShiftEnter序列'] = await count();
      /* 2) 普通回车 */
      await clearR45();
      await page.evaluate(() => window.__r45inp.focus());
      await plainEnterSeq();
      res['②普通回车'] = await count();
      /* 3) 输入法提交（insertText）+ 只补 keyup(13)：R-41 要救的那种输入法 */
      await clearR45();
      await page.evaluate(() => window.__r45inp.focus());
      await cdp.send('Input.insertText', { text: '输入法提交' });
      await page.waitForTimeout(120);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await page.waitForTimeout(250);
      res['③输入法提交后只补keyup13'] = await count();
      /* 4) 只派 beforeinput(insertLineBreak) */
      await clearR45();
      await page.evaluate(() => window.__r45inp.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' })));
      await page.waitForTimeout(200);
      res['④只派beforeinput'] = await count();
      /* 5) 同一次按键三条路都触发 */
      await clearR45();
      await page.evaluate(() => {
        const el = window.__r45inp;
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', keyCode: 13 }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertLineBreak' }));
      });
      await page.waitForTimeout(200);
      res['⑤一次按键三条路'] = await count();
      /* 6) 连按两次普通回车 */
      await clearR45();
      await page.evaluate(() => window.__r45inp.focus());
      await plainEnterSeq();
      await page.waitForTimeout(400);
      await plainEnterSeq();
      res['⑥连按两次普通回车'] = await count();
      /* 7) Shift+Enter 之后紧接着普通回车（防粘滞） */
      await clearR45();
      await page.evaluate(() => window.__r45inp.focus());
      await shiftEnterSeq();
      await page.waitForTimeout(450);
      await plainEnterSeq();
      res['⑦ShiftEnter后紧接着回车'] = await count();
      out.E_候选接线[mode] = res;
    }

    await page.evaluate(() => { const el = document.getElementById('r45-inp'); if (el) el.remove(); });
    out.F_源码位置 = {
      '公共入口': 'talk.js:196-240 bindEnterSend(inp, fire)',
      '祸根行（keyup 兜底）': 'talk.js:221  inp.addEventListener("keyup", (e) => { shiftDown = !!(e && e.shiftKey); if (isEnter(e)) go(e); });',
      'shifted 判定': 'talk.js:203  const shifted = (e) => (e && e.shiftKey === true) || shiftDown;',
      'keydown 主路（有守卫）': 'talk.js:214-220（if (shifted(e)) { e.preventDefault(); return; }）',
      'beforeinput 兜底': 'talk.js:222-225（go(e)）',
      '三处调用点': 'talk.js:565 群聊 gin(gfire) · talk.js:681 授权回复框 inp(reply) · talk.js:1152 单聊 inp(fire)'
    };
    return out;
  }
};
