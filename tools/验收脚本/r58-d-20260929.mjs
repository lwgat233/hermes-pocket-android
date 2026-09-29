/* R58 复测 D：先关掉残留浮层 → attach hptarget → 展开/收起 ×3 → 前提自检 → 点终端三拍 → 重画 ×3 → 上翻 600 */
export default {
  name: 'r58-d',
  check: async (page) => {
    const R = {};
    const snap = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display, visible: r.height > 0 && getComputedStyle(el).display !== 'none' }; };
      const v = q('.xterm-viewport');
      return {
        vp: v ? { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null,
        panner: box(q('#panner')), bodyClass: document.body.className,
        btnTerm: (() => { const b = q('#btn-term'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), box: box(b), pt: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }; })(),
        overlays: [...document.querySelectorAll('#overlay,#sheet,.hp-dialog,.panel')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => ({ id: e.id || '', cls: e.className || '', h: Math.round(e.getBoundingClientRect().height) })),
        xterm: document.querySelectorAll('.xterm').length,
        sessionOpen: (window.HP.App.__cnt || 0),
        termText: ((q('#termsizer') || {}).innerText || '').split('\n').filter((l) => l.trim()).slice(-3).join(' | '),
      };
    });
    const topOf = async (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), h: Math.round(r.height) }; }, sel);
    try {
      await page.evaluate(() => { const A = window.HP.App; if (!A.__cnt) { A.__cnt = 0; const o = A.rpc.bind(A); A.rpc = async (m, p) => { if (m === 'session.open') A.__cnt++; return o(m, p); }; } return 1; });
      R['01_起始'] = await snap();
      // 关掉残留浮层
      for (let i = 0; i < 4; i += 1) {
        const did = await page.evaluate(() => {
          const A = window.HP.App; const done = [];
          for (const m of ['closePanel', 'closeSheet', 'closeOverlay', 'hidePanel']) { if (typeof A[m] === 'function') { try { A[m](); done.push(m); } catch (e) { } } }
          const ov = document.querySelector('#overlay'); if (ov && getComputedStyle(ov).display !== 'none') { ov.style.display = 'none'; done.push('overlay.display=none'); }
          return done;
        });
        await page.waitForTimeout(400);
        const s = await snap();
        if (!s.overlays.length) { R['02_浮层已清'] = { i, did }; break; }
        R['02_浮层' + i] = { did, overlays: s.overlays };
        const x = await topOf('#overlay button[class*=close], #sheet .close, .hp-dialog .close');
        if (x) await page.tap(x.x, x.y);
        await page.waitForTimeout(400);
      }
      R['03_清后'] = await snap();
      // 连接 + attach
      await page.evaluate(async () => { const A = window.HP.App; const hs = await A.rpc('host.list'); const h = (hs || []).find((x) => x.name === 'R58靶机'); if (h) { await A.connect(h.id); await new Promise((r) => setTimeout(r, 9000)); } await HP.Sessions.refresh().catch(() => { }); await page_eval_close(A); function page_eval_close(A2) { try { A2.closePanel && A2.closePanel(); } catch (e) { } } return 1; });
      await page.waitForTimeout(2000);
      R['04_连接后'] = await snap();
      R['05_attach'] = await page.evaluate(() => { const ok = HP.Sessions.attach('hptarget'); try { HP.App.closePanel && HP.App.closePanel(); } catch (e) { } return { ok, sel: HP.Sessions.sel }; });
      await page.waitForTimeout(4000);
      R['06_attach后'] = await snap();
      // 展开
      let s = await snap();
      R['07_展开前'] = { panner: s.panner, btn: s.btnTerm && s.btnTerm.text };
      if (s.btnTerm) { await page.tap(s.btnTerm.pt.x, s.btnTerm.pt.y); await page.waitForTimeout(1500); R['08_展开后'] = await snap(); }
      s = await snap();
      R['08b_展开后panner'] = s.panner;
      if (s.btnTerm) { await page.tap(s.btnTerm.pt.x, s.btnTerm.pt.y); await page.waitForTimeout(1500); R['09_收起后'] = await snap(); }
      R['10_三次开合'] = [];
      for (let i = 0; i < 3; i += 1) {
        let a = await snap(); const d0 = a.sessionOpen;
        await page.tap(a.btnTerm.pt.x, a.btnTerm.pt.y); await page.waitForTimeout(1200);
        const o = await snap();
        a = await snap();
        await page.tap(a.btnTerm.pt.x, a.btnTerm.pt.y); await page.waitForTimeout(1200);
        const c = await snap();
        R['10_三次开合'].push({ i, 展开高: o.panner && o.panner.h, 展开后离底: o.vp && o.vp.bottom, 收起高: c.panner && c.panner.h, xterm: c.xterm, openDelta: c.sessionOpen - d0 });
        if (i === 0) R['11_展开时vp'] = o.vp;
      }
      // 展开着做后面的
      let a2 = await snap();
      if (a2.btnTerm && a2.panner && a2.panner.h === 0) { await page.tap(a2.btnTerm.pt.x, a2.btnTerm.pt.y); await page.waitForTimeout(1500); }
      a2 = await snap();
      R['12_展开态'] = { panner: a2.panner, vp: a2.vp, termText: a2.termText, xterm: a2.xterm };
      R['13_前提'] = { 有滚动空间: !!((a2.vp || {}).sh > (a2.vp || {}).ch), sh: a2.vp && a2.vp.sh, ch: a2.vp && a2.vp.ch };
      await page.swipe(200, 420, 300); await page.waitForTimeout(600);
      R['14_上翻后'] = await snap();
      await page.tap(200, 420);
      const p1 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(130);
      const p2 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(880);
      const p3 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      R['15_点终端三拍'] = { 同拍: p1, 两帧后: p2, 一秒后: p3 };
      R['16_重画前'] = (await snap()).vp;
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
