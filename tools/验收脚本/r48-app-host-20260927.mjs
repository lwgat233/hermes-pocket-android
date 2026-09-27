/* R48 复测：在 App 里建测试主机（R48靶机 @10.0.2.2:2222）并连上；用完由清理脚本删除 */
export default {
  name: 'r48-app-host',
  check: async (page) => {
    await page.waitForTimeout(400);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const out = { steps: [] };
      try {
        const keys = await A.rpc('key.list');
        let k = (keys || []).find((x) => x.name === 'r48probe');
        if (!k) {
          const meta = await A.rpc('key.generate', { name: 'r48probe', algo: 'ed25519', passphrase: '' }, 30000);
          out.gen = { fp: meta.fingerprint, head: String(meta.publicKey).slice(0, 22) };
          out.pubForFile = meta.publicKey;
          k = { id: (await A.rpc('key.list')).find((x) => x.name === 'r48probe').id };
        } else out.gen = { fp: k.fingerprint, reused: true };
        const hosts = await A.rpc('host.list').catch(() => []);
        for (const h of (hosts || [])) if (h.name === 'R48靶机') await A.rpc('host.delete', { id: h.id });
        const saved = await A.rpc('host.save', { host: { name: 'R48靶机', host: '10.0.2.2', port: 2222, user: 'lwgat', auth: 'key', keyId: k.id, startCmd: 'bash -l', keepalive: 30, autoReconnect: false } });
        out.saved = saved;
        const list = await A.rpc('host.list');
        const h = (list || []).find((x) => x.name === 'R48靶机');
        out.host = h ? { id: h.id, host: h.host, port: h.port, user: h.user, keyId: h.keyId } : null;
        try { A.closePanel && A.closePanel(); } catch (e) { }
        await A.connect(h.id);
        await new Promise((r) => setTimeout(r, 8000));
        out.connected = !!(A.transport && A.transport.alive);
        out.topbar = document.getElementById('tb-title').textContent + ' / ' + document.getElementById('tb-badge').textContent;
        out.termTail = ((document.getElementById('termsizer') || {}).innerText || '').slice(-160);
      } catch (e) { out.err = String(e.message || e); }
      return out;
    });
  }
};
