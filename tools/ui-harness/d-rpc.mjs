export default {
  name: 'debug: RPC 往返',
  check: async (page) => {
    const direct = await page.evaluate(async () => {
      const out = {};
      try { out.prefAll = await HP.App.rpcRaw('pref.all'); } catch (e) { out.prefAllErr = String(e.message || e); }
      try { out.hostList = await HP.App.rpc('host.list'); } catch (e) { out.hostListErr = String(e.message || e); }
      out.transport = HP.App.transport && HP.App.transport.name;
      out.hpTransport = !!HP.transport;
      out.pending = HP.App.transport && HP.App.transport._pending ? HP.App.transport._pending.size : -1;
      return out;
    });
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({ loaded: HP.Panels._loaded, hosts: HP.Panels.hosts.length, prefsKeys: Object.keys(HP.Panels.prefs || {}).length }));
    return { direct, after };
  }
};
