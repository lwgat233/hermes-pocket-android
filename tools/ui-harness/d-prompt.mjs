export default {
  name: 'debug: Hermes 页里的系统提示词行',
  check: async (page) => {
    const r1 = await page.evaluate(() => ({
      hasRemote: typeof HP.Remote,
      hasParse: typeof (HP.Remote && HP.Remote.parsePrompt),
      hermesTabLen: (document.getElementById('tab-hermes') || {}).innerHTML ? document.getElementById('tab-hermes').innerHTML.length : -1
    }));
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(1500);
    const r2 = await page.evaluate(async () => {
      const el = document.getElementById('tab-hermes');
      const cache = HP.Panels._hermesCache;
      let promptCall = null;
      try { promptCall = await HP.Remote.prompt({ chars: 300 }); } catch (e) { promptCall = { err: String(e.message || e) }; }
      return {
        on: el.classList.contains('on'),
        len: el.innerHTML.length,
        head: el.innerHTML.slice(0, 260),
        hasSlot: !!el.querySelector('#hp-prompt-slot'),
        hasRow: !!el.querySelector('[data-testid="remote-prompt"]'),
        cacheKeys: cache ? Object.keys(cache) : null,
        promptOk: promptCall && promptCall.ok,
        promptErr: promptCall && promptCall.err,
        promptTextLen: promptCall && promptCall.text ? promptCall.text.length : 0,
        calls: window.__calls
      };
    });
    return { r1, r2 };
  }
};
