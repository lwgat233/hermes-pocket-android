/* R56 清场：删掉本轮在 App 里加的测试主机（O14靶机）与测试密钥（o14probe） */
export default {
  name: 'r56-cleanup-app',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const pick = (v, k) => Array.isArray(v) ? v : (v && Array.isArray(v[k]) ? v[k] : (v && Array.isArray(v.items) ? v.items : (v && Array.isArray(v.list) ? v.list : [])));
      const out = {};
      try {
        const hosts = pick(await A.rpc('host.list'), 'hosts');
        out.hostsSeen = hosts.map((h) => h.name);
        for (const h of hosts) if (h.name === 'O14靶机') { await A.rpc('host.delete', { id: h.id }); out.deletedHost = h.name; }
        const keys = pick(await A.rpc('key.list'), 'keys');
        out.keysSeen = keys.map((k) => k.name);
        for (const k of keys) if (k.name === 'o14probe') { await A.rpc('key.delete', { id: k.id }); out.deletedKey = k.name; }
        out.afterH = pick(await A.rpc('host.list'), 'hosts').map((h) => h.name);
        out.afterK = pick(await A.rpc('key.list'), 'keys').map((k) => k.name);
      } catch (e) { out.err = String(e.message || e); }
      return out;
    });
  }
};
