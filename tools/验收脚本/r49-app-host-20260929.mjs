/* R49 复测：在 App 里建测试主机（R49靶机 @10.0.2.2:2222，startCmd=靶子脚本）并连上 */
export default {
  name: 'r49-app-host',
  check: async (page) => {
    await page.waitForTimeout(400);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const out = { steps: [] };
      try {
        const keys = await A.rpc('key.list');
        let k = (keys || []).find((x) => x.name === 'o14probe') || (keys || [])[0];
        out.key = { id: k && k.id, name: k && k.name, fp: k && k.fingerprint };
        const hosts = await A.rpc('host.list').catch(() => []);
        for (const h of (hosts || [])) if (h.name === 'R49靶机') await A.rpc('host.delete', { id: h.id });
        const startCmd = "bash -lc 'stty -echo -icanon -icrnl min 1 time 0; R49_LOG=/tmp/r49-probe.log exec python3 -u /vol1/1000/aicache/tmp/r49-probe2.py'";
        const saved = await A.rpc('host.save', { host: { name: 'R49靶机', host: '10.0.2.2', port: 2222, user: 'lwgat', auth: 'key', keyId: k.id, startCmd: startCmd, keepalive: 30, autoReconnect: false } });
        out.saved = saved;
        const list = await A.rpc('host.list');
        const h = (list || []).find((x) => x.name === 'R49靶机');
        out.host = h ? { id: h.id, host: h.host, port: h.port, user: h.user, keyId: h.keyId } : null;
        try { A.closePanel && A.closePanel(); } catch (e) { }
        await A.connect(h.id);
        await new Promise((r) => setTimeout(r, 9000));
        out.connected = !!(A.transport && A.transport.alive);
        out.topbar = document.getElementById('tb-title').textContent + ' / ' + document.getElementById('tb-badge').textContent;
        out.termTail = ((document.getElementById('termsizer') || {}).innerText || '').slice(-200);
        out.viewport = (() => {
          const v = document.querySelector('.xterm-viewport');
          return v ? { sh: v.scrollHeight, ch: v.clientHeight, st: v.scrollTop, bottom: v.scrollHeight - v.clientHeight - v.scrollTop } : null;
        })();
      } catch (e) { out.err = String(e); }
      return out;
    });
  },
};
