/* R58 复测 A：默认态 → attach hptarget → 前提自检 → 真触摸展开/收起 ×3 → 点终端三拍 → 真滑上翻 600 */
export default {
  name: 'r58-a',
  check: async (page) => {
    const R = {};
    const read = async () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display, visible: r.height > 0 && getComputedStyle(el).display !== 'none' }; };
      const v = q('.xterm-viewport');
      const A = window.HP.App;
      return {
        vp: v ? { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null,
        panner: box(q('#panner')),
        bodyClass: document.body.className,
        btnTerm: (() => { const b = q('#btn-term') || [...document.querySelectorAll('button')].find((x) => /显示终端|隐藏终端/.test(x.textContent)); return b ? { text: b.textContent.trim(), box: box(b), rect: (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })() } : null; })(),
        topbar: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()),
        xterm: document.querySelectorAll('.xterm').length,
        sessionOpen: A.__cnt || 0,
        termHead: ((q('#termsizer') || {}).innerText || '').slice(0, 90).replace(/\n/g, ' | '),
      };
    });
    const btn = async () => (await read()).btnTerm;
    try {
      R['00_连接'] = await page.evaluate(async () => {
        const A = window.HP.App;
        const hosts = await A.rpc('host.list').catch(() => []);
        const h = (hosts || []).find((x) => x.name === 'R58靶机');
        if (!h) return { err: 'no R58靶机', hosts: (hosts || []).map((x) => x.name) };
        await A.connect(h.id);
        await new Promise((r) => setTimeout(r, 12000));
        await HP.Sessions.refresh().catch(() => { });
        return { hostId: h.id, alive: !!(A.transport && A.transport.alive), title: (document.getElementById('tb-title') || {}).textContent, badge: (document.getElementById('tb-badge') || {}).textContent, sessions: (HP.Sessions.list || []).map((x) => x.name) };
      });
      await page.evaluate(() => { const A = window.HP.App; if (!A.__cnt) { A.__cnt = 0; const o = A.rpc.bind(A); A.rpc = async (m, p) => { if (m === 'session.open') A.__cnt++; return o(m, p); }; } return 1; });
      R['01_默认态'] = await read();
      R['02_会话清单'] = await page.evaluate(async () => { await HP.Sessions.refresh(); return { list: HP.Sessions.list.map((x) => x.name), count: HP.Sessions.list.length }; });
      R['03_attach'] = await page.evaluate(() => ({ ok: HP.Sessions.attach('hptarget'), sel: HP.Sessions.sel }));
      await page.waitForTimeout(4000);
      R['04_连接后'] = await read();
      R['05_前提_有滚动空间'] = ((R['04_连接后'].vp || {}).sh || 0) > ((R['04_连接后'].vp || {}).ch || 0);
      let b = await btn();
      R['06_展开按钮'] = b;
      if (b) { await page.tap(b.rect.x, b.rect.y); await page.waitForTimeout(1200); R['07_展开后'] = await read();
        b = await btn(); if (b) { await page.tap(b.rect.x, b.rect.y); await page.waitForTimeout(1200); R['08_收起后'] = await read(); } }
      R['09_三次开合'] = [];
      for (let i = 0; i < 3; i += 1) {
        b = await btn(); if (!b) break;
        await page.tap(b.rect.x, b.rect.y); await page.waitForTimeout(1000);
        const open = await read();
        b = await btn();
        await page.tap(b.rect.x, b.rect.y); await page.waitForTimeout(1000);
        const shut = await read();
        R['09_三次开合'].push({ i, 展开: open.panner, 展开后离底: open.vp && open.vp.bottom, 收起: shut.panner, xterm: shut.xterm, sessionOpen: shut.sessionOpen });
        if (i === 0) R['10_展开时离底'] = open.vp;
      }
      b = await btn();
      if (b) { await page.tap(b.rect.x, b.rect.y); await page.waitForTimeout(1200); }
      R['11_展开后基准'] = await read();
      // 真手指上滑（页面坐标在 ~393×778 内）
      await page.swipe(200, 420, 320);
      await page.waitForTimeout(600);
      R['12_上翻后'] = await read();
      const t0 = Date.now();
      await page.tap(200, 420);
      const inst = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(120);
      const f2 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(880);
      const f1 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      R['13_点终端三拍'] = { 同拍: inst, 两帧后: f2, 一秒后: f1, 耗时ms: Date.now() - t0 };
      R['14_重画前'] = await read();
      R['15_重画'] = [];
      for (let i = 0; i < 3; i += 1) {
        const did = await page.evaluate(() => {
          const A = window.HP.App; const used = [];
          for (const m of ['resetGeometry', 'fit', 'resize', 'applyTermPane', 'showBoard', 'render']) {
            if (typeof A[m] === 'function') { try { A[m](m === 'showBoard' ? 'term' : undefined); used.push(m); } catch (e) { } }
          }
          return used;
        });
        await page.waitForTimeout(700);
        const r = await read();
        R['15_重画'].push({ i, used: did, st: r.vp && r.vp.st, bottom: r.vp && r.vp.bottom });
      }
      R['16_留现场_上翻600'] = await page.evaluate(() => {
        const v = document.querySelector('.xterm-viewport');
        if (v) v.scrollTop = Math.max(0, v.scrollTop - 600);
        return v ? { st: v.scrollTop, sh: v.scrollHeight, ch: v.clientHeight, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null;
      });
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
