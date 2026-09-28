/* R56：App 里建测试主机（R56靶机 @10.0.2.2:2222）并连上（用 App 自己的 API，连上后会话页才有数） */
export default {
  name: 'r56-app-host',
  check: async (page) => {
    await page.waitForTimeout(400);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const p = (v, k) => Array.isArray(v) ? v : (v && Array.isArray(v[k]) ? v[k] : (v && Array.isArray(v.items) ? v.items : (v && Array.isArray(v.list) ? v.list : [])));
      const out = {};
      try {
        let keys = p(await A.rpc('key.list'), 'keys');
        let k = keys.find((x) => x.name === 'r56probe');
        if (!k) {
          const meta = await A.rpc('key.generate', { name: 'r56probe', algo: 'ed25519', passphrase: '' }, 30000);
          out.gen = { fp: meta.fingerprint };
          out.pubForFile = meta.publicKey;
          keys = p(await A.rpc('key.list'), 'keys');
          k = keys.find((x) => x.name === 'r56probe');
        } else { out.gen = { fp: k.fingerprint, reused: true }; }
        const hosts = p(await A.rpc('host.list'), 'hosts');
        for (const h of hosts) if (h.name === 'R56靶机') await A.rpc('host.delete', { id: h.id });
        await A.rpc('host.save', { host: { name: 'R56靶机', host: '10.0.2.2', port: 2222, user: 'lwgat', auth: 'key', keyId: k.id, startCmd: 'bash -l', keepalive: 30, autoReconnect: false } });
        const list = p(await A.rpc('host.list'), 'hosts');
        const h = list.find((x) => x.name === 'R56靶机');
        out.host = h ? { id: h.id, host: h.host, port: h.port } : null;
        try { A.closePanel && A.closePanel(); } catch (e) { }
        await A.connect(h.id);
        await new Promise((r) => setTimeout(r, 8000));
        out.connected = !!(A.transport && A.transport.alive);
        out.topbar = document.getElementById('tb-title').textContent + ' / ' + document.getElementById('tb-badge').textContent;
      } catch (e) { out.err = String(e.message || e); }
      return out;
    });
  }
};
