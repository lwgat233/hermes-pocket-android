/* R48 复测：清掉 App 里的测试主机（R48靶机）与测试密钥（r48probe）——兼容 host.list/key.list 返回数组或 {hosts|keys:[...]} */
export default {
  name: 'r48-cleanup-app',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const arr = (v, k) => Array.isArray(v) ? v : (v && Array.isArray(v[k]) ? v[k] : (v && Array.isArray(v.items) ? v.items : []));
      const out = {};
      try {
        const hosts = arr(await A.rpc('host.list'), 'hosts');
        out.hostsSeen = hosts.map((h) => h.name);
        for (const h of hosts) if (h.name === 'R48靶机') { await A.rpc('host.delete', { id: h.id }); out.deletedHost = h.name; }
        const keys = arr(await A.rpc('key.list'), 'keys');
        out.keysSeen = keys.map((k) => k.name);
        for (const k of keys) if (k.name === 'r48probe') { await A.rpc('key.delete', { id: k.id }); out.deletedKey = k.name; }
        out.hostsAfter = arr(await A.rpc('host.list'), 'hosts').map((h) => h.name);
        out.keysAfter = arr(await A.rpc('key.list'), 'keys').map((k) => k.name);
      } catch (e) { out.err = String(e.message || e); }
      return out;
    });
  }
};
