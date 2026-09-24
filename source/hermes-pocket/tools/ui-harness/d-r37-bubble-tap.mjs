/* R-37 定位探针：单聊页点「消息头/气泡」到底能不能开信息窗，以及**候选改法**的三条负向。
 * 做法：① 现状 —— 用 CDP 派**真触摸**点非本人气泡 / 抬头，看 #tk-sheet 出不出来；
 *       ② 注入候选改法（**只在页面里挂监听，工程文件不动**：非本人气泡 + 抬头 → openRoleSheet，带 8px 位移守卫）；
 *       ③ 三条负向实测：点本人气泡 / 点空白 / 拖 80px（滚动）都不该开窗，且滚动照常。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r37-bubble-tap.mjs
 * 夹具：evidence/R37-定位-20260924/fixtures/{roles-json,sessions-json,thread-home.maid}.json（平台真实回包）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R37-定位-20260924/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const ROLES = read('roles-json.json');
const SESS = read('sessions-json.json');
const THREAD = read('thread-home.maid.json');

export default {
  name: 'R-37 定位：单聊点气泡/抬头开信息窗（含三条负向实测）',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    /* 桥：喂真回包 */
    await page.evaluate(({ ROLES, SESS, THREAD }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.thread') { setTimeout(() => reply(m._rid, THREAD), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS, THREAD });

    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); });
    await page.evaluate(() => HP.Talk.openRole('home.maid'));
    await page.waitForTimeout(1200);

    /* CDP 真触摸：tap / drag */
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const tap = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(350);
    };
    const drag = async (x, y, dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 6 }] });
        await page.waitForTimeout(20);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(400);
    };
    const sheet = () => page.evaluate(() => {
      const s = document.querySelector('#tk-sheet .tk-sheetcard');
      const rows = s ? [...s.querySelectorAll('.tk-sheetrow')].slice(0, 2).map((r) => (r.querySelector('.tk-k') || {}).textContent + '=' + ((r.querySelector('.tk-v') || {}).textContent)) : null;
      return { 窗在: !!document.querySelector('#tk-sheet'), 首两行: rows };
    });
    const close = async () => { await page.evaluate(() => HP.Talk.closeSheet()); await page.waitForTimeout(200); };
    const where = () => page.evaluate(() => {
      const pt = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
      const him = [...document.querySelectorAll('#tk-chat .tk-bub.him')];
      const mine = [...document.querySelectorAll('#tk-chat .tk-bub.me')];
      const box = document.querySelector('#tk-chat');
      const h = him[him.length - 1]; const m = mine[mine.length - 1];
      if (h) h.scrollIntoView({ block: 'center' });
      return {
        他人气泡数: him.length, 本人气泡数: mine.length,
        他人气泡: h ? pt(h) : null, 本人气泡: m ? pt(m) : null,
        抬头: (() => { const t = document.querySelector('.tk-title'); return t ? pt(t) : null; })(),
        空白: (() => {                       /* 真空白：扫一个 elementFromPoint 命中 #tk-chat 本身（不是气泡）的点 */
          if (!box) return null;
          const b = box.getBoundingClientRect();
          for (let y = b.bottom - 18; y > b.top + 18; y -= 12) {
            for (let x = b.right - 6; x > b.left + 6; x -= 12) {
              const el = document.elementFromPoint(x, y);
              if (el === box) return { x: Math.round(x), y: Math.round(y), 命中: 'tk-chat(容器本身)' };
            }
          }
          return null;
        })(),
        点上的东西: (() => { const f = (o) => o ? ((document.elementFromPoint(o.x, o.y) || {}).className || 'null').toString().slice(0, 24) : null; return { 他人气泡: f(h ? pt(h) : null), 本人气泡: f(m ? pt(m) : null) }; })(),
        聊天区可滚: box ? (box.scrollHeight > box.clientHeight) : null,
        scrollTop: box ? Math.round(box.scrollTop) : null,
        滚动上限: box ? Math.round(box.scrollHeight - box.clientHeight) : null
      };
    });

    const p = await where();
    out.现场 = p;

    /* ① 现状：点非本人气泡 / 抬头 */
    if (p.他人气泡) { await tap(p.他人气泡.x, p.他人气泡.y); out['现状_点他人气泡'] = await sheet(); await close(); }
    if (p.抬头) { await tap(p.抬头.x, p.抬头.y); out['现状_点抬头'] = await sheet(); await close(); }

    /* ② 注入候选改法（只在页面里：非本人气泡 + 抬头 → openRoleSheet，带 8px 位移守卫） */
    out.注入的改法 = await page.evaluate(() => {
      const T = HP.Talk;
      const role = (T.sel || {}).full_name;
      let sx = 0, sy = 0, moved = false;
      document.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; moved = false; }, { passive: true, capture: true });
      document.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (Math.abs(t.clientX - sx) > 8 || Math.abs(t.clientY - sy) > 8) moved = true; }, { passive: true, capture: true });
      window.__r37 = { moved: () => moved };
      const bind = (el) => el && el.addEventListener('click', () => { if (window.__r37.moved()) return; T.openRoleSheet(role); });
      document.querySelectorAll('#tk-chat .tk-bub.him').forEach((b) => { b.setAttribute('data-from', role); bind(b); });
      bind(document.querySelector('.tk-title'));
      return { 角色: role, 挂了几个他人气泡: document.querySelectorAll('#tk-chat .tk-bub.him').length, 抬头挂了: !!document.querySelector('.tk-title'), 容器没挂: true };
    });

    /* ③ 注入后实测：三条正/负向 */
    if (p.他人气泡) { await tap(p.他人气泡.x, p.他人气泡.y); out['改法后_点他人气泡'] = await sheet(); await close(); }
    if (p.抬头) { await tap(p.抬头.x, p.抬头.y); out['改法后_点抬头'] = await sheet(); await close(); }
    if (p.本人气泡) { await tap(p.本人气泡.x, p.本人气泡.y); out['负向_点本人气泡'] = await sheet(); await close(); }
    if (p.空白) { await tap(p.空白.x, p.空白.y); out['负向_点空白'] = await sheet(); await close(); }
    if (p.他人气泡) {
      const before = await page.evaluate(() => Math.round(document.querySelector('#tk-chat').scrollTop));
      await drag(p.他人气泡.x, Math.min(p.他人气泡.y, 400), -80);     /* 从气泡上开始拖，模拟滚动手势 */
      const after = await page.evaluate(() => Math.round(document.querySelector('#tk-chat').scrollTop));
      out['负向_在气泡上拖80px'] = { ...(await sheet()), 拖前scrollTop: before, 拖后scrollTop: after, 护栏记到了位移: await page.evaluate(() => window.__r37.moved()) };
      await close();
    }
    return out;
  }
};
