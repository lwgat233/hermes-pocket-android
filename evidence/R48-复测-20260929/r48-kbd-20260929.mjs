/* R48#4：找并点「⌨」（开软键盘/输入焦点），供宿主随后发 keyevent 66 */
export default {
  name: 'r48-kbd',
  check: async (page) => {
    const R = {};
    try {
      R['01_候选'] = await page.evaluate(() => [...document.querySelectorAll('button,a,div,span')].filter((e) => /⌨/.test(e.textContent) && e.getBoundingClientRect().height > 0 && e.textContent.trim().length <= 3).map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, id: e.id || '', cls: String(e.className).slice(0, 30), t: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }).slice(0, 5));
      const k = R['01_候选'][0];
      if (k) { await page.tap(k.x, k.y); await page.waitForTimeout(2000); }
      R['02_点后'] = await page.evaluate(() => { const el = document.getElementById('cinput'); return { active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null, cinputExists: !!el, cinputFocus: el ? document.activeElement === el : null }; });
    } catch (e) { R.__err = String(e).slice(0, 200); }
    return R;
  },
};
