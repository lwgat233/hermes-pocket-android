export default { name: 'r49-clean2', check: async (page) => page.evaluate(async () => {
  const A = window.HP.App; const out = {};
  const hosts = await A.rpc('host.list').catch(() => []);
  for (const h of (hosts || [])) if (h.name === 'O14靶机' || h.name === 'R49靶机') { out.deleted = (out.deleted || []).concat(h.name); await A.rpc('host.delete', { id: h.id }); }
  out.hostsLeft = (await A.rpc('host.list').catch(() => [])).map((x) => x.name);
  out.keysLeft = (await A.rpc('key.list').catch(() => [])).map((x) => x.name);
  return out;
})};
