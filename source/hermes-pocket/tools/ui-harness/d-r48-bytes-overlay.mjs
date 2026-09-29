/* R-48#3 定位探针：① 各条路径**发出的字节 hex**（在 HP.App.send 口子上记账）
 *                ② 连接流程后**浮层残留**（.hp-dialog / .card 计数）+ 「显示终端」按钮的 elementFromPoint
 *                ③ 两个 ⏎ 元素的**选择器与矩形**（键条 ⏎ vs 输入框 #csend）
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r48-bytes-overlay.mjs
 */
export default {
  name: 'R-48#3：发送字节（hex）+ 浮层残留与命中 + 两个 ⏎ 的尺寸',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      window.__sent = [];
      if (!window.__patched) {
        const orig = HP.App.send.bind(HP.App);
        HP.App.send = (d) => { window.__sent.push(String(d)); return orig(d); };
        window.__patched = true;
      }
      window.__hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
      window.__hexes = () => window.__sent.map(window.__hex);
      window.__clear = () => { window.__sent = []; };
      window.__counts = () => ({
        hpDialog: document.querySelectorAll('.hp-dialog').length,
        cardInDialog: document.querySelectorAll('.hp-dialog .card').length,
        tkSheet: document.querySelectorAll('#tk-sheet, .tk-sheet').length,
        stageChildren: document.getElementById('stage').children.length,
        bodyChildren: document.body.children.length,
      });
      window.__topAt = (sel) => {
        const el0 = document.querySelector(sel);
        if (!el0) return { sel, err: '没有这个元素' };
        const b = el0.getBoundingClientRect();
        const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
        return { sel, 矩形: [Math.round(b.width), Math.round(b.height)],
                 top: t ? (t.id ? '#' + t.id : (typeof t.className === 'string' && t.className ? '.' + t.className.split(' ')[0] : t.tagName)) : null };
      };
      HP.App.closePanel();
      HP.App.showBoard('host');
      HP.App.toggleTerm(true);
      await new Promise((r) => setTimeout(r, 300));
    });
    await page.waitForTimeout(300);

    /* ① 字节：四条路径 */
    await page.evaluate(async () => {
      window.__clear();
      HP.App.setPref('liveComposer', true, { apply: false });
      HP.App.toggleComposer(true);
    });
    await page.waitForTimeout(300);
    const cin = await page.evaluate(() => {
      const b = document.getElementById('cinput').getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    });
    await page.mouse.click(cin.x, cin.y);
    await page.waitForTimeout(200);

    /* 路径 1：真软键盘 Enter */
    await page.evaluate(() => window.__clear());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    out['01_真软键盘Enter'] = await page.evaluate(() => ({ hex: window.__hexes() }));

    /* 路径 2：键条 ⏎（真点） */
    out['02_键条回车'] = await page.evaluate(async () => {
      const keys = [...document.querySelectorAll('#keybar .key')];
      const cr = keys.find((k) => (k.textContent || '').trim() === '⏎');
      if (!cr) return { err: '没找到键条 ⏎' };
      const touched = [];
      let n = cr.parentElement;
      while (n && n.id !== 'keybar') { if (n.classList.contains('hidden')) { n.classList.remove('hidden'); touched.push(n); } n = n.parentElement; }
      await new Promise((x) => setTimeout(x, 60));
      const b = cr.getBoundingClientRect();
      const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      window.__clear();
      (t && t.closest('.key') ? t.closest('.key') : cr).click();
      await new Promise((x) => setTimeout(x, 250));
      touched.forEach((el) => el.classList.add('hidden'));
      return { hex: window.__hexes(), 选择器: '#keybar .key（文案 ⏎）',
               矩形: [Math.round(b.width), Math.round(b.height)],
               整条最小键高: Math.min(...keys.filter((k) => k.getBoundingClientRect().height > 0).map((k) => Math.round(k.getBoundingClientRect().height))) };
    });

    /* 路径 3：输入框那颗 ⏎ (#csend) —— 真点 */
    out['03_输入框回车'] = await page.evaluate(async () => {
      const b = document.getElementById('csend').getBoundingClientRect();
      const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      window.__clear();
      if (t && t.id === 'csend') t.click(); else document.getElementById('csend').click();
      await new Promise((x) => setTimeout(x, 250));
      return { 选择器: '#csend', 矩形: [Math.round(b.width), Math.round(b.height)],
               elementFromPoint: t ? (t.id ? '#' + t.id : t.tagName) : null, hex: window.__hexes() };
    });

    /* 路径 4：键条 Ctrl+C（控制字符那条路） */
    out['04_键条CtrlC'] = await page.evaluate(async () => {
      const keys = [...document.querySelectorAll('#keybar .key')];
      const cc = keys.find((k) => /ctrl\s*\+?\s*c/i.test(k.textContent || '') || /^(Ctrl|CTRL)$/i.test((k.textContent || '').trim()));
      if (!cc) return { err: '没找到 Ctrl 类键', 键条文案: keys.map((k) => (k.textContent || '').trim()).slice(0, 20) };
      let n = cc.parentElement, touched = [];
      while (n && n.id !== 'keybar') { if (n.classList.contains('hidden')) { n.classList.remove('hidden'); touched.push(n); } n = n.parentElement; }
      await new Promise((x) => setTimeout(x, 60));
      window.__clear();
      cc.click();
      await new Promise((x) => setTimeout(x, 200));
      touched.forEach((el) => el.classList.add('hidden'));
      return { 文案: (cc.textContent || '').trim(), hex: window.__hexes() };
    });

    /* ② 浮层：连接流程（连点三次 + 打开/关闭各面板）后计数 */
    out['05_浮层_基线'] = await page.evaluate(() => window.__counts());
    out['06_浮层_连接流程后'] = await page.evaluate(async () => {
      const before = window.__counts();
      const hosts = (HP.App.hosts || []).map((h) => h.id);
      const tries = [];
      for (let i = 0; i < 3; i++) {
        try { await HP.App.connect(hosts[0]); tries.push('connect ok'); }
        catch (e) { tries.push('connect err: ' + String(e && e.message).slice(0, 40)); }
        await new Promise((r) => setTimeout(r, 200));
      }
      try { HP.App.confirm && HP.App.confirm('探针：确认框', '确定').catch(() => { }); } catch (e) { }
      await new Promise((r) => setTimeout(r, 200));
      return { 连接尝试: tries, 前: before, 后: window.__counts() };
    });
    out['07_按钮命中_基线'] = await page.evaluate(() => window.__topAt('#btn-term'));
    out['08_按钮命中_有浮层时'] = await page.evaluate(async () => {
      HP.UI.sheet({ title: '探针：浮层', text: 'x' });          /* 挂一个浮层，看按钮还被命中吗 */
      await new Promise((r) => setTimeout(r, 150));
      const r = window.__topAt('#btn-term');
      document.querySelectorAll('.hp-dialog').forEach((d) => d.remove());
      return r;
    });
    out['09_两个回车对照'] = await page.evaluate(() => ({ 键条: '#keybar .key（⏎）', 输入框: '#csend' }));
    out['10_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
