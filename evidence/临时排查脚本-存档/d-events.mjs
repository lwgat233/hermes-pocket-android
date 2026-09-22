export default {
  name: 'debug: 点下去到底有没有 pointer 事件',
  check: async (page) => {
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected'; HP.App.onState('connected', {});
      window.__事件 = [];
      const st = document.getElementById('stage');
      ['pointerdown', 'pointerup', 'pointercancel', 'click', 'touchstart', 'touchend'].forEach((t) =>
        st.addEventListener(t, (e) => window.__事件.push(t + '→' + (e.target.id || e.target.className || e.target.tagName)), true));
    });
    await page.waitForTimeout(700);
    const p = await page.evaluate(() => {
      const r = document.getElementById('termhost') ? document.getElementById('termhost').getBoundingClientRect() : document.getElementById('panner').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const out = { 点的坐标: p };
    out.该坐标上的元素 = await page.evaluate((pt) => {
      const e = document.elementFromPoint(pt.x, pt.y);
      return e ? (e.tagName + '.' + (e.className || '')) : null;
    }, p);
    out.panner的几何 = await page.evaluate(() => {
      const r = document.getElementById('panner').getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(400);
    out.mouse_click事件 = await page.evaluate(() => window.__事件.slice());
    await page.evaluate(() => { window.__事件.length = 0; });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.up();
    await page.waitForTimeout(400);
    out.手动down_up事件 = await page.evaluate(() => window.__事件.slice());
    return out;
  }
};
