/* R-41 复测 · 第二版：把"组字态"与"非组字态"分开测（上一版全走 IME 注入 → 每条键事件 isComposing=true）
 * 方法：A 非组字（JS 赋值，不碰输入法）→ 真按键 keyevent 66；B 组字态（`adb shell input text` 走输入法）→ 真按键
 * 三条路都记：keydown/keyup/beforeinput 的 {key, keyCode, shiftKey, isComposing, inputType}
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r41-reprobe2-20260925.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const key = (c) => sh(`input keyevent ${c}`);
const combo = (a, b) => sh(`input keycombination ${a} ${b}`);
const itext = (t) => sh(`input text ${t}`);

export default {
  name: 'R41-复测-v2-组字态对照',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      window.__say = []; window.__shout = []; window.__ans = []; window.__ev = []; window.__toasts = [];
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__toasts.push(String(m || '')); return ot.apply(this, arguments); };
      HP.App.rpc = async (op, a) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: [] }] }], channels: {} };
        if (op === 'talk.since') return { messages: [{ id: 9001, from: 'pipeline.author', to: 'me', kind: 'private', topic: '', body: 'R41-群里的话', at: 1790260000 }], last: 9001 };
        if (op === 'talk.asks') return { count: 1, asks: [{ id: 42, from: 'pipeline.author', topic: '【授权】R41', body: '【授权】来自 pipeline.author\n要不要授权？' }] };
        if (op === 'talk.thread') return { items: [{ who: 'him', body: 'R41-他说的', at: 1790260000 }] };
        if (op === 'talk.say') { window.__say.push(a); return { delivered: true, ms: 1111 }; }
        if (op === 'talk.shout') { window.__shout.push(a); return { results: [{ role: 'pipeline.author', delivered: true, ms: 1111 }] }; }
        if (op === 'talk.answer') { window.__ans.push(a); return { ok: true }; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      window.__hook = (sel, tag) => { const el = document.querySelector(sel); if (!el) return false; ['keydown', 'keyup', 'beforeinput', 'compositionstart', 'compositionend'].forEach((t) => el.addEventListener(t, (e) => window.__ev.push({ tag: tag, type: t, key: e.key || null, kc: e.keyCode != null ? e.keyCode : null, shift: e.shiftKey === true, comp: e.isComposing === true, it: e.inputType || null }), true)); return true; };
      window.__reset = () => { window.__ev = []; window.__toasts = []; };
    });
    const vis = (id) => page.evaluate((i) => { const els = [...document.querySelectorAll('#' + i)]; const el = els.find((e) => e.getBoundingClientRect().height > 0) || els[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; }, id);
    const snap = () => page.evaluate(() => ({
      say: window.__say.length, shout: window.__shout.length, ans: window.__ans.length,
      sayArgs: window.__say.slice(-3), shoutArgs: window.__shout.slice(-2), ansArgs: window.__ans.slice(-2),
      bubbles: document.querySelectorAll('#tk-chat .tk-bub').length, stream: document.querySelectorAll('#tk-stream .tk-bub').length,
      vals: [...document.querySelectorAll('#tk-sayin')].map((e) => e.value).concat([(document.querySelector('#tk-shoutin') || {}).value || null]),
      evTail: window.__ev.slice(-8), toasts: window.__toasts.slice(-3),
      sends: [...document.querySelectorAll('#tk-sends .tk-sendrow')].map((r) => (r.querySelector('.tk-sendtext') || {}).textContent)
    }));
    try {
      /* ===== 主块①单聊 ===== */
      await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author'); await new Promise((r) => setTimeout(r, 1600)); window.__hook('#tk-sayin', 'sayin'); window.__reset(); });
      const sIn = await vis('tk-sayin');
      tap(sIn.x, sIn.y); await page.waitForTimeout(1000);
      /* A) 非组字态：JS 赋值 + 真按键 */
      await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); el.value = 'R41-A-clean'; window.__reset(); });
      key(66); await page.waitForTimeout(1300);
      out.A_单聊_非组字 = await snap();
      /* A2) 3 连击（<400ms）→ 只应发 1 条 */
      await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); el.value = 'R41-A2-burst'; window.__reset(); });
      key(66); key(66); key(66); await page.waitForTimeout(1500);
      out.A2_单聊_三连击 = await snap();
      /* A3) 间隔 600ms 两次 → 期望 2 条 */
      await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); el.value = 'R41-A3-gap'; window.__reset(); });
      key(66); await page.waitForTimeout(600); key(66); await page.waitForTimeout(1500);
      out.A3_单聊_间隔600 = await snap();
      /* A4) Shift+Enter（模拟实体键盘）→ 不发、文字留着 */
      await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); el.value = 'R41-A4-shift'; window.__reset(); });
      combo(59, 66); await page.waitForTimeout(1300);
      out.A4_单聊_ShiftEnter = await snap();
      /* B) 组字态：走输入法打字（adb input text）后再按键 */
      await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); el.value = ''; window.__reset(); });
      tap(sIn.x, sIn.y); await page.waitForTimeout(800);
      itext('R41-B-ime'); await page.waitForTimeout(700);
      out.B_单聊_组字态_打字后 = await snap();
      key(66); await page.waitForTimeout(1500);
      out.B_单聊_组字态_回车 = await snap();
      /* ===== 主块②群聊 ===== */
      await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 1600)); window.__hook('#tk-shoutin', 'shoutin'); window.__reset(); });
      const gIn = await vis('tk-shoutin');
      tap(gIn.x, gIn.y); await page.waitForTimeout(900);
      await page.evaluate(() => { document.getElementById('tk-shoutin').value = 'R41-群聊-非组字'; window.__reset(); });
      key(66); await page.waitForTimeout(1400);
      out.C_群聊_非组字 = await snap();
      await page.evaluate(() => { document.getElementById('tk-shoutin').value = ''; window.__reset(); });
      itext('R41-group-ime'); await page.waitForTimeout(700);
      key(66); await page.waitForTimeout(1400);
      out.C2_群聊_组字态 = await snap();
      /* ===== 跨块⑧频道页：授权框 ===== */
      await page.evaluate(async () => { HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel'; await new Promise((r) => setTimeout(r, 1800)); window.__reset(); });
      const ask = await page.evaluate(() => { const el = document.querySelector('[data-ask] .tk-askin'); if (!el) return null; const r = el.getBoundingClientRect(); window.__hook('[data-ask] .tk-askin', 'askin'); el.value = 'R41-授权答复'; return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), askId: el.closest('[data-ask]').getAttribute('data-ask') }; });
      out.D_授权框 = { box: ask };
      if (ask) { tap(ask.x, ask.y); await page.waitForTimeout(900); key(66); await page.waitForTimeout(1400); out.D_授权框 = Object.assign(out.D_授权框, await snap()); }
      out.chrome = await page.evaluate(() => { const v = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: v('keybar'), composer: v('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
