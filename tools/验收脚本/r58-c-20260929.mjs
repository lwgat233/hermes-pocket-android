/* R58 复测 C：信任主机键 → attach hptarget → 前提自检 → 展开/收起 ×3 → 点终端三拍 → 重画 ×3 → 上翻 600 */
export default {
  name: 'r58-c',
  check: async (page) => {
    const R = {};
    const snap = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display, visible: r.height > 0 && getComputedStyle(el).display !== 'none' }; };
      const v = q('.xterm-viewport');
      return {
        vp: v ? { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null,
        panner: box(q('#panner')), bodyClass: document.body.className,
        btnTerm: (() => { const b = q('#btn-term') || [...document.querySelectorAll('button')].find((x) => /显示终端|隐藏终端/.test(x.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), box: box(b), pt: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }; })(),
        dialogs: [...document.querySelectorAll('button')].filter((b) => /信任并保存|信任|继续/.test(b.textContent) && b.getBoundingClientRect().height > 0).map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), pt: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }; }),
        overlayOpen: [...document.querySelectorAll('#overlay,.hp-dialog,[class*=sheet]')].filter((e) => e.getBoundingClientRect().height > 0).length,
        xterm: document.querySelectorAll('.xterm').length,
        sessionOpen: (window.HP.App.__cnt || 0),
        termHead: ((q('#termsizer') || {}).innerText || '').slice(0, 120).replace(/\n/g, ' | '),
      };
    });
    const tapText = async (re) => {
      const pt = await page.evaluate((rx) => {
        const b = [...document.querySelectorAll('button,a')].filter((x) => new RegExp(rx).test(x.textContent) && x.getBoundingClientRect().height > 0)[0];
        if (!b) return null; const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: b.textContent.trim() };
      }, re);
      if (pt) { await page.tap(pt.x, pt.y); return pt; }
      return null;
    };
    try {
      await page.evaluate(() => { const A = window.HP.App; if (!A.__cnt) { A.__cnt = 0; const o = A.rpc.bind(A); A.rpc = async (m, p) => { if (m === 'session.open') A.__cnt++; return o(m, p); }; } return 1; });
      R['01_连接前'] = await snap();
      // 信任主机键（如果弹了）
      for (let i = 0; i < 3; i += 1) {
        const s = await snap();
        if (!s.dialogs.length) break;
        R['02_信任' + i] = await tapText('信任并保存|^信任$');
        await page.waitForTimeout(1500);
      }
      await page.evaluate(async () => { const A = window.HP.App; const hosts = await A.rpc('host.list'); const h = (hosts || []).find((x) => x.name === 'R58靶机'); if (h && !(A.transport && A.transport.alive)) { await A.connect(h.id); await new Promise((r) => setTimeout(r, 9000)); } await HP.Sessions.refresh().catch(() => { }); return 1; });
      await page.waitForTimeout(2500);
      R['03_连接后快照'] = await snap();
      R['04_attach'] = await page.evaluate(() => ({ ok: HP.Sessions.attach('hptarget'), sel: HP.Sessions.sel, list: HP.Sessions.list.map((x) => x.name) }));
      await page.waitForTimeout(4000);
      R['05_attach后快照'] = await snap();
      // 展开（真触摸）
      let s = await snap();
      R['06_展开前'] = s;
      if (s.btnTerm) { await page.tap(s.btnTerm.pt.x, s.btnTerm.pt.y); await page.waitForTimeout(1500); R['07_展开后'] = await snap(); }
      s = await snap();
      if (s.btnTerm) { await page.tap(s.btnTerm.pt.x, s.btnTerm.pt.y); await page.waitForTimeout(1500); R['08_收起后'] = await snap(); }
      R['09_三次开合'] = [];
      for (let i = 0; i < 3; i += 1) {
        let b = await snap(); const c0 = b.sessionOpen;
        await page.tap(b.btnTerm.pt.x, b.btnTerm.pt.y); await page.waitForTimeout(1200);
        const o = await snap();
        b = await snap();
        await page.tap(b.btnTerm.pt.x, b.btnTerm.pt.y); await page.waitForTimeout(1200);
        const c = await snap();
        R['09_三次开合'].push({ i, 展开高: o.panner && o.panner.h, 展开后离底: o.vp && o.vp.bottom, 收起高: c.panner && c.panner.h, xterm: c.xterm, openDelta: c.sessionOpen - c0 });
        if (i === 0) R['10_展开时vp'] = o.vp;
      }
      // 展开着做 B④
      let b = await snap();
      if (b.btnTerm && b.panner && b.panner.h === 0) { await page.tap(b.btnTerm.pt.x, b.btnTerm.pt.y); await page.waitForTimeout(1500); }
      R['11_展开态'] = await snap();
      R['12_前提_有滚动空间'] = !!((R['11_展开态'].vp || {}).sh > (R['11_展开态'].vp || {}).ch);
      R['13_内容首行'] = R['11_展开态'].termHead;
      // 真手指上滑 → 点终端 ⇒ 三拍
      await page.swipe(200, 420, 300);
      await page.waitForTimeout(600);
      R['14_上翻后'] = await snap();
      await page.tap(200, 420);
      const p1 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(130);
      const p2 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(880);
      const p3 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      R['15_点终端三拍'] = { 同拍: p1, 两帧后: p2, 一秒后: p3 };
      R['16_重画前'] = await snap();
      R['17_重画'] = [];
      for (let i = 0; i < 3; i += 1) {
        const used = await page.evaluate(() => { const A = window.HP.App; const u = []; for (const m of ['resetGeometry', 'applyTermPane', 'showBoard']) { if (typeof A[m] === 'function') { try { A[m](m === 'showBoard' ? 'term' : undefined); u.push(m); } catch (e) { } } } return u; });
        await page.waitForTimeout(800);
        const r = await snap();
        R['17_重画'].push({ i, used, st: r.vp && r.vp.st, bottom: r.vp && r.vp.bottom });
      }
      R['18_留现场_上翻600'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); if (v) v.scrollTop = Math.max(0, v.scrollTop - 600); return v ? { st: v.scrollTop, sh: v.scrollHeight, ch: v.clientHeight, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
