export default {
  name: 'R-40 调试：rpc 命中 / 缓存写入 / 会话页元素',
  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
    await page.evaluate(() => {
      window.__hits = {};
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m) { window.__hits[m.t] = (window.__hits[m.t] || 0) + 1; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { sessions: [{ id: 6, kind: 'role', name: 'owner.me', role: 'owner.me', tmux: 'roles:owner-me', alive: true, last_used: 1 }] } }) }), 10); return; }
        return window.__orig(t);
      };
    });
    const out = {};
    await page.evaluate(() => HP.App.showBoard('talk'));
    await page.waitForTimeout(600);
    out.direct = await page.evaluate(async () => {
      const r = await HP.App.rpc('talk.sessions');
      return { keys: Object.keys(r || {}), n: ((r || {}).sessions || []).length };
    });
    out.cache = await page.evaluate(() => {
      const c = HP.Cache.get('sessions', null);
      return { empty: c ? false : true, n: c && c.sessions ? c.sessions.length : 0 };
    });
    out.hits = await page.evaluate(() => window.__hits);
    out.sessPage = await page.evaluate(async () => {
      const el = document.getElementById('tab-sessions');
      el.classList.add('on');
      await HP.Panels.renderSessions(true);
      return { html: el.innerHTML.slice(0, 200), children: el.children.length };
    });
    out.errs = errs.slice(0, 5);
    return out;
  }
};
