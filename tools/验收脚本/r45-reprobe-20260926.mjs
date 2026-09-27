/* R-45 第 3 步复测 · Shift+Enter 不误发（真机）
 * 主块①单聊 + 主块②群聊 + 跨块⑧频道页（授权框，同一个 bindEnterSend）
 * 手法：input keycombination 59 66（模拟实体键盘 Shift+Enter）、input keyevent 66（普通回车）、
 *      input text（软键盘/Gboard 形状：组字态后回车）
 * 取元素：只取**最上面那个**可见的 #tk-sayin（上轮真机读到 2 个）；数行只看可见的 #tk-sends
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r45-reprobe-20260926.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const key = (c) => sh(`input keyevent ${c}`);
const combo = (a, b) => sh(`input keycombination ${a} ${b}`);
const itext = (t) => sh(`input text ${t}`);

export default {
  name: 'R45-复测-Shift回车不误发',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      window.__thread = [];
      for (let i = 0; i < 8; i++) window.__thread.push({ who: i % 2 ? 'me' : 'him', body: 'R45-第' + i + '条', at: now - (8 - i) * 60 });
      window.__thread.push({ who: 'him', body: 'R45-末条他说的', at: now });
      window.__say = []; window.__shout = []; window.__ans = []; window.__ev = []; window.__toasts = [];
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__toasts.push(String(m || '')); return ot.apply(this, arguments); };
      HP.App.rpc = async (op, a) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: [] }] }], channels: {} };
        if (op === 'talk.since') return { messages: [{ id: 9001, from: 'pipeline.author', to: 'me', kind: 'private', topic: '', body: 'R45-群里的话', at: 1790260000 }], last: 9001 };
        if (op === 'talk.asks') return { count: 1, asks: [{ id: 42, from: 'pipeline.author', topic: '【授权】R45', body: '【授权】来自 pipeline.author\n要不要授权？' }] };
        if (op === 'talk.thread') return { items: window.__thread };
        if (op === 'talk.say') { window.__say.push(a); window.__thread = window.__thread.concat([{ who: 'me', body: a.body, at: 1790260500 }]); return { id: 1, to: a.role, ok: 1, delivered: true, ms: 3329, attempts: 1, confirmed: 1 }; }
        if (op === 'talk.shout') { window.__shout.push(a); return { id: 2, broadcast: true, count: 1, delivered: true, results: [{ role: 'pipeline.author', delivered: true, confirmed: 1, ms: 3368, attempts: 1 }] }; }
        if (op === 'talk.answer') { window.__ans.push(a); return { ok: true }; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      window.__hook = (el) => { ['keydown', 'keyup', 'beforeinput'].forEach((t) => el.addEventListener(t, (e) => window.__ev.push({ t: t, key: e.key || null, kc: e.keyCode != null ? e.keyCode : null, shift: e.shiftKey === true }), true)); };
      window.__topSayin = () => [...document.querySelectorAll('#tk-sayin')].filter((e) => e.getBoundingClientRect().height > 0).slice(-1)[0];
    });
    const snap = () => page.evaluate(() => ({
      say: window.__say.length, shout: window.__shout.length, ans: window.__ans.length,
      args: (window.__say.slice(-1)[0] || window.__shout.slice(-1)[0] || window.__ans.slice(-1)[0] || null),
      vals: [...document.querySelectorAll('#tk-sayin')].map((e) => e.value).concat([(document.getElementById('tk-shoutin') || {}).value || null, (document.querySelector('[data-ask] .tk-askin') || {}).value || null]),
      sayinCount: document.querySelectorAll('#tk-sayin').length,
      rows: (() => { const b = [...document.querySelectorAll('#tk-sends')].find((x) => x.getBoundingClientRect().height > 0); return b ? [...b.querySelectorAll('.tk-sendrow')].map((r) => (r.querySelector('.tk-sendtext') || {}).textContent) : []; })(),
      ev: window.__ev.slice(-8), toasts: window.__toasts.slice(-2)
    }));
    const focusSingle = async (val) => {
      await page.evaluate((v) => { const el = window.__topSayin(); el.value = v; window.__ev = []; const r = el.getBoundingClientRect(); window.__pt = { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; }, val);
      const pt = await page.evaluate(() => window.__pt);
      tap(pt.x, pt.y); await page.waitForTimeout(900);
    };
    try {
      /* ===== 主块①单聊 ===== */
      await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author'); await new Promise((r) => setTimeout(r, 1700)); window.__hook(window.__topSayin()); window.__ev = []; });
      /* 1) 普通回车 → 1 条 */
      await focusSingle('R45-plain');
      key(66); await page.waitForTimeout(1400);
      out.A_plain_enter = await snap();
      /* 2) Shift+Enter → 0 条 + 文字留着，然后紧接着普通回车（看"不粘滞"边界） */
      await focusSingle('R45-shift');
      const beforeShift = await snap();
      combo(59, 66); await page.waitForTimeout(600);
      out.B1_shift_enter = { before: beforeShift, after: await snap() };
      key(66); await page.waitForTimeout(1200);            /* 距 Shift 约 600ms */
      out.B2_plain_600ms_after_shift = await snap();
      await focusSingle('R45-shift-fast');
      combo(59, 66); await page.waitForTimeout(150);
      key(66); await page.waitForTimeout(1200);            /* 距 Shift 约 150ms */
      out.B3_plain_150ms_after_shift = await snap();
      await focusSingle('R45-shift-ok');
      combo(59, 66); await page.waitForTimeout(1000);
      key(66); await page.waitForTimeout(1300);            /* 距 Shift 约 1s，闩已过期 */
      out.B4_plain_1000ms_after_shift = await snap();
      /* 3) 软键盘形状（真 IME 打字 → 立刻回车）→ 1 条（R-41 链） */
      await focusSingle('');
      await page.evaluate(() => { const el = window.__topSayin(); el.value = ''; window.__ev = []; });
      itext('R45-ime'); await page.waitForTimeout(700);
      const beforeIme = await snap();
      key(66); await page.waitForTimeout(1400);
      out.C_ime_enter = { before: beforeIme, after: await snap() };
      /* 4) 三连击 → 1 条；同文字再回车 600ms → 空文本不发；重新输入再回车 → 2 条 */
      await focusSingle('R45-burst'); key(66); key(66); key(66); await page.waitForTimeout(1500);
      out.D1_triple = await snap();
      key(66); await page.waitForTimeout(1200);
      out.D2_again_same_text_600ms = await snap();
      await focusSingle('R45-second'); key(66); await page.waitForTimeout(1300);
      out.D3_retyped_again = await snap();
      /* ===== 主块②群聊 ===== */
      await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 1400)); window.__hook(document.getElementById('tk-shoutin')); window.__ev = []; });
      const gp = () => page.evaluate(() => { const el = document.getElementById('tk-shoutin'); const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      let p = await gp();
      await page.evaluate(() => { document.getElementById('tk-shoutin').value = 'R45-group-plain'; window.__ev = []; });
      tap(p.x, p.y); await page.waitForTimeout(800); key(66); await page.waitForTimeout(1400);
      out.E1_group_plain = await snap();
      await page.evaluate(() => { document.getElementById('tk-shoutin').value = 'R45-group-shift'; window.__ev = []; });
      combo(59, 66); await page.waitForTimeout(700);
      out.E2_group_shift = await snap();
      /* ===== 跨块⑧频道页：授权框 ===== */
      await page.evaluate(async () => { HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel'; await new Promise((r) => setTimeout(r, 1700)); const el = document.querySelector('[data-ask] .tk-askin'); window.__hook(el); el.value = 'R45-ask-plain'; window.__ev = []; });
      const ap = await page.evaluate(() => { const el = document.querySelector('[data-ask] .tk-askin'); const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      tap(ap.x, ap.y); await page.waitForTimeout(800); key(66); await page.waitForTimeout(1400);
      out.F1_ask_plain = await snap();
      await page.evaluate(() => { document.querySelector('[data-ask] .tk-askin').value = 'R45-ask-shift'; window.__ev = []; });
      combo(59, 66); await page.waitForTimeout(700);
      out.F2_ask_shift = await snap();
      out.chrome = await page.evaluate(() => { const v = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: v('keybar'), composer: v('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
