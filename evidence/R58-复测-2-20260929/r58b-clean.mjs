export default { name: 'r58b-clean', check: async (page) => page.evaluate(async () => {
  const A = window.HP.App; const out = { deleted: [] };
  try { A.closePanel && A.closePanel(); } catch (e) { }
  const hosts = await A.rpc('host.list').catch(() => []);
  for (const h of (hosts || [])) if (['R58靶机', 'R49靶机', 'O14靶机'].includes(h.name)) { out.deleted.push(h.name); await A.rpc('host.delete', { id: h.id }); }
  const keys = await A.rpc('key.list').catch(() => []);
  for (const k of (keys || [])) if (['r58probe', 'o14probe', 'r48probe'].includes(k.name)) { out.deleted.push('key:' + k.name); await A.rpc('key.delete', { id: k.id }); }
  out.hostsLeft = (await A.rpc('host.list').catch(() => [])).map((x) => x.name);
  out.keysLeft = (await A.rpc('key.list').catch(() => [])).map((x) => x.name);
  return out;
})};
