/* R58 复测 F：读 watcher 旗标 → 重起靶子（自动每 5s 一行）→ ④点终端三拍 → ⑤上翻不被拽回 → ⑥重画不顶回 → ⑦封底跟随 */
export default {
  name: 'r58-f',
  check: async (page) => {
    const R = {};
    const cmd = 'R49_LOG=/tmp/r58-probe.log R49_AUTO=5 python3 -u /vol1/1000/aicache/tmp/r58-target.py';
    const vp = () => page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null; });
    const flags = () => page.evaluate(() => { const w = window.HP.App.watcher || {}; return { alt: !!w.alt, mouseMode: w.mouseMode || 0, badge: (document.getElementById('tb-badge') || {}).textContent, hidden: HP.App.termHidden ? HP.App.termHidden() : null, bodyClass: document.body.className }; });
    const btn = () => page.evaluate(() => { const b = document.querySelector('#btn-term'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    const tailText = () => page.evaluate(() => (((document.querySelector('#termsizer') || {}).innerText) || '').split('\n').filter((l) => /靶子|追加/.test(l)).slice(-2).join(' | '));
    try {
      R['01_起始旗标'] = await flags();
      // 确保展开
      let b = await btn();
      if (b && b.text === '显示终端') { await page.tap(b.x, b.y); await page.waitForTimeout(1500); }
      R['02_展开后旗标'] = await flags();
      // 重起靶子（自动追加）
      await page.evaluate((c) => { window.HP.App.send('\x03'); return 1; });   // Ctrl-C 旧靶子
      await page.waitForTimeout(600);
      await page.evaluate((c) => { window.HP.App.send(c + '\r'); return 1; }, cmd);
      await page.waitForTimeout(9000);
      R['03_靶子v2'] = { flags: await flags(), vp: await vp(), tail: await tailText() };
      // ④ 点终端：真手上翻 → 点一下终端 → 三拍
      await page.swipe(200, 420, 260); await page.waitForTimeout(500);
      R['04_上翻后'] = { vp: await vp(), flags: await flags() };
      await page.tap(200, 420);
      const a = await vp(); await page.waitForTimeout(130); const bb = await vp(); await page.waitForTimeout(880); const cc = await vp();
      R['05_点终端三拍'] = { 同拍: a, 两帧后: bb, 一秒后: cc, flags: await flags() };
      // ⑦ 封底跟随：贴底后等自动追加
      await page.evaluate(() => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = v.scrollHeight; return 1; });
      await page.waitForTimeout(400);
      R['06_贴底'] = await vp();
      await page.waitForTimeout(16000);
      R['07_封底跟随_16s后'] = { vp: await vp(), tail: await tailText() };
      // ⑤ 上翻不被拽回：真手上翻 → 等新输出 → st 不变
      await page.swipe(200, 420, 300); await page.waitForTimeout(500);
      R['08_上翻'] = await vp();
      await page.waitForTimeout(16000);
      R['09_新输出后'] = { vp: await vp(), tail: await tailText() };
      // ⑥ 重画不顶回：resetGeometry + applyTermPane ×3
      await page.swipe(200, 420, 300); await page.waitForTimeout(400);
      R['10_重画前'] = await vp();
      R['11_重画'] = [];
      for (let i = 0; i < 3; i += 1) {
        const used = await page.evaluate(() => { const A = window.HP.App; const u = []; for (const m of ['resetGeometry', 'applyTermPane', 'fit']) { if (typeof A[m] === 'function') { try { A[m](); u.push(m); } catch (e) { } } } return u; });
        await page.waitForTimeout(900);
        R['11_重画'].push({ i, used, vp: await vp() });
      }
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
