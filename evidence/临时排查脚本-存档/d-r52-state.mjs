/* diag: what does the chat page look like after openRole in the harness */
export default {
  name: 'diag R-52 chat page state',
  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
    await page.evaluate(() => {
      window.__c = { thread: 0, since: 0, roles: 0 };
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.roles') { window.__c.roles++; return reply(m._rid, { scenes: [{ name: 's', roles: [{ full_name: 'pipeline.author', title: '作者', online: true }] }], channels: [] }); }
        if (m && m.t === 'talk.sessions') return reply(m._rid, { sessions: [] });
        if (m && m.t === 'talk.thread') { window.__c.thread++; return reply(m._rid, { role: m.role, count: 2, items: [
          { id: 101, who: 'him', body: '他说的第一条', at: 1000 },
          { id: 102, who: 'me', body: '成功那条', at: 1100, send_state: 'sent', send_note: { ms: 3330 } }, { id: 104, who: 'me', body: '失败那条', at: 1300, send_state: 'failed', send_note: { reason: 'r52.nosuch 没有会话' } }] }); }
        if (m && m.t === 'talk.since') { window.__c.since++; return reply(m._rid, { last: 200, count: 0, messages: [] }); }
        return orig(t);
      };
    });
    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.showBoard('talk');
      HP.Talk.roles = [{ full_name: 'pipeline.author', title: '作者', online: true }];
      await HP.Talk.openRole('pipeline.author');
      await new Promise((r) => setTimeout(r, 500));
    });
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => {
      const a = [...document.querySelectorAll('#tk-chat')];
      a.sort((x, y) => y.querySelectorAll('.tk-bub').length - x.querySelectorAll('.tk-bub').length);
      const box = a[0];
      return {
        view: HP.Talk.view, rolesLen: HP.Talk.roles.length,
        calls: JSON.parse(JSON.stringify(window.__c)),
        chatContainers: a.length,
        bubbleIds: box ? [...box.querySelectorAll('.tk-bub')].map((b) => b.getAttribute('data-msg')) : [],
        icons: box ? [...box.querySelectorAll('.tk-ic')].map((i) => i.getAttribute('data-msg') + ':' + i.className) : [],
        stateOf: [HP.Talk.stateOf({ send_state: 'failed' }), HP.Talk.stateOf({ send_state: 'sent' }), HP.Talk.stateOf({})],
        failIcon: box ? !!box.querySelector('.tk-ic-fail') : null,
        rows: box ? [...box.querySelectorAll('.tk-bub')].map((b) => b.getAttribute('data-msg') + '|' + Math.round(b.getBoundingClientRect().height)) : []
      };
    });
    return { st, errs: errs.slice(0, 6) };
  }
};
