/* R58 第 3 步：⑧(挂 tmux 时) → detach 普通屏 → 前提 → ⑦贴底跟随 → ⑥切板块再回来 ±5px → ⑧(detach 后) */
export default {
  name: 'r58-j',
  check: async (page) => {
    const R = {};
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    const flags = () => page.evaluate(() => { const w = window.HP.App.watcher || {}; return { alt: !!w.alt, mouseMode: w.mouseMode || 0, hidden: HP.App.termHidden ? HP.App.termHidden() : null, badge: (document.getElementById('tb-badge') || {}).textContent }; });
    const tail = () => page.evaluate(() => (((document.querySelector('#termsizer') || {}).innerText) || '').split('\n').filter((l) => /靶子/.test(l)).slice(-2).join(' | ').slice(0, 150));
    const tapTerm = async () => { const b = await page.evaluate(() => { const x = document.querySelector('#btn-term'); if (!x) return null; const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }); if (b && b.t === '显示终端') { await page.tap(b.x, b.y); await page.waitForTimeout(1500); } return b; };
    const tapKey = async (re) => { const k = await page.evaluate((rx) => { const c = [...document.querySelectorAll('button,a,div[role=button]')].filter((e) => new RegExp(rx).test(e.textContent.trim()) && e.getBoundingClientRect().height > 0)[0]; if (!c) return null; const r = c.getBoundingClientRect(); const e2 = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), hitSelf: e2 === c || (e2 && e2.closest && e2.closest('button') === c) }; }, re); if (k) { await page.tap(k.x, k.y); await page.waitForTimeout(1000); } return k; };
    try {
      await tapTerm();
      R['01_挂tmux_展开'] = { vp: await vp(), flags: await flags(), tail: await tail() };
      R['02_挂tmux_键条回车×3'] = [];
      for (let i = 0; i < 3; i += 1) R['02_挂tmux_键条回车×3'].push(await tapKey('^[⏎↵]$'));
      await page.waitForTimeout(1200);
      R['03_挂tmux_后flags'] = await flags();
      // detach 到普通屏
      await page.evaluate(() => { window.HP.App.send('\x02d'); return 1; });
      await page.waitForTimeout(2500);
      R['04_detach后'] = { vp: await vp(), flags: await flags(), tail: await tail() };
      await page.evaluate(() => { window.HP.App.send('R49_LOG=/tmp/r58b-probe.log R49_AUTO=5 python3 -u /vol1/1000/aicache/tmp/r58-target.py\r'); return 1; });
      await page.waitForTimeout(9000);
      await tapTerm();
      R['05_普通屏_展开'] = { vp: await vp(), flags: await flags(), tail: await tail() };
      const v0 = await vp();
      R['06_前提'] = { 有滚动空间: !!(v0 && v0.sh > v0.ch), sh: v0 && v0.sh, ch: v0 && v0.ch };
      // ⑦ 贴底跟随：贴底 → 等真新行（尾行号变）→ 读离底
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = v.scrollHeight; return 1; });
      await page.waitForTimeout(300);
      R['07_贴底'] = { vp: await vp(), tail: await tail() };
      await page.waitForTimeout(12000);
      R['08_新行到达后'] = { vp: await vp(), tail: await tail() };
      // ⑥ 切板块再回来（真实路径：showBoard 与抽屉点板块同一条）±5px
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop -= 600; return 1; });
      await page.waitForTimeout(400);
      R['09_上翻600'] = await vp();
      let st0 = (await vp()).st;
      const seq = [];
      for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('talk'); return 1; });
        await page.waitForTimeout(900);
        await page.evaluate(() => { HP.App.showBoard && HP.App.showBoard('term'); return 1; });
        await page.waitForTimeout(900);
        const v = await vp();
        seq.push({ i, st: v && v.st, delta: v && +(v.st - st0).toFixed(2), bottom: v && v.bottom });
        if (v) st0 = v.st;
      }
      R['10_三次切板块'] = seq;
      // ⑧ detach 后键条回车 ×3
      R['11_普通屏_键条回车×3'] = [];
      for (let i = 0; i < 3; i += 1) R['11_普通屏_键条回车×3'].push(await tapKey('^[⏎↵]$'));
      await page.waitForTimeout(1500);
      R['12_末flags'] = await flags();
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
