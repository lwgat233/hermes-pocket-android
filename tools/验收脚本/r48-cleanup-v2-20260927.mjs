/* R48 清场：先打印 host.list / key.list 的原始形状，再按形状删掉 R48靶机 / r48probe */
export default {
  name: 'r48-cleanup-v2',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(async () => {
      const A = window.HP.App;
      const out = {};
      const rawH = await A.rpc('host.list');
      const rawK = await A.rpc('key.list');
      out.shape = { h: Object.prototype.toString.call(rawH), hKeys: rawH && typeof rawH === 'object' ? Object.keys(rawH).slice(0, 8) : null, k: Object.prototype.toString.call(rawK), kKeys: rawK && typeof rawK === 'object' ? Object.keys(rawK).slice(0, 8) : null };
      out.hHead = JSON.stringify(rawH).slice(0, 260);
      out.kHead = JSON.stringify(rawK).slice(0, 260);
      const pick = (v) => Array.isArray(v) ? v : (v && Array.isArray(v.hosts) ? v.hosts : (v && Array.isArray(v.keys) ? v.keys : (v && Array.isArray(v.list) ? v.list : (v && Array.isArray(v.items) ? v.items : []))));
      const hosts = pick(rawH), keys = pick(rawK);
      out.hostsSeen = hosts.map((h) => ({ id: h.id, name: h.name }));
      out.keysSeen = keys.map((k) => ({ id: k.id, name: k.name }));
      for (const h of hosts) if (h.name === 'R48靶机') { try { await A.rpc('host.delete', { id: h.id }); out.deletedHost = h.name; } catch (e) { out.delHostErr = String(e.message || e); } }
      for (const k of keys) if (k.name === 'r48probe') { try { await A.rpc('key.delete', { id: k.id }); out.deletedKey = k.name; } catch (e) { out.delKeyErr = String(e.message || e); } }
      out.afterH = pick(await A.rpc('host.list')).map((h) => h.name);
      out.afterK = pick(await A.rpc('key.list')).map((k) => k.name);
      return out;
    });
  }
};
