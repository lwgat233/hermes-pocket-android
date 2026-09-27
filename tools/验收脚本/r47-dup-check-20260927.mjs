/* R-48 追加量：终端页输入框/控件有没有重复 id、App 的监听器是否挂在"当前"那个节点上 */
export default {
  name: 'r47-dup-check',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const cnt = (sel) => document.querySelectorAll(sel).length;
      const cur = document.getElementById('cinput');
      const info = {
        ids: { cinput: cnt('#cinput'), csend: cnt('#csend'), cmode: cnt('#cmode'), keybar: cnt('#keybar'), composer: cnt('#composer') },
        hookedSameAsCurrent: !!(window.__hookedEl && window.__hookedEl === cur),
        hookedStillInDom: !!(window.__hookedEl && document.contains(window.__hookedEl)),
        curInDom: !!cur && document.contains(cur),
        allCinputs: [...document.querySelectorAll('#cinput')].map((e) => ({
          tag: e.tagName, inDom: document.contains(e), visible: e.getBoundingClientRect().height > 0,
          rect: { x: Math.round(e.getBoundingClientRect().x), y: Math.round(e.getBoundingClientRect().y), w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) },
          sameAsActive: document.activeElement === e, value: String(e.value).slice(0, 20),
          marked: e.dataset ? e.dataset.r47 : null
        })),
        activeElement: document.activeElement ? (document.activeElement.tagName + '#' + document.activeElement.id) : null,
        allCsends: [...document.querySelectorAll('#csend')].map((e) => ({ visible: e.getBoundingClientRect().height > 0, label: e.textContent.trim() })),
        composerHTMLHead: (document.getElementById('composer') || {}).innerHTML ? document.getElementById('composer').innerHTML.slice(0, 200) : null
      };
      return info;
    });
  }
};
