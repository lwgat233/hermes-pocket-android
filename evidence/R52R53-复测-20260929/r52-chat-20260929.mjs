/* R52R53 复测① ②：状态图标读数（三星）+ #tk-sends + R-39/R-41 回归 */
export default {
  name: 'r52-chat',
  check: async (page) => {
    const R = {};
    const readChat = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const ic = [...document.querySelectorAll('.tk-ic, [class*="tk-ic"]')];
      const bubs = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const seen = new Map();
      for (const b of bubs) { const k = b.getAttribute('data-msg') || b.textContent.slice(0, 24); if (!seen.has(k)) seen.set(k, b); }
      const uniq = [...seen.values()];
      const rows = uniq.map((b) => { const r = b.getBoundingClientRect(); return { id: b.getAttribute('data-msg'), h: Math.round(r.height), cls: b.className.slice(0, 40) }; });
      const c = q('#tk-chat');
      const say = q('#tk-sayline');
      const last = uniq[uniq.length - 1];
      const r1 = last ? last.getBoundingClientRect() : null;
      const r2 = say ? say.getBoundingClientRect() : null;
      return {
        containers: document.querySelectorAll('#tk-chat').length,
        bubbles: uniq.length, rows,
        icons: ic.map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className, w: Math.round(r.width), h: Math.round(r.height), note: e.getAttribute('data-note') || null }; }),
        sends: document.querySelectorAll('#tk-sends').length,
        sendsText: ((q('#tk-sends') || {}).innerText || '').slice(0, 60),
        pad: c ? getComputedStyle(c).paddingBottom : null,
        gap: r1 && r2 ? +(r2.top - r1.bottom).toFixed(1) : null,
        askin: (() => { const a = q('.tk-askin'); if (!a) return null; const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        visibleButtons: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()).slice(0, 8),
      };
    });
    try {
      await page.evaluate(async () => { await HP.Sessions.refresh().catch(() => { }); HP.Sessions.attach('r52t'); try { HP.App.closePanel(); } catch (e) { } return 1; });
      await page.waitForTimeout(3500);
      R['01_attach'] = await page.evaluate(() => ({ sel: HP.Sessions.sel, badge: (document.getElementById('tb-badge') || {}).textContent }));
      await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
      await page.waitForTimeout(5000);
      R['02_状态读数'] = await readChat();
      // 等一次重画再读（作者的既有现象：首屏两份 #tk-chat）
      await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talks'); HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
      await page.waitForTimeout(3500);
      R['03_重画后'] = await readChat();
    } catch (e) { R.__err = String(e).slice(0, 250); }
    return R;
  },
};
