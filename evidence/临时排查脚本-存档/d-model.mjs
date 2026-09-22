export default {
  name: 'debug: 模型行',
  check: async (page) => {
    await page.evaluate(() => {
      window.__modelName = 'deepseek-v4-flash';
      window.__modelRaw = () => '@@PATH /home/x/config.yaml\\n@@W 1\\n@@MODEL ' + window.__modelName +
        '\\n@@PROVIDER deepseek\\n@@BASE b\\n@@CAND deepseek-v4-pro,deepseek-flash\\n@@BAKS bak1';
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(1500);
    return page.evaluate(async () => {
      const el = document.getElementById('tab-hermes');
      const parsed = HP.Remote.parseModel(window.__modelRaw());
      const direct = await HP.Remote.model();
      return {
        on: el.classList.contains('on'),
        hasSlot: !!el.querySelector('#hp-prompt-slot'),
        rows: [...el.querySelectorAll('[data-testid]')].map((r) => r.dataset.testid),
        cacheKeys: HP.Panels._hermesCache ? Object.keys(HP.Panels._hermesCache) : null,
        cacheModel: HP.Panels._hermesCache ? HP.Panels._hermesCache.model : null,
        parsedOk: parsed.ok, parsedModel: parsed.model, parsedCand: parsed.candidates,
        directOk: direct.ok, directModel: direct.model, directErr: direct.err,
        calls: window.__calls,
        head: el.innerHTML.slice(0, 200)
      };
    });
  }
};
