/* R-42 复测 · 主块⑧频道页（角色列表）+ 跨块①单聊（信息窗/单聊共用，入口变了要回头量）
 * 真触摸：adb shell input tap（系统触摸链路）+ input keyevent 66（R-41 成果串联）
 * 数据：本机现取的平台真回包（fixture-*-当前.json，来自 R40-复测2 目录）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r42-reprobe-20260925.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const key = (c) => sh(`input keyevent ${c}`);
const F = '/vol1/1000/airesults/hermes-pocket/evidence/R40-复测2-20260925/';
const ROLES = JSON.parse(readFileSync(F + 'fixture-roles-json-当前.json', 'utf8'));
const SESS = JSON.parse(readFileSync(F + 'fixture-sessions-json-当前.json', 'utf8'));
const TMUX = readFileSync(F + 'fixture-tmux-list-当前.txt', 'utf8');

export default {
  name: 'R42-复测-频道页一步进单聊',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate((blob) => {
      const B = JSON.parse(blob);
      window.__say = []; window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push(String(e.message).slice(0, 120)));
      HP.App.rpc = async (op, a) => {
        if (op === 'talk.roles') return B.roles;
        if (op === 'talk.sessions') return B.sess;
        if (op === 'tmux.list') return { raw: B.tmux };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: [{ who: 'him', body: 'R42-他说的', at: 1790260000 }] };
        if (op === 'talk.say') { window.__say.push(a); return { delivered: true, ms: 1234 }; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    }, JSON.stringify({ roles: ROLES, sess: SESS, tmux: TMUX }));
    const state = () => page.evaluate(() => ({
      boardsVisible: [...document.querySelectorAll('[id^="tab-"]')].filter((e) => e.getClientRects().length).map((e) => e.id),
      view: HP.Talk.view, tab: HP.Talk.tab, sheet: !!document.querySelector('.tk-sheetcard'),
      sayin: !!document.querySelector('#tk-sayin'), titleText: (() => { const t = document.querySelector('.tk-title'); return t ? t.textContent.trim() : null; })(),
      bubs: document.querySelectorAll('#tk-chat .tk-bub').length,
      sendRows: [...document.querySelectorAll('#tk-sends .tk-sendrow')].map((r) => (r.querySelector('.tk-sendtext') || {}).textContent),
      sayCount: window.__say.length, sayArgs: window.__say.slice(-2)
    }));
    try {
      /* 进频道页（角色列表） */
      await page.evaluate(async () => { HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel'; await new Promise((r) => setTimeout(r, 2200)); });
      /* ---- 5) 行高 / 热区几何（px 与 dp）---- */
      out.geometry = await page.evaluate(() => {
        const card = document.querySelector('[data-role="owner.me"]') || document.querySelector('[data-role]');
        const chrow = document.querySelector('.tk-chrow');
        const hit = card ? card.querySelector('.tk-carethit') : null;
        const g = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, dp: { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } }; };
        const hitRect = hit ? hit.getBoundingClientRect() : null;
        const cardRect = card.getBoundingClientRect();
        const cx = Math.round(hitRect.x + hitRect.width / 2), cy = Math.round(hitRect.y + hitRect.height / 2);
        const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className).split(' ').slice(0, 2).join('.') : null; };
        return {
          viewport: { w: window.innerWidth, h: window.innerHeight },
          card: g(card), chrow: g(chrow), caretHit: g(hit),
          caretHitDevice: { x: Math.round((hitRect.x + hitRect.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (hitRect.y + hitRect.height / 2) * (2138 / window.innerHeight)) },
          cardNameDevice: { x: Math.round((cardRect.x + 60) * (1080 / window.innerWidth)), y: Math.round(136 + (cardRect.y + cardRect.height / 2) * (2138 / window.innerHeight)) },
          hitProbe: {
            cornerTL: at(Math.round(hitRect.x + 2), Math.round(hitRect.y + 2)),
            cornerTR: at(Math.round(hitRect.right - 2), Math.round(hitRect.y + 2)),
            cornerBL: at(Math.round(hitRect.x + 2), Math.round(hitRect.bottom - 2)),
            cornerBR: at(Math.round(hitRect.right - 2), Math.round(hitRect.bottom - 2)),
            center: at(cx, cy)
          }
        };
      });
      /* ---- 2) 真触摸右缘热区 → 开信息窗且仍在频道页 ---- */
      const g = out.geometry;
      tap(g.caretHitDevice.x, g.caretHitDevice.y); await page.waitForTimeout(1100);
      out.afterCaretTap = await state();
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} }); await page.waitForTimeout(500);
      /* ---- 1) 真触摸卡片名称处 → 一步进单聊 ---- */
      tap(g.cardNameDevice.x, g.cardNameDevice.y); await page.waitForTimeout(1600);
      out.afterNameTap = await state();
      /* ---- 1b) 接着真按键回车发一条（串 R-41）---- */
      out.beforeEnter = await state();
      const sin = await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); if (!el) return null; const r = el.getBoundingClientRect(); el.value = 'R42-一步进单聊-回车'; return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      if (sin) { tap(sin.x, sin.y); await page.waitForTimeout(900); key(66); await page.waitForTimeout(1500); }
      out.afterEnter = await state();
      /* ---- 3) R-37 回归：单聊页点抬头开信息窗 ---- */
      const t = await page.evaluate(() => { const el = document.querySelector('.tk-title'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      if (t) { tap(t.x, t.y); await page.waitForTimeout(1000); }
      out.afterTitleTap = await state();
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} }); await page.waitForTimeout(400);
      /* ---- 4) R-40 口径回声：卡片副行 / 信息窗会话行 ---- */
      out.display = await page.evaluate(async () => {
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 1800));
        const cards = [...document.querySelectorAll('[data-role]')].map((c) => ({ role: c.getAttribute('data-role'), sub: (c.querySelector('.sub') || {}).textContent || null }));
        const read = (full) => { HP.Talk.openRoleSheet(full); const d = document.querySelector('.tk-sheetcard'); const rows = d ? [...d.querySelectorAll('.tk-sheetrow')].map((x) => ({ k: x.querySelector('.tk-k').textContent, v: x.querySelector('.tk-v').textContent })) : []; HP.Talk.closeSheet(); return { full, 会话行: (rows.find((r) => r.k === '会话') || {}).v || null }; };
        return { cards, sheets: ['owner.me', 'pipeline.tester', 'home.maid'].map(read) };
      });
      out.chrome = await page.evaluate(() => { const v = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: v('keybar'), composer: v('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
