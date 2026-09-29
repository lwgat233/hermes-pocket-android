/* R58 复测 E：从 tmux 里 detach → 普通 shell 里起靶子（内容超一屏）→ 前提自检 → 展开/收起 ×3 → 点终端三拍 → 重画 ×3 → 上翻留现场 */
export default {
  name: 'r58-e',
  check: async (page) => {
    const R = {};
    const cmd = 'R49_LOG=/tmp/r58-probe.log python3 -u /vol1/1000/aicache/tmp/r58-target.py';
    const snap = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display, visible: r.height > 0 && getComputedStyle(el).display !== 'none' }; };
      const v = q('.xterm-viewport');
      return {
        vp: v ? { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null,
        panner: box(q('#panner')), bodyClass: document.body.className,
        btnTerm: (() => { const b = q('#btn-term'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), pt: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }; })(),
        overlays: [...document.querySelectorAll('#overlay,#sheet,.hp-dialog,.panel')].filter((e) => e.getBoundingClientRect().height > 0).length,
        xterm: document.querySelectorAll('.xterm').length,
        sessionOpen: (window.HP.App.__cnt || 0),
        badge: (document.getElementById('tb-badge') || {}).textContent,
        tail: ((q('#termsizer') || {}).innerText || '').split('\n').filter((l) => l.trim()).slice(-2).join(' | ').slice(0, 160),
      };
    });
    try {
      await page.evaluate(() => { const A = window.HP.App; if (!A.__cnt) { A.__cnt = 0; const o = A.rpc.bind(A); A.rpc = async (m, p) => { if (m === 'session.open') A.__cnt++; return o(m, p); }; } try { A.closePanel && A.closePanel(); } catch (e) { } return 1; });
      R['01_起始'] = await snap();
      // detach tmux（Ctrl-b d）
      await page.evaluate(() => { window.HP.App.send('\x02d'); return 1; });
      await page.waitForTimeout(3000);
      R['02_detach后'] = await snap();
      // 在普通 shell 里起靶子
      await page.evaluate((c) => { window.HP.App.send(c + '\r'); return 1; }, cmd);
      await page.waitForTimeout(8000);
      R['03_靶子起后'] = await snap();
      // 确保展开
      let s = await snap();
      if (s.btnTerm && s.panner && s.panner.h === 0) { await page.tap(s.btnTerm.pt.x, s.btnTerm.pt.y); await page.waitForTimeout(1500); }
      await page.waitForTimeout(500);
      s = await snap();
      R['04_展开态'] = s;
      R['05_前提'] = { 有滚动空间: !!((s.vp || {}).sh > (s.vp || {}).ch), sh: s.vp && s.vp.sh, ch: s.vp && s.vp.ch, 行高约: s.vp && s.vp.ch ? +( ((s.vp.sh - s.vp.ch) / 300).toFixed(2) ) : null };
      // ② 展开/收起（内容超一屏）
      let b = await snap();
      R['06_收起一次'] = await (async () => { await page.tap(b.btnTerm.pt.x, b.btnTerm.pt.y); await page.waitForTimeout(1200); return snap(); })();
      b = await snap();
      R['07_再展开'] = await (async () => { await page.tap(b.btnTerm.pt.x, b.btnTerm.pt.y); await page.waitForTimeout(1200); return snap(); })();
      // ③ 三次开合
      R['08_三次开合'] = [];
      for (let i = 0; i < 3; i += 1) {
        let a = await snap(); const d0 = a.sessionOpen;
        await page.tap(a.btnTerm.pt.x, a.btnTerm.pt.y); await page.waitForTimeout(1200);
        const o = await snap();
        a = await snap();
        await page.tap(a.btnTerm.pt.x, a.btnTerm.pt.y); await page.waitForTimeout(1200);
        const c = await snap();
        R['08_三次开合'].push({ i, 展开高: o.panner && o.panner.h, 展开后离底: o.vp && o.vp.bottom, 展开后sh: o.vp && o.vp.sh, 收起高: c.panner && c.panner.h, xterm: c.xterm, openDelta: c.sessionOpen - d0 });
      }
      // 展开着继续
      let a2 = await snap();
      if (a2.panner && a2.panner.h === 0) { await page.tap(a2.btnTerm.pt.x, a2.btnTerm.pt.y); await page.waitForTimeout(1500); }
      // B④：先上翻（真手势），再点终端 ⇒ 三拍
      await page.swipe(200, 420, 300); await page.waitForTimeout(600);
      R['09_上翻后'] = await snap();
      await page.tap(200, 420);
      const p1 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(130);
      const p2 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      await page.waitForTimeout(880);
      const p3 = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
      R['10_点终端三拍'] = { 同拍: p1, 两帧后: p2, 一秒后: p3 };
      // B⑥ 三次重画
      R['11_重画前'] = (await snap()).vp;
      R['12_重画'] = [];
      for (let i = 0; i < 3; i += 1) {
        const used = await page.evaluate(() => { const A = window.HP.App; const u = []; for (const m of ['resetGeometry', 'applyTermPane', 'showBoard']) { if (typeof A[m] === 'function') { try { A[m](m === 'showBoard' ? 'term' : undefined); u.push(m); } catch (e) { } } } return u; });
        await page.waitForTimeout(800);
        const r = await snap();
        R['12_重画'].push({ i, used, st: r.vp && r.vp.st, bottom: r.vp && r.vp.bottom });
      }
      // B⑤：真手上翻，然后留现场给宿主灌 40 行
      await page.swipe(200, 420, 300); await page.waitForTimeout(400);
      await page.swipe(200, 420, 300); await page.waitForTimeout(600);
      R['13_上翻600留现场'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { st: v.scrollTop, sh: v.scrollHeight, ch: v.clientHeight, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; });
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
