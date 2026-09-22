export default {
  name: 'debug: 点终端走了哪条分支',
  check: async (page) => {
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected'; HP.App.onState('connected', {});
      window.__分支 = [];
      const 原blur = HP.App.blurInputs.bind(HP.App);
      HP.App.blurInputs = () => { window.__分支.push('blurInputs'); return 原blur(); };
      const 原focus = HP.App.term.focus.bind(HP.App.term);
      HP.App.term.focus = () => { window.__分支.push('term.focus'); return 原focus(); };
    });
    await page.waitForTimeout(800);
    const 焦点 = () => page.evaluate(() => {
      const ae = document.activeElement;
      return (ae && ae.tagName) + '|' + ((ae && ae.className) || '');
    });
    const out = {};
    out.pref初值 = await page.evaluate(() => ({ tapKeyboard: HP.App.pref('tapKeyboard', ''), touchMouse: HP.App.pref('touchMouse', ''), mouseMode: HP.App.watcher ? HP.App.watcher.mouseMode : null }));

    await page.evaluate(async () => { await HP.App.setPref('tapKeyboard', true, { apply: false }); await HP.App.setPref('touchMouse', false, { apply: false }); });
    out.pref改后 = await page.evaluate(() => ({ tapKeyboard: HP.App.bool('tapKeyboard', false), touchMouse: HP.App.bool('touchMouse', true) }));
    await page.evaluate(() => { window.__分支.length = 0; document.getElementById('cinput').blur(); });

    const p = await page.evaluate(() => {
      const r = document.getElementById('panner').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(500);
    out.分支 = await page.evaluate(() => window.__分支);
    out.焦点 = await 焦点();
    out.手动focus能否生效 = await page.evaluate(() => { HP.App.term.focus(); return document.activeElement === HP.App.term.textarea; });
    return out;
  }
};
