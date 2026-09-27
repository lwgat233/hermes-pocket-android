/* 用 App 自己的 API 连上靶机（连接属"准备"，不是判据；真实点击连上已在早先一轮验过并留档） */
export default {
  name: 'r47-connect-api',
  check: async (page) => {
    const r = await page.evaluate(async () => {
      const A = window.HP.App;
      const list = await A.rpc('host.list').catch(() => []);
      const h = (list || []).find((x) => x.name === '靶机-r47');
      if (!h) return { ok: false, hosts: (list || []).map((x) => x.name) };
      try { A.closePanel && A.closePanel(); } catch (e) { }
      await A.connect(h.id);
      await new Promise((r2) => setTimeout(r2, 6000));
      return { ok: true, host: h.name + '@' + h.host + ':' + h.port, connected: !!(A.transport && A.transport.alive), sessionId: A.sessionId, topbar: document.getElementById('tb-title').textContent + ' / ' + document.getElementById('tb-badge').textContent, termTail: (document.getElementById('termsizer') || {}).innerText ? document.getElementById('termsizer').innerText.slice(-160) : null };
    });
    return r;
  }
};
