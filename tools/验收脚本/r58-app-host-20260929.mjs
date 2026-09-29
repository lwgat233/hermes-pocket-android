/* R58/R49 复测：建测试主机 R58靶机（10.0.2.2:2222，startCmd＝靶子，照 sessions.js 的 startCmd 通路）并连上 */
export default {
  name: 'r58-app-host',
  check: async (page) => {
    await page.waitForTimeout(400);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const out = { steps: [] };
      try {
        const keys = await A.rpc('key.list');
        let k = (keys || []).find((x) => x.name === 'r58probe');
        if (!k) {
          const meta = await A.rpc('key.generate', { name: 'r58probe', algo: 'ed25519', passphrase: '' }, 30000);
          out.gen = { fp: meta && meta.fingerprint, head: String(meta && meta.publicKey).slice(0, 24) };
          k = (await A.rpc('key.list')).find((x) => x.name === 'r58probe');
        } else out.gen = { fp: k.fingerprint, reused: true };
        let h = (await A.rpc('host.list')).find((x) => x.name === 'R58靶机');
        if (h) { await A.rpc('host.delete', { id: h.id }); h = null; }
        const startCmd = 'R49_LOG=/tmp/r49-probe.log python3 -u /vol1/1000/aicache/tmp/r49-probe3.py';
        await A.rpc('host.save', { host: { name: 'R58靶机', host: '10.0.2.2', port: 2222, user: 'lwgat', auth: 'key', keyId: k.id, startCmd: startCmd, keepalive: 30, autoReconnect: false } });
        // 关键：先把"要进的会话"钉成 hptarget（bootstrap 的 pick() 优先用 sel；否则会 attach 到 list[0]=hermes）
        try { HP.Sessions.sel = 'hptarget'; } catch (e) { }
        const list = await A.rpc('host.list');
        h = (list || []).find((x) => x.name === 'R58靶机');
        out.host = h ? { id: h.id, host: h.host, port: h.port, startCmd: h.startCmd } : null;
        try { A.closePanel && A.closePanel(); } catch (e) { }
        await A.connect(h.id);
        await new Promise((r) => setTimeout(r, 10000));
        out.connected = !!(A.transport && A.transport.alive);
        out.topbar = document.getElementById('tb-title').textContent + ' / ' + document.getElementById('tb-badge').textContent;
        out.badgeHasTui = document.getElementById('tb-badge').classList.contains('tui');
        out.termText = ((document.getElementById('termsizer') || {}).innerText || '').slice(-160);
        out.viewport = (() => { const v = document.querySelector('.xterm-viewport'); return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null; })();
        out.xtermCount = document.querySelectorAll('.xterm').length;
      } catch (e) { out.err = String(e); }
      return out;
    });
  },
};
