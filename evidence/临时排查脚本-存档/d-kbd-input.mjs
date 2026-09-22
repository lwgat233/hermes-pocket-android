/* 设备端键盘复验 · 第 2 步（**对照**）：只点底部输入框 —— 键盘必须弹起来。
 * 没有这条对照，"点终端后 mInputShown=false"就不能算证据（可能只是我读法不对）。
 */
export default {
  name: '真机·点输入框（对照，必须弹键盘）',
  check: async (page) => {
    const out = {};
    out.前 = await page.evaluate(() => {
      const c = document.getElementById('cinput');
      const r = c.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
      const 命中 = document.elementFromPoint(cx, cy);
      return { 坐标: { x: cx, y: cy }, 命中: 命中 ? (命中.id || 命中.tagName) : null,
        '命中就是输入框': !!(命中 && 命中.id === 'cinput') };
    });
    await page.tap(out.前.坐标.x, out.前.坐标.y);
    await page.waitForTimeout(1200);
    out.后 = await page.evaluate(() => {
      const ae = document.activeElement;
      return { 焦点: ae ? ae.tagName : null, 类名: (ae && ae.className) || '', 是输入框: !!(ae && ae.id === 'cinput') };
    });
    out.结论 = {
      '点真的落在输入框上': out.前.命中就是输入框 === true,
      '点完输入框拿到焦点': out.后.是输入框 === true
    };
    return out;
  }
};
