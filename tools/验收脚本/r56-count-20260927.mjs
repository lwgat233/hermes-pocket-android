/* R56：会话页计数 / 可见性 / 按钮 / 滚动（真滑动后复读） */
export default {
  name: 'r56-count',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const vh = window.innerHeight;
      const rows = [...document.querySelectorAll('#tab-sessions .row-item')];
      const cards = [...document.querySelectorAll('#tab-sessions .card')];
      const lists = [...document.querySelectorAll('#tab-sessions .ui-list')];
      const btns = [...document.querySelectorAll('#tab-sessions button')].filter(vis);
      const allBtns = [...document.querySelectorAll('button')].filter(vis);
      const tab = document.getElementById('tab-sessions');
      return {
        rowItems: rows.length,
        rowItemsVisible: rows.filter(vis).length,
        rowOnScreen: rows.filter((e) => { const r = e.getBoundingClientRect(); return vis(e) && r.top >= 0 && r.bottom <= vh + 0.5; }).length,
        cards: cards.length,
        lists: lists.length,
        maid: rows.filter((e) => /女仆|home-?maid|home\.maid/i.test(e.innerText)).map((e) => ({ t: e.innerText.replace(/\n/g, ' | '), id: e.getAttribute('data-testid'), top: Math.round(e.getBoundingClientRect().top), visible: vis(e) })),
        sectionBtnCount: btns.length,
        sectionBtns: btns.map((b) => b.textContent.trim()),
        allVisibleButtons: allBtns.length,
        allButtons: allBtns.map((b) => (b.id ? '#' + b.id : b.textContent.trim().slice(0, 8))),
        scroll: tab ? { scrollTop: Math.round(tab.scrollTop), scrollHeight: tab.scrollHeight, clientHeight: tab.clientHeight } : null,
        overlayScroll: (() => { const pb = document.querySelector('#overlay .panel-body') || tab; return pb ? { tag: pb.className || pb.tagName, scrollTop: Math.round(pb.scrollTop), scrollHeight: pb.scrollHeight, clientHeight: pb.clientHeight } : null; })(),
        secondCopyTop: cards.length > 1 ? Math.round(cards[1].getBoundingClientRect().top) : null,
        viewportH: vh
      };
    });
  }
};
