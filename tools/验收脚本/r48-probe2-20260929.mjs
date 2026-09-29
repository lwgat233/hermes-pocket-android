/* R48#4 补读数：展开后读键条键尺寸/浮层命中/R-58 高度/vp；再点 ⌨ 开软键盘（交给宿主发 keyevent 66） */
export default {
  name: 'r48-probe2',
  check: async (page) => {
    const R = {};
    const read = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const v = q('.xterm-viewport');
      const bt = q('#btn-term');
      const keys = [...document.querySelectorAll('#keybar .key')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 4), w: Math.round(r.width), h: Math.round(r.height) }; });
      const p = q('#panner');
      const hits = bt ? (() => { const r = bt.getBoundingClientRect(); const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { by: e ? (e.id || String(e.className).slice(0, 30)) : null, isSelf: e === bt || (e && e.closest && e.closest('#btn-term') === bt) }; })() : null;
      return {
        hpDialog: [...document.querySelectorAll('.hp-dialog')].filter((e) => e.getBoundingClientRect().height > 0).length,
        floats: [...document.querySelectorAll('.hp-dialog,#tk-sheet')].filter((e) => e.getBoundingClientRect().height > 0).length,
        btnTerm: bt ? (() => { const r = bt.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), h: Math.round(r.height), text: bt.textContent.trim() }; })() : null,
        hits,
        pannerH: p ? Math.round(p.getBoundingClientRect().height) : null,
        hidden: window.HP.App.termHidden ? window.HP.App.termHidden() : null,
        vp: v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null,
        keys, csend: (() => { const c = q('#csend'); if (!c) return null; const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
        visibleButtons: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()).slice(0, 8),
        kbdKeys: (() => { const k = [...document.querySelectorAll('#keybar .key')].find((x) => /⌨/.test(x.textContent) && x.getBoundingClientRect().height > 0); return k ? '有' : '无'; })(),
      };
    });
    const tapSel = async (sel) => { const b = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); if (r.height === 0) return null; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, sel); if (b) { await page.tap(b.x, b.y); await page.waitForTimeout(1200); } return b; };
    try {
      R['01_起始'] = await read();
      if (R['01_起始'].hidden) { await tapSel('#btn-term'); await page.waitForTimeout(800); }
      R['02_展开后'] = await read();
      // 点 ⌨（开软键盘）—— 之后由宿主发 keyevent 66
      const kb = await page.evaluate(() => { const k = [...document.querySelectorAll('#keybar .key')].find((x) => /⌨/.test(x.textContent) && x.getBoundingClientRect().height > 0); if (!k) return null; const r = k.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
      R['03_⌨坐标'] = kb;
      if (kb) { await page.tap(kb.x, kb.y); await page.waitForTimeout(1800); }
      R['04_⌨后'] = await read();
      R['05_软键盘可见'] = await page.evaluate(() => { const el = document.getElementById('cinput'); return { exists: !!el, h: el ? Math.round(el.getBoundingClientRect().height) : null, focused: el ? document.activeElement === el : null }; });
    } catch (e) { R.__err = String(e).slice(0, 250); }
    return R;
  },
};
