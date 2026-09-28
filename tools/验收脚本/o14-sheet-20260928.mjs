/* O14：点行之后弹出来的东西（sheet / dialog / ctxmenu）读数 */
export default {
  name: 'o14-sheet',
  check: async (page) => {
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const cand = [...document.querySelectorAll('body > *, #overlay > *, #app > *')].filter(vis);
      const sheets = [...document.querySelectorAll('.sheet, .hp-dialog, #ctxmenu, .menu, #tk-sheet, .tk-sheetcard, .backdrop, .dlg')].filter(vis);
      const delBtn = [...document.querySelectorAll('button, .tk-act')].filter((e) => vis(e) && /删除这个会话|切到|删除/.test(e.textContent || ''));
      let sheetText = null;
      if (delBtn.length) {
        let p = delBtn[0];
        for (let k = 0; k < 6 && p; k++) { p = p.parentElement; if (p && p.innerText && p.innerText.length > 10) { sheetText = p.innerText.replace(/\n/g, ' | ').slice(0, 300); break; } }
      }
      const mid = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return {
        sel: (window.HP.Sessions || {}).sel || null,
        sheets: sheets.map((e) => ({ cls: String(e.className).slice(0, 40), text: (e.innerText || '').replace(/\n/g, ' | ').slice(0, 160) })),
        midEl: mid ? mid.tagName + (mid.id ? '#' + mid.id : '') + '.' + String(mid.className).split(' ')[0] : null,
        midText: mid ? (mid.innerText || '').replace(/\n/g, ' | ').slice(0, 160) : null,
        sheetText,
        bigEls: cand.filter((e) => e.getBoundingClientRect().height > 200).map((e) => ({ id: e.id, cls: String(e.className).slice(0, 30), h: Math.round(e.getBoundingClientRect().height), txt: (e.innerText || '').replace(/\n/g, '|').slice(0, 80) }))
      };
    });
  }
};
