/* R48#4：detach hermes→attach r48t → ①浮层(连 3 次) → ②键条⏎/#csend 真触摸 → ③尺寸 → ⑤按键/文案/报错 → R-58/R-49 回归 */
export default {
  name: 'r48-probe',
  check: async (page) => {
    const R = {};
    const snap = () => page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
      const v = q('.xterm-viewport');
      const dialogs = [...document.querySelectorAll('.hp-dialog')].filter((e) => e.getBoundingClientRect().height > 0);
      const anyFloat = [...document.querySelectorAll('.hp-dialog,#tk-sheet,[class*=sheet]')].filter((e) => e.getBoundingClientRect().height > 0);
      return {
        hpDialog: dialogs.length, floats: anyFloat.length,
        btnTerm: box('#btn-term'), csend: box('#csend'),
        keybarKeys: [...document.querySelectorAll('#keybar .key')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 4), w: Math.round(r.width), h: Math.round(r.height) }; }),
        visibleButtons: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()).slice(0, 10),
        stageText: ((q('#stage') || {}).innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        vp: v ? { sh: v.scrollHeight, ch: v.clientHeight, st: +v.scrollTop.toFixed(2), bottom: +(v.scrollHeight - v.clientHeight - v.scrollTop).toFixed(2) } : null,
        termHidden: window.HP.App.termHidden ? window.HP.App.termHidden() : null,
        badge: (document.getElementById('tb-badge') || {}).textContent,
        hits: (() => { const b = q('#btn-term'); if (!b) return null; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { by: e ? (e.id || String(e.className).slice(0, 30)) : null, isSelf: e === b || (e && e.closest && e.closest('#btn-term') === b) }; })(),
      };
    });
    const tapSel = async (sel) => { const b = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, sel); if (b) { await page.tap(b.x, b.y); await page.waitForTimeout(1200); } return b; };
    try {
      // 0) 先脱离 hermes 再上 r48t
      R['00_起始'] = await snap();
      await page.evaluate(() => { window.HP.App.send('\x02d'); return 1; });
      await page.waitForTimeout(2200);
      await page.evaluate(async () => { await HP.Sessions.refresh().catch(() => { }); return 1; });
      await page.waitForTimeout(600);
      R['01_attach'] = await page.evaluate(() => { try { HP.App.closePanel(); } catch (e) { } return { ok: HP.Sessions.attach('r48t'), sel: HP.Sessions.sel, list: (HP.Sessions.list || []).map((x) => x.name) }; });
      await page.waitForTimeout(3000);
      R['02_attach后'] = await snap();
      // ① 连接流程 ≥3 次（含重复 / 失败 / 被顶掉）
      R['03_连接流程'] = await page.evaluate(async () => {
        const A = window.HP.App; const out = [];
        const hosts = await A.rpc('host.list').catch(() => []);
        const good = (hosts || []).find((x) => x.name === 'R58靶机');
        const bogus = await A.rpc('host.save', { host: { name: 'R48坏靶机', host: '127.0.0.1', port: 1, user: 'nobody', auth: 'key', keyId: good && good.keyId, startCmd: '', keepalive: 30, autoReconnect: false } }).then(() => (A.rpc('host.list')).then((l) => (l || []).find((x) => x.name === 'R48坏靶机'))).catch(() => null);
        for (let i = 0; i < 2; i += 1) { try { await A.connect(good.id); } catch (e) { out.push('good err ' + e.message); } await new Promise((r) => setTimeout(r, 6000)); }
        if (bogus) { try { await A.connect(bogus.id); } catch (e) { out.push('bogus err'); } await new Promise((r) => setTimeout(r, 5000)); }
        try { await A.connect(good.id); } catch (e) { } await new Promise((r) => setTimeout(r, 6000));
        return out;
      });
      await page.waitForTimeout(1500);
      R['04_连接后浮层'] = await snap();
      // ② 键条⏎ / #csend（真触摸）
      await page.evaluate(() => { window.HP.App.send('\x02d'); return 1; });
      await page.waitForTimeout(2000);
      await page.evaluate(async () => { await HP.Sessions.refresh().catch(() => { }); HP.Sessions.attach('r48t'); return 1; });
      await page.waitForTimeout(3000);
      const k = await page.evaluate(() => { const e = [...document.querySelectorAll('#keybar .key')].find((x) => /^[⏎↵]$/.test(x.textContent.trim())); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
      R['05_键条⏎坐标'] = k;
      if (k) { await page.tap(k.x, k.y); await page.waitForTimeout(900); }
      const cs = await tapSel('#csend');
      R['06_csend坐标'] = cs;
      R['07_末'] = await snap();
      // R-58 / R-49 回归（真触摸展开 + 离底）
      R['08_回归_展开前'] = await snap();
      await tapSel('#btn-term');
      R['09_回归_展开后'] = await snap();
      await tapSel('#btn-term');
      R['10_回归_收起后'] = await snap();
    } catch (e) { R.__err = String(e).slice(0, 300); }
    return R;
  },
};
