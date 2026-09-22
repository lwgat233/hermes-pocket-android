/* 设备端键盘复验 · 第 1 步：**只点终端**（真触摸事件），报告焦点状态。
 * 判据（页面上）：点完之后不应该有任何输入元素拿到焦点 —— 那正是 Android 弹键盘的直接原因。
 */
export default {
  name: '真机·点终端（只读焦点）',
  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      if (HP.App.closePanel) HP.App.closePanel();
      document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) ae.blur();     // 从"没有键盘"的干净状态开始
    });
    await page.waitForTimeout(500);
    out.前 = await page.evaluate(() => {
      const ae = document.activeElement;
      const r = document.getElementById('termhost').getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
      const 命中 = document.elementFromPoint(cx, cy);
      return { 焦点: ae ? ae.tagName : null, 坐标: { x: cx, y: cy },
        '命中': 命中 ? (命中.id || 命中.tagName) : null, 落在终端里: !!(命中 && 命中.closest && 命中.closest('#termhost')) };
    });
    await page.tap(out.前.坐标.x, out.前.坐标.y);
    await page.waitForTimeout(900);
    out.后 = await page.evaluate(() => {
      const ae = document.activeElement;
      return { 焦点: ae ? ae.tagName : null, 类名: (ae && ae.className) || '',
        '是输入元素': !!(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) };
    });
    out.结论 = {
      '点真的落在终端里': out.前.落在终端里 === true,
      '点完没有输入元素拿到焦点': out.后.是输入元素 === false
    };
    return out;
  }
};
