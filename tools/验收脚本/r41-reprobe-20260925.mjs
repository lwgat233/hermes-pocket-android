/* R-41 复测 · 主块②群聊 + 主块①单聊 + 跨块⑧频道页（授权框）
 * 三条真实按键路径：① Gboard 软键盘上的回车键（真触摸）② `adb shell input keyevent 66`
 * ③ Shift+Enter（`input keycombination 59 66`，模拟实体键盘；模拟器没有实体键盘，按"模拟"记）
 * 事件序列：在每个输入框上挂捕获监听（keydown/keyup/beforeinput/composition*），把序列抄进证据。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r41-reprobe-20260925.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const key = (code) => sh(`input keyevent ${code}`);
const combo = (a, b) => sh(`input keycombination ${a} ${b}`);
const text = (t) => sh(`input text ${t}`);
const kbDump = () => { try { sh('uiautomator dump /sdcard/kb.xml'); return execSync(`adb -s ${SERIAL} shell cat /sdcard/kb.xml`, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); } catch (e) { return ''; } };

export default {
  name: 'R41-复测-回车发送',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate((blob) => {
      const B = JSON.parse(blob);
      window.__say = []; window.__shout = []; window.__ans = [];
      window.__ev = [];
      window.__hook = (el, tag) => {
        if (!el) return;
        ['keydown', 'keyup', 'beforeinput', 'compositionstart', 'compositionend', 'input'].forEach((t) => {
          el.addEventListener(t, (e) => {
            window.__ev.push({ tag: tag, type: t, key: e.key || null, keyCode: e.keyCode != null ? e.keyCode : null, shiftKey: e.shiftKey === true, isComposing: e.isComposing === true, inputType: e.inputType || null, v: (e.target && e.target.value) ? String(e.target.value).slice(0, 12) : null });
          }, true);
        });
      };
      HP.App.rpc = async (op, args) => {
        if (op === 'talk.roles') return B.roles;
        if (op === 'talk.sessions') return { sessions: [] };
        if (op === 'talk.since') return { messages: [{ id: 9001, from: 'pipeline.author', to: 'me', kind: 'private', topic: '', body: 'R41-群里的话', at: 1790260000 }], last: 9001 };
        if (op === 'talk.asks') return { count: 1, asks: [{ id: 42, from: 'pipeline.author', topic: '【授权】R41', body: '【授权】来自 pipeline.author\n要不要授权？' }] };
        if (op === 'talk.thread') return { items: [{ who: 'him', body: 'R41-他说的', at: 1790260000 }] };
        if (op === 'talk.say') { window.__say.push(args); return { delivered: true, ms: 1111 }; }
        if (op === 'talk.shout') { window.__shout.push(args); return { results: [{ role: 'pipeline.author', delivered: true, ms: 1111 }] }; }
        if (op === 'talk.answer') { window.__ans.push(args); return { ok: true }; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      window.__t = HP.Talk;
    }, JSON.stringify({ roles: { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: [] }] }], channels: {} } }));

    const visible = (id) => page.evaluate((i) => { const els = [...document.querySelectorAll('#' + i)]; const el = els.find((e) => e.getBoundingClientRect().height > 0) || els[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; }, id);
    const snap = () => page.evaluate(() => ({
      ev: window.__ev.slice(-14), evCount: window.__ev.length,
      say: window.__say.slice(), shout: window.__shout.slice(), ans: window.__ans.slice(),
      bubbles: document.querySelectorAll('#tk-chat .tk-bub').length,
      streamBubbles: document.querySelectorAll('#tk-stream .tk-bub').length,
      vals: { sayin: (document.querySelector('#tk-sayin') || {}).value || null, shoutin: (document.querySelector('#tk-shoutin') || {}).value || null, askin: (document.querySelector('.tk-askin') || {}).value || null }
    }));
    try {
      /* ---------- 主块①单聊 ---------- */
      await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author'); await new Promise((r) => setTimeout(r, 1500)); window.__hook(document.querySelector('#tk-sayin'), 'sayin'); window.__ev = []; });
      const sin = await visible('tk-sayin');
      tap(sin.x, sin.y); await page.waitForTimeout(1200);
      text('R41say'); await page.waitForTimeout(500);
      out.single_beforeEnter = await snap();
      /* ① Gboard 软键盘的回车键：先看看键盘在不在、回车键在哪 */
      out.kbProbe = (() => {
        const xml = kbDump();
        const keys = [...xml.matchAll(/<node[^>]*(?:content-desc|resource-id)="([^"]*)"[^>]*bounds="(\[[0-9,]+,\d+\]\[[0-9,]+,\d+\])"/g)].map((m) => ({ id: m[1], b: m[2] })).filter((k) => /enter|send|ime_action|key_enter/i.test(k.id));
        return { found: keys.slice(0, 6), kbVisible: /com.google.android.inputmethod|KeyboardView|keyboard/i.test(xml) };
      })();
      /* ② 系统按键路径：keyevent 66（真按键事件） */
      key(66); await page.waitForTimeout(1200);
      out.single_keyevent66 = await snap();
      /* ③ 同一次回车不出两条：3 连击（<400ms） */
      await page.evaluate(() => { window.__hook(document.querySelector('#tk-sayin'), 'sayin'); window.__ev = []; });
      const sin2 = await visible('tk-sayin');
      tap(sin2.x, sin2.y); await page.waitForTimeout(900); text('R41burst'); await page.waitForTimeout(400);
      key(66); key(66); key(66); await page.waitForTimeout(1400);
      out.single_burst3 = await snap();
      /* ④ 间隔 600ms 两次 → 期望两条 */
      await page.evaluate(() => { window.__ev = []; });
      const sin3 = await visible('tk-sayin');
      tap(sin3.x, sin3.y); await page.waitForTimeout(800); text('R41gap'); await page.waitForTimeout(400);
      key(66); await page.waitForTimeout(600); key(66); await page.waitForTimeout(1400);
      out.single_gap600 = await snap();
      /* ⑤ Shift+Enter（模拟实体键盘）不该发、文字要留着 */
      await page.evaluate(() => { window.__ev = []; });
      const sin4 = await visible('tk-sayin');
      tap(sin4.x, sin4.y); await page.waitForTimeout(800); text('R41shift'); await page.waitForTimeout(400);
      out.beforeShift = await snap();
      combo(59, 66); await page.waitForTimeout(1200);
      out.single_shiftEnter = await snap();
      /* ---------- 主块②群聊 ---------- */
      await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 1500)); window.__hook(document.getElementById('tk-shoutin'), 'shoutin'); window.__ev = []; });
      const gin = await visible('tk-shoutin');
      tap(gin.x, gin.y); await page.waitForTimeout(900); text('R41shout'); await page.waitForTimeout(400);
      out.group_beforeEnter = await snap();
      key(66); await page.waitForTimeout(1400);
      out.group_keyevent66 = await snap();
      /* ---------- 跨块⑧频道页：授权框 ---------- */
      await page.evaluate(async () => { HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel'; await new Promise((r) => setTimeout(r, 1800)); window.__hook(document.querySelector('.tk-askin'), 'askin'); window.__ev = []; });
      const ask = await page.evaluate(() => { const el = document.querySelector('.tk-askin'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), askId: (el.closest('[data-ask]') || {}).getAttribute ? el.closest('[data-ask]').getAttribute('data-ask') : null }; });
      out.askBox = ask;
      if (ask) { tap(ask.x, ask.y); await page.waitForTimeout(900); text('R41answer'); await page.waitForTimeout(400); key(66); await page.waitForTimeout(1400); }
      out.ask_afterEnter = await snap();
      out.chrome = await page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: vis('keybar'), composer: vis('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
