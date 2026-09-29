/* R58 复测 I：④点「终端本体」真触摸（按 pane 自身坐标）→ ⑧键条⏎ 点前重量 ×3 */
export default {
  name: 'r58-i',
  check: async (page) => {
    const R = {};
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    const pane = () => page.evaluate(() => { const p = document.querySelector('#panner'); if (!p) return null; const r = p.getBoundingClientRect(); const c = getComputedStyle(p); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), display: c.display }; });
    try {
      R['01_初始'] = { vp: await vp(), pane: await pane() };
      // ④ 上翻 400 → 点终端本体 → 三拍
      R['02_上翻400'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 400; return { st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) }; });
      let p = await pane();
      R['03_点前pane'] = p;
      let hit = await page.evaluate((pt) => { const e = document.elementFromPoint(pt.x, pt.y); return e ? { tag: e.tagName, cls: String(e.className).slice(0, 40) } : null; }, p);
      R['04_命中'] = hit;
      await page.tap(p.x, p.y);
      const a = await vp(); await page.waitForTimeout(130); const b = await vp(); await page.waitForTimeout(880); const c = await vp();
      R['05_点终端三拍'] = { 同拍: a, 两帧后: b, 一秒后: c };
      // 再验一次：上翻 → 点 → 三拍（第二个样本）
      R['06_再上翻400'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 400; return { st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) }; });
      p = await pane();
      await page.tap(p.x, p.y);
      const a2 = await vp(); await page.waitForTimeout(130); const b2 = await vp(); await page.waitForTimeout(880); const c2 = await vp();
      R['07_点终端三拍2'] = { 同拍: a2, 两帧后: b2, 一秒后: c2 };
      // ⑧ 键条⏎：点前重量 + 三次真触摸
      R['08_键条'] = [];
      for (let i = 0; i < 3; i += 1) {
        const ret = await page.evaluate(() => { const c = [...document.querySelectorAll('button,a,div[role=button]')].filter((e) => /^[⏎↵]$/.test(e.textContent.trim()) && e.getBoundingClientRect().height > 0)[0]; if (!c) return null; const r = c.getBoundingClientRect(); const e2 = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), hitIsIt: e2 === c || (e2 && e2.closest && e2.closest('button') === c) }; });
        R['08_键条'].push(ret);
        if (ret) { await page.tap(ret.x, ret.y); await page.waitForTimeout(1000); }
      }
      R['09_末vp'] = await vp();
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
