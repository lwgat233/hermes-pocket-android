/* R-47/R-48：装 rpc 计数器 / 读计数器 */
export default {
  name: 'r47-rpc-count',
  check: async (page) => {
    const mode = process.env.ACTION || 'read';
    await page.waitForTimeout(300);
    return page.evaluate((m) => {
      const A = window.HP.App;
      if (m === 'install') {
        if (window.__rpcWrapped) return { ok: true, already: true };
        const orig = A.rpc.bind(A);
        window.__rpc = [];
        A.rpc = function (op, ...rest) { window.__rpc.push(op); return orig(op, ...rest); };
        window.__rpcWrapped = true;
        return { ok: true, wrapped: true, liveComposer: A.prefs.liveComposer, csend: (document.getElementById('csend') || {}).textContent };
      }
      const all = (window.__rpc || []);
      const talk = all.filter((o) => /^talk\./.test(o));
      const bridge = all.filter((o) => /^bridge|^app\.|^key\.|^host\.|^tmux\./.test(o));
      return { n: all.length, talk: talk.length, bridge: bridge.length, ops: all.slice(-20), wrapped: !!window.__rpcWrapped };
    }, mode);
  }
};
