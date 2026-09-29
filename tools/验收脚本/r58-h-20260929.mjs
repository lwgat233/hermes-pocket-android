/* R58 复测 H：④判别（命中元素 + 直接调 snapToBottom）→ ⑦贴底跟随（宿主先写好喂行）→ ⑧键条⏎ ×3 */
export default {
  name: 'r58-h',
  check: async (page) => {
    const R = {};
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    try {
      // ⑦ 先贴底（宿主的喂行会立刻到）
      R['01_贴底'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = v.scrollHeight; return { st: +v.scrollTop.toFixed(2), sh: v.scrollHeight, ch: v.clientHeight, bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) }; });
      await page.waitForTimeout(10000);
      R['02_新输出后'] = await vp();
      R['03_尾行'] = await page.evaluate(() => (((document.querySelector('#termsizer') || {}).innerText) || '').split('\n').filter((l) => /靶子|追加/.test(l)).slice(-2).join(' | '));
      // ④ 判别：上翻 400 → 命中元素是谁 → 直接调 snapToBottom（不发触摸）
      R['04_上翻400'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 400; return { st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) }; });
      R['05_命中元素'] = await page.evaluate(() => { const e = document.elementFromPoint(200, 420); if (!e) return null; const path = []; let n = e; for (let i = 0; i < 5 && n; i += 1) { path.push(n.id ? '#' + n.id : (n.className ? '.' + String(n.className).split(' ')[0] : n.tagName)); n = n.parentElement; } return { tag: e.tagName, cls: String(e.className).slice(0, 60), path }; });
      const direct = await page.evaluate(() => { const A = window.HP.App; const before = document.querySelector('.xterm-viewport').scrollTop; try { A.snapToBottom(); } catch (e) { return { err: String(e) }; } const after = document.querySelector('.xterm-viewport').scrollTop; return { before: +before.toFixed(2), after: +after.toFixed(2), watcher: { alt: !!(A.watcher || {}).alt, mouseMode: (A.watcher || {}).mouseMode || 0 } }; });
      await page.waitForTimeout(400);
      R['06_直接snapToBottom'] = { ret: direct, vp: await vp() };
      // 真触摸再点一次（上翻后）
      R['07_再上翻'] = await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 400; return { st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) }; });
      await page.tap(200, 420);
      const p1 = await vp(); await page.waitForTimeout(130); const p2 = await vp(); await page.waitForTimeout(880); const p3 = await vp();
      R['08_点终端三拍'] = { 同拍: p1, 两帧后: p2, 一秒后: p3 };
      // ⑧ 键条⏎ 真触摸 ×3
      const ret = await page.evaluate(() => { const c = [...document.querySelectorAll('button,a,div[role=button]')].filter((e) => /^[⏎↵]$/.test(e.textContent.trim()) && e.getBoundingClientRect().height > 0)[0]; if (!c) return null; const r = c.getBoundingClientRect(); return { tag: c.tagName, cls: String(c.className).slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; });
      R['09_键条回车元素'] = ret;
      for (let i = 0; i < 3; i += 1) { if (ret) { await page.tap(ret.x, ret.y); await page.waitForTimeout(900); } }
      R['10_按下过3次'] = !!ret;
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
