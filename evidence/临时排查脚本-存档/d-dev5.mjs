/* 只做一件事：把「连接 → 看状态序列 → 终端里到底attach到哪个会话」看清楚。
 * 上一次连上以后又掉了，得先分清是"环境/上次断开留下的状态"还是产品问题。
 */
export default {
  name: '真机·重连诊断',
  check: async (page) => {
    const out = {};
    out.初始 = await page.evaluate(() => ({ state: HP.App.state, hasT: !!HP.App.transport, alive: !!(HP.App.transport && HP.App.transport.alive), sel: HP.Sessions.sel }));

    await page.evaluate(() => { HP.Sessions.sel = 'hpk-verify'; HP.Sessions.at = 0; });
    // 记录状态变化的来龙去脉（App.onState 是它自己的回调）
    await page.evaluate(() => {
      window.__状态序列 = [];
      const t = HP.App.transport;
      if (t) { const 旧 = t.onState; t.onState = (s, d) => { window.__状态序列.push([s, d ? String(d.msg || d.state || JSON.stringify(d)).slice(0, 60) : '']); if (旧) 旧(s, d); }; }
    });
    await page.evaluate(() => HP.App.openBoard('hosts'));
    await page.waitForTimeout(1000);
    await page.evaluate(() => { const c = document.querySelector('#tab-hosts .card[data-host]'); if (c) c.click(); });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const it = [...document.querySelectorAll('#ctxmenu button, #ctxmenu .ctx-item, #ctxmenu div')].find((b) => /连接/.test(b.textContent || ''));
      if (it) it.click();
    });
    out.序列 = [];
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => ({ state: HP.App.state, alive: !!(HP.App.transport && HP.App.transport.alive) }));
      out.序列.push(s.state + (s.alive ? '+' : '-'));
      if (s.state === 'connected') break;
    }
    out.状态事件 = await page.evaluate(() => window.__状态序列 || []);
    out.连接后 = await page.evaluate(async () => {
      const 试 = async (op, p) => { try { const r = await HP.App.rpc(op, p || {}, 15000); return { ok: true, 摘要: JSON.stringify(r).slice(0, 80) }; } catch (e) { return { ok: false, err: String(e.message) }; } };
      return {
        state: HP.App.state, transport: HP.App.transport ? HP.App.transport.name : null,
        '探活': await 试('ping'), tmux: await 试('tmux.list'), info: await 试('hermes.info')
      };
    });
    out.终端末几行 = await page.evaluate(() => {
      const t = HP.App.term; const b = t.buffer.active; const 行 = [];
      for (let i = Math.max(0, b.length - 25); i < b.length; i++) { const l = b.getLine(i); 行.push(l ? l.translateToString(true) : ''); }
      return 行.filter((x) => x.trim()).slice(-10);
    });
    return out;
  }
};
