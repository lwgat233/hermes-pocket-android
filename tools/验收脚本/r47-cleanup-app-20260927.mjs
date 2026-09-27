/* 清掉本轮在 App 里加的测试主机与测试密钥（只删我加的那两条） */
export default {
  name: 'r47-cleanup-app',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const out = {};
      try {
        const hosts = await A.rpc('host.list');
        for (const h of (hosts || [])) if (h.name === '靶机-r47') { await A.rpc('host.delete', { id: h.id }); out.deletedHost = h.name; }
        const keys = await A.rpc('key.list');
        for (const k of (keys || [])) if (k.name === 'r47probe') { await A.rpc('key.delete', { id: k.id }); out.deletedKey = k.name; }
        out.hostsAfter = ((await A.rpc('host.list')) || []).map((h) => h.name);
        out.keysAfter = ((await A.rpc('key.list')) || []).map((k) => k.name);
      } catch (e) { out.err = String(e.message || e); }
      return out;
    });
  }
};
