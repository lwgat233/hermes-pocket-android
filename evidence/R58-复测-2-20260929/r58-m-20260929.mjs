/* R58 第 3 步 · 回归两套（R-39 粘性条复核 + R-41 授权框形状/报错 0） */
export default {
  name: 'r58-m',
  check: async (page) => {
    const R = {};
    try {
      await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
      await page.waitForTimeout(2500);
      R['01_聊天页'] = await page.evaluate(() => {
        const c = document.querySelector('#tk-chat');
        const v = c ? { scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, clientHeight: c.clientHeight, max: c.scrollHeight - c.clientHeight, paddingBottom: getComputedStyle(c).paddingBottom } : null;
        const say = document.querySelector('#tk-sayline');
        const bubs = [...document.querySelectorAll('#tk-chat .tk-bub, #tk-chat .tk-bub')];
        const last = bubs[bubs.length - 1];
        const r1 = last ? last.getBoundingClientRect() : null;
        const r2 = say ? say.getBoundingClientRect() : null;
        const sayH = getComputedStyle(document.documentElement).getPropertyValue('--sayline-h');
        return {
          vp: v, sayline: r2 ? { top: Math.round(r2.top), bottom: Math.round(r2.bottom), h: Math.round(r2.height) } : null,
          lastBub: r1 ? { top: Math.round(r1.top), bottom: Math.round(r1.bottom), h: Math.round(r1.height) } : null,
          间隙px: r1 && r2 ? +(r2.top - r1.bottom).toFixed(1) : null,
          重叠px: r1 && r2 ? +(Math.max(0, r1.bottom - r2.top)).toFixed(1) : null,
          saylineH: sayH.trim(), bubCount: bubs.length,
          askin: (() => { const a = document.querySelector('.tk-askin'); if (!a) return null; const r = a.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(a).display }; })(),
          按键: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()).slice(0, 8),
        };
      });
      // 末条气泡真触摸（R-39 的核心）：先滚内层到底再点
      const pt = await page.evaluate(() => { const c = document.querySelector('#tk-chat'); if (c) c.scrollTop = c.scrollHeight; const bs = [...document.querySelectorAll('#tk-chat .tk-bub')]; const b = bs[bs.length - 1]; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), hitIsSelfOrChild: !!(e && (e === b || b.contains(e))) }; });
      R['02_末条命中'] = pt;
      if (pt) {
        await page.tap(pt.x, pt.y);
        await page.waitForTimeout(1500);
        R['03_点后'] = await page.evaluate(() => ({ infoOpen: !!document.querySelector('.tk-info,.tk-sheet,.hp-dialog,.tk-pop') && [...document.querySelectorAll('.tk-info,.tk-sheet,.hp-dialog,.tk-pop')].some((e) => e.getBoundingClientRect().height > 0), overlays: [...document.querySelectorAll('.tk-info,.tk-sheet,.hp-dialog,.tk-pop')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.className) }));
      }
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
