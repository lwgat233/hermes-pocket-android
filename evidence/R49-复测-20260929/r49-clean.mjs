export default { name: 'r49-clean', check: async (page) => page.evaluate(async () => {
  const A = window.HP.App; const out = {};
  const hosts = await A.rpc('host.list').catch(() => []);
  for (const h of (hosts || [])) if (h.name === 'R49靶机') { out.deletedHost = h.name; await A.rpc('host.delete', { id: h.id }); }
  const keys = await A.rpc('key.list').catch(() => []);
  for (const k of (keys || [])) if (['o14probe', 'r48probe'].includes(k.name)) { out.deletedKey = k.name; await A.rpc('key.delete', { id: k.id }); }
  out.hostsLeft = (await A.rpc('host.list').catch(() => [])).map((x) => x.name);
  out.keysLeft = (await A.rpc('key.list').catch(() => [])).map((x) => x.name);
  return out;
})};
