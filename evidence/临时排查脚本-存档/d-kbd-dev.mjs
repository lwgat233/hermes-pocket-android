/* 设备端：点终端会不会弹键盘 —— 只读坐标与焦点状态，不发任何键盘输入。
 * 判据两条独立信号：① 页面里 document.activeElement 是不是输入元素；② 系统 mInputShown。
 * 另外必须有一条**对照**：点输入框时 mInputShown 要变成 true —— 否则"读到 false"可能只是我的 dumpsys 读法不对。
 */
export default {
  name: '真机·点终端弹不弹键盘（坐标 + 焦点）',
  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      // 别让面板/小窗盖着终端（盖着的话 App 的 pointer 处理器会早返回，量到的就是假象）
      if (HP.App.closePanel) HP.App.closePanel();
      document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
    });
    await page.waitForTimeout(600);
    out.坐标 = await page.evaluate(() => {
      const dpr = window.devicePixelRatio || 1;
      const 取 = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { cssX: Math.round(r.x + r.width / 2), cssY: Math.round(r.y + r.height / 2),
          devX: Math.round((r.x + r.width / 2) * dpr), devY: Math.round((r.y + r.height / 2) * dpr) };
      };
      const 终 = 取('#termhost'), 输 = 取('#cinput');
      const 命中 = document.elementFromPoint(终.cssX, 终.cssY);
      return { dpr, 视口: { w: window.innerWidth, h: window.innerHeight, screenY: window.screenY, screenH: screen.height },
        '终端': 终, 输入框: 输,
        '终端那儿命中的是': 命中 ? (命中.id || 命中.tagName + '.' + (命中.className || '')) : null,
        '终端命中在终端里': !!(命中 && 命中.closest && 命中.closest('#termhost')) };
    });
    out.点之前 = await page.evaluate(() => {
      const ae = document.activeElement;
      return { tag: ae && ae.tagName, cls: (ae && ae.className) || '', 是输入: !!(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) };
    });
    return out;
  }
};
