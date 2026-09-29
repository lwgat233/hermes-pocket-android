/* R52R53 复测① ②：先信任主机键 → attach r52t → 开聊天板块 → 读三态图标/#tk-sends/R-39/R-41 */
export default {
  name: 'r52-chat2',
  check: async (page) => {
    const R = {};
    const snap = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const ic = [...document.querySelectorAll('[class*="tk-ic"]')];
      const bubs = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const seen = new Map();
      for (const b of bubs) { const k = b.getAttribute('data-msg') || b.textContent.slice(0, 24); if (!seen.has(k)) seen.set(k, b); }
      const uniq = [...seen.values()];
      const c = q('#tk-chat'); const say = q('#tk-sayline');
      const last = uniq[uniq.length - 1];
      const r1 = last ? last.getBoundingClientRect() : null; const r2 = say ? say.getBoundingClientRect() : null;
      return {
        containers: document.querySelectorAll('#tk-chat').length, bubbles: uniq.length,
        ids: uniq.map((b) => b.getAttribute('data-msg')).slice(-6),
        rows: uniq.slice(-4).map((b) => ({ id: b.getAttribute('data-msg'), h: Math.round(b.getBoundingClientRect().height) })),
        icons: ic.map((e) => { const r = e.getBoundingClientRect(); return { cls: e.className, w: Math.round(r.width), h: Math.round(r.height), note: e.getAttribute('data-note') || null }; }),
        sends: document.querySelectorAll('#tk-sends').length, sendsText: ((q('#tk-sends') || {}).innerText || '').slice(0, 80),
        pad: c ? getComputedStyle(c).paddingBottom : null, gap: r1 && r2 ? +(r2.top - r1.bottom).toFixed(1) : null,
        askin: (() => { const a = q('.tk-askin'); if (!a) return null; const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        dialogs: [...document.querySelectorAll('button')].filter((b) => /信任/.test(b.textContent) && b.getBoundingClientRect().height > 0).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }),
      };
    });
    try {
      let s = await snap();
      for (let i = 0; i < 3 && s.dialogs.length; i += 1) {
        R['00_信任' + i] = s.dialogs[0];
        await page.tap(s.dialogs[0].x, s.dialogs[0].y);
        await page.waitForTimeout(2000);
        s = await snap();
      }
      await page.evaluate(async () => { try { HP.App.closePanel(); } catch (e) { } await HP.Sessions.refresh().catch(() => { }); HP.Sessions.attach('r52t'); return 1; });
      await page.waitForTimeout(4000);
      R['01_attach'] = await page.evaluate(() => ({ sel: HP.Sessions.sel, badge: (document.getElementById('tb-badge') || {}).textContent, connected: !!(HP.App.transport && HP.App.transport.alive) }));
      await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
      await page.waitForTimeout(7000);
      R['02_聊天页'] = await snap();
      await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); try { HP.App.closePanel(); } catch (e) { } return 1; });
      await page.waitForTimeout(4000);
      R['03_重画后'] = await snap();
    } catch (e) { R.__err = String(e).slice(0, 250); }
    return R;
  },
};
