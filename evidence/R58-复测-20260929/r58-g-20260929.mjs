/* R58 复测 G：④点终端三拍（用 scrollTop 制造上翻）→ ⑤上翻不被拽回 → ⑦封底跟随 → ⑧键条⏎ */
export default {
  name: 'r58-g',
  check: async (page) => {
    const R = {};
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    const setSt = (delta) => page.evaluate((d) => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = d === null ? v.scrollHeight : v.scrollTop + d; return { st: +v.scrollTop.toFixed(2), sh: v.scrollHeight, ch: v.clientHeight, bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) }; }, delta);
    const flags = () => page.evaluate(() => { const w = window.HP.App.watcher || {}; return { alt: !!w.alt, mouseMode: w.mouseMode || 0, hidden: HP.App.termHidden ? HP.App.termHidden() : null }; });
    try {
      let b = await page.evaluate(() => { const x = document.querySelector('#btn-term'); if (!x) return null; const r = x.getBoundingClientRect(); return { text: x.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
      if (b && b.text === '显示终端') { await page.tap(b.x, b.y); await page.waitForTimeout(1500); }
      R['01_展开'] = { vp: await vp(), flags: await flags() };
      // ④ 制造上翻 400 → 点一下终端 → 三拍
      R['02_上翻400'] = await setSt(-400);
      await page.tap(200, 420);
      const p1 = await vp(); await page.waitForTimeout(130); const p2 = await vp(); await page.waitForTimeout(880); const p3 = await vp();
      R['03_点终端三拍'] = { 同拍: p1, 两帧后: p2, 一秒后: p3 };
      // ⑤ 再上翻 600，等自动/触发的新输出，看 st 变不变
      R['04_上翻600'] = await setSt(-600);
      await page.waitForTimeout(17000);
      R['05_新输出后'] = await vp();
      R['06_尾行'] = await page.evaluate(() => (((document.querySelector('#termsizer') || {}).innerText) || '').split('\n').filter((l) => /靶子|追加/.test(l)).slice(-2).join(' | '));
      // ⑦ 贴底，等新输出，看是否仍离底 0
      R['07_贴底'] = await setSt(null);
      await page.waitForTimeout(17000);
      R['08_新输出后'] = await vp();
      R['09_尾行'] = await page.evaluate(() => (((document.querySelector('#termsizer') || {}).innerText) || '').split('\n').filter((l) => /靶子|追加/.test(l)).slice(-2).join(' | '));
      // ⑧ 键条「⏎」真触摸（给 0x0D 计数用）
      const ret = await page.evaluate(() => {
        const cands = [...document.querySelectorAll('button,a,div[role=button]')].filter((e) => /^[⏎↵]$/.test(e.textContent.trim()) && e.getBoundingClientRect().height > 0);
        if (!cands.length) return null; const e = cands[0]; const r = e.getBoundingClientRect();
        return { text: e.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
      });
      R['10_键条回车'] = ret;
      if (ret) { await page.tap(ret.x, ret.y); await page.waitForTimeout(800); }
      R['11_再点两次'] = [];
      for (let i = 0; i < 2; i += 1) { if (ret) { await page.tap(ret.x, ret.y); await page.waitForTimeout(700); R['11_再点两次'].push(i); } }
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
