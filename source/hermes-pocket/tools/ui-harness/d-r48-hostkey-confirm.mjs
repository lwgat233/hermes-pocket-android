/* R48#5 验证探针：① hostkey 那条路（confirm = 弹窗）重复走 ⇒ pageerror 必须是 0（改前 app.js:2255 报 HP.UI 未就绪）
 *                ② 浮层不堆叠 + 「显示终端」命中仍成立（R-48#3 的修复不许丢）
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r48-hostkey-confirm.mjs
 */
export default {
  name: 'R48#5：hostkey→confirm 路径不报错 + 浮层不堆叠 + 按钮可命中',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.transport = HP.App.transport || { send() { }, rpc: async () => ({}) };
      if (!HP.App.transport.send) HP.App.transport.send = () => { };
      window.__counts = () => ({
        hpDialog: document.querySelectorAll('.hp-dialog').length,
        cardInDialog: document.querySelectorAll('.hp-dialog .card').length,
      });
      window.__topAt = (sel) => {
        const el0 = document.querySelector(sel);
        if (!el0) return { sel, err: '没有这个元素' };
        const b = el0.getBoundingClientRect();
        const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { sel, 矩形: [Math.round(b.width), Math.round(b.height)],
                 top: t ? (t.id ? '#' + t.id : (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : t.tagName)) : null };
      };
      window.__hk = (changed) => ({
        host: '127.0.0.1', port: 2222, algo: 'ssh-ed25519', fingerprint: 'SHA256:AAA',
        storedFingerprint: 'SHA256:BBB', changed: !!changed, known: false, newType: false
      });
      HP.App.closePanel();
      HP.App.showBoard('host');
      await new Promise((r) => setTimeout(r, 200));
    });
    await page.waitForTimeout(200);

    /* ① 走一遍 hostkey（changed=true ⇒ confirm 分支），再重复走 3 次 */
    out['00_复现步骤'] = 'HP.App.onHostKey({host,port,algo,fingerprint,storedFingerprint,changed:true}) ×4（第 2~4 次在弹窗还开着时再触发）';
    out['01_单次_浮层'] = await page.evaluate(async () => {
      const before = window.__counts();
      HP.App.onHostKey(window.__hk(true));
      await new Promise((r) => setTimeout(r, 250));
      return { 前: before, 后: window.__counts(), 有确认框: !!document.querySelector('.hp-dialog .btn[data-y]') };
    });
    out['02_重复4次_浮层与报错'] = await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) { HP.App.onHostKey(window.__hk(true)); await new Promise((r) => setTimeout(r, 200)); }
      return { 浮层: window.__counts() };
    });
    /* 点掉它（取消） */
    out['03_取消后_浮层'] = await page.evaluate(async () => {
      const no = document.querySelector('.hp-dialog .btn[data-n]');
      if (no) no.click();
      await new Promise((r) => setTimeout(r, 250));
      return window.__counts();
    });

    /* ② connect ×3 ⇒ 浮层 0；按钮命中＝按钮自己 */
    out['04_连接流程_浮层'] = await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) { try { await HP.App.connect(null); } catch (e) { } await new Promise((r) => setTimeout(r, 150)); }
      return window.__counts();
    });
    out['05_按钮命中'] = await page.evaluate(() => window.__topAt('#btn-term'));
    out['06_浮层时按钮命中'] = await page.evaluate(async () => {
      HP.UI.sheet({ title: '探针：浮层', text: 'x' });
      await new Promise((r) => setTimeout(r, 150));
      const r = window.__topAt('#btn-term');
      document.querySelectorAll('.hp-dialog').forEach((d) => d.remove());
      return r;
    });
    out['07_报错'] = { count: errs.length, detail: errs.slice(0, 5) };
    return out;
  }
};
