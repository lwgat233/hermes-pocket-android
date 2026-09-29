/* R58 第 3 步（定稿手法）：列出浮层 → 用 App 自己的 toggleTerm 展开 → 前提 → ⑦灌行跟随 → ⑥切板块 ±5px → ⑧键条⏎ ×3 */
export default {
  name: 'r58-l',
  check: async (page) => {
    const R = {};
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    const flags = () => page.evaluate(() => { const w = window.HP.App.watcher || {}; return { alt: !!w.alt, mouseMode: w.mouseMode || 0, hidden: window.HP.App.termHidden ? window.HP.App.termHidden() : null, badge: (document.getElementById('tb-badge') || {}).textContent, pannerH: (() => { const p = document.querySelector('#panner'); return p ? Math.round(p.getBoundingClientRect().height) : null; })() }; });
    const overlays = () => page.evaluate(() => [...document.querySelectorAll('#overlay,#sheet,.hp-dialog,.card,#ctxmenu')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => ({ id: e.id || '', cls: String(e.className).slice(0, 40), h: Math.round(e.getBoundingClientRect().height) })));
    const tailNum = () => page.evaluate(() => { const t = ((document.querySelector('#termsizer') || {}).innerText) || ''; const m = t.match(/终端靶子-[^0-9]*(\d+)/g); return m ? m[m.length - 1] : null; });
    const tapKey = async (re) => { const k = await page.evaluate((rx) => { const c = [...document.querySelectorAll('button,a,div[role=button]')].filter((e) => new RegExp(rx).test(e.textContent.trim()) && e.getBoundingClientRect().height > 0)[0]; if (!c) return null; const r = c.getBoundingClientRect(); const e2 = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), hitSelf: e2 === c || (e2 && e2.closest && e2.closest('button') === c) }; }, re); if (k) { await page.tap(k.x, k.y); await page.waitForTimeout(1100); } return k; };
    try {
      R['01_浮层'] = await overlays();
      R['02_展开前'] = { flags: await flags(), vp: await vp() };
      // 用 R-58 自己的开关（按钮的同一个 handler）；同时记一次"真触摸"能不能点到
      const hit = await page.evaluate(() => { const b = document.querySelector('#btn-term'); if (!b) return null; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), covered: !(e === b || (e && e.closest && e.closest('#btn-term') === b)), by: e ? (e.id || String(e.className).slice(0, 30)) : null }; });
      R['03_按钮是否被盖'] = hit;
      await page.evaluate(() => { window.HP.App.toggleTerm(); return 1; });
      await page.waitForTimeout(1800);
      R['04_展开后'] = { flags: await flags(), vp: await vp() };
      const v0 = await vp();
      R['05_前提'] = { 有滚动空间: !!(v0 && v0.sh > v0.ch), vp: v0, tail: await tailNum() };
      // ⑦ 贴底 → 宿主已预写喂行 → 等真新行 → 离底
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = v.scrollHeight; return 1; });
      await page.waitForTimeout(300);
      R['06_贴底'] = { vp: await vp(), tail: await tailNum() };
      await page.waitForTimeout(14000);
      R['07_新行到达后'] = { vp: await vp(), tail: await tailNum() };
      // ⑥ 上翻 600 → 3 次切板块再回来 ⇒ ±5px
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 600; return 1; });
      await page.waitForTimeout(400);
      let v = await vp();
      R['08_上翻600'] = v;
      const seq = []; let st0 = (await vp()).st;
      for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
        await page.waitForTimeout(1000);
        await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('term'); return 1; });
        await page.waitForTimeout(1000);
        v = await vp();
        seq.push({ i, st: v && v.st, delta: v && +(v.st - st0).toFixed(2), bottom: v && v.bottom });
        if (v) st0 = v.st;
      }
      R['09_三次切板块'] = seq;
      R['10_键条回车×3'] = [];
      for (let i = 0; i < 3; i += 1) R['10_键条回车×3'].push(await tapKey('^[⏎↵]$'));
      await page.waitForTimeout(1500);
      R['11_末'] = { flags: await flags(), vp: await vp(), tail: await tailNum() };
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
