/* R58 第 3 步（修正版）：关面板 → 展开 → 前提 → ⑦贴底跟随 → ⑥切板块 ±5px → ⑧键条⏎ ×3 */
export default {
  name: 'r58-k',
  check: async (page) => {
    const R = {};
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    const flags = () => page.evaluate(() => { const w = window.HP.App.watcher || {}; return { alt: !!w.alt, mouseMode: w.mouseMode || 0, hidden: HP.App.termHidden ? HP.App.termHidden() : null, badge: (document.getElementById('tb-badge') || {}).textContent, overlays: [...document.querySelectorAll('#overlay,#sheet,.hp-dialog')].filter((e) => e.getBoundingClientRect().height > 0).length }; });
    const tailNum = () => page.evaluate(() => { const t = ((document.querySelector('#termsizer') || {}).innerText) || ''; const m = t.match(/终端靶子-[^0-9]*(\d+)/g); return m ? m[m.length - 1] : null; });
    const tapTerm = async () => { const b = await page.evaluate(() => { const x = document.querySelector('#btn-term'); if (!x) return null; const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), hit: (() => { const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return e === x || (e && e.closest && e.closest('#btn-term') === x); })() }; }); if (b && b.t === '显示终端') { await page.tap(b.x, b.y); await page.waitForTimeout(1600); } return b; };
    const tapKey = async (re) => { const k = await page.evaluate((rx) => { const c = [...document.querySelectorAll('button,a,div[role=button]')].filter((e) => new RegExp(rx).test(e.textContent.trim()) && e.getBoundingClientRect().height > 0)[0]; if (!c) return null; const r = c.getBoundingClientRect(); const e2 = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), hitSelf: e2 === c || (e2 && e2.closest && e2.closest('button') === c) }; }, re); if (k) { await page.tap(k.x, k.y); await page.waitForTimeout(1100); } return k; };
    try {
      await page.evaluate(() => { try { HP.App.closePanel(); } catch (e) { } const ov = document.querySelector('#overlay'); if (ov) ov.classList.add('hidden'); return 1; });
      await page.waitForTimeout(800);
      R['01_清场'] = await flags();
      R['02_展开'] = { btn: await tapTerm(), flags: await flags(), vp: await vp() };
      R['03_前提'] = await (async () => { const v = await vp(); return { 有滚动空间: !!(v && v.sh > v.ch), vp: v, tail: await tailNum() }; })();
      // ⑦ 贴底 → 等真新行（尾行号变）→ 离底
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = v.scrollHeight; return 1; });
      await page.waitForTimeout(300);
      R['04_贴底'] = { vp: await vp(), tail: await tailNum() };
      await page.waitForTimeout(13000);
      R['05_新行到达后'] = { vp: await vp(), tail: await tailNum() };
      // ⑥ 上翻 600 → 3 次"切板块再回来" ⇒ ±5px
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 600; return 1; });
      await page.waitForTimeout(400);
      let v = await vp();
      R['06_上翻600'] = v;
      const seq = [];
      let st0 = (await vp()).st;
      for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
        await page.waitForTimeout(1000);
        await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('term'); return 1; });
        await page.waitForTimeout(1000);
        v = await vp();
        seq.push({ i, st: v && v.st, delta: v && +(v.st - st0).toFixed(2), bottom: v && v.bottom });
        if (v) st0 = v.st;
      }
      R['07_三次切板块'] = seq;
      // ⑧ 键条⏎ ×3（读靶子端要宿主侧看日志）
      R['08_键条回车×3'] = [];
      for (let i = 0; i < 3; i += 1) R['08_键条回车×3'].push(await tapKey('^[⏎↵]$'));
      await page.waitForTimeout(1500);
      R['09_末'] = { flags: await flags(), vp: await vp(), tail: await tailNum() };
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
