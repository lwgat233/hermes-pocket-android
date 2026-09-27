/* R-48 验收探针：终端页 #cinput 软键盘回车能发出（恰好 1 个 0x0D）、防重复、键条 ⏎ 不回归、命中区 ≥44dp。
 * 手法照既有验收探针 t-composer.mjs：真焦点（点输入框）+ 真按键（playwright 真键），
 * 计数用 `HP.App.send` 打点（在发送口记账，比解 base64 直接）。
 * 真机 IME 的 Enter 形状（keydown key="Enter"+keyCode=13+isComposing=true，无 beforeinput/input）只能合成补测。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r48-cr.mjs
 */
export default {
  name: 'R-48 验收：终端页软键盘回车发 1 个 \\r（keydown+keyup 只发一遍）',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      window.__sent = [];
      const origSend = HP.App.send.bind(HP.App);
      HP.App.send = (d) => { window.__sent.push(String(d)); return origSend(d); };
      await HP.App.setPref('liveComposer', true, { apply: false });      /* 实时模式 */
      await HP.App.setPref('showKeybar', true, { apply: false });
      HP.App.closePanel();
      HP.App.showBoard('host');
      HP.App.applyKeybar && HP.App.applyKeybar();
      HP.App.toggleComposer(true);
      /* 真机 IME 的 Enter 形状（合成补测用） */
      window.__imeEnter = (el) => {
        const kd = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
        Object.defineProperty(kd, 'keyCode', { get: () => 13 });
        el.dispatchEvent(kd);
        const ku = new KeyboardEvent('keyup', { key: 'Enter', isComposing: true, bubbles: true });
        Object.defineProperty(ku, 'keyCode', { get: () => 13 });
        el.dispatchEvent(ku);
      };
      window.__cr = () => window.__sent.join('').split('\r').length - 1;
      window.__clear = () => { window.__sent = []; };
    });
    await page.waitForTimeout(500);

    /* 真点输入框拿焦点（与用户手点同一条路） */
    const r = await page.evaluate(() => {
      const b = document.getElementById('cinput').getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    });
    await page.mouse.click(r.x, r.y);
    await page.waitForTimeout(250);

    out['00_环境'] = await page.evaluate(() => ({
      '输入框在': !!document.getElementById('cinput'),
      '实时模式': !!HP.App.liveInput(),
      '键条可见': !document.getElementById('keybar').classList.contains('hidden'),
      'enterkeyhint': document.getElementById('cinput').getAttribute('enterkeyhint'),
      '焦点在输入框': document.activeElement && document.activeElement.id === 'cinput'
    }));

    /* ① 真按键回车（实时模式）⇒ 恰好 1 个 0x0D */
    await page.evaluate(() => window.__clear());
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
    out['01_真按键回车'] = await page.evaluate(() => ({ '收到0x0D个数': window.__cr(), '原文': window.__sent.slice() }));

    /* ①b 真机 IME 形状回车（keydown+keyup，isComposing=true，无 beforeinput）⇒ 恰好 1 个 0x0D */
    await page.evaluate(() => window.__clear());
    await page.evaluate(() => window.__imeEnter(document.getElementById('cinput')));
    await page.waitForTimeout(250);
    out['02_IME形状回车'] = await page.evaluate(() => ({ '收到0x0D个数': window.__cr(), '原文': window.__sent.slice() }));

    /* ①c 实时打字真进终端（真按键逐字）+ 框里不留（不新增 0x0D） */
    await page.evaluate(() => window.__clear());
    await page.keyboard.type('ls');
    await page.waitForTimeout(250);
    out['03_实时打字'] = await page.evaluate(() => ({ '收到': window.__sent.slice(), '0x0D个数': window.__cr(), '框里还有字吗': document.getElementById('cinput').value }));

    /* ④ 连按 3 次 ⇒ 3 个 0x0D（不多不少） */
    await page.evaluate(() => window.__clear());
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(450); }
    await page.waitForTimeout(200);
    out['04_连按三次'] = await page.evaluate(() => ({ '收到0x0D个数': window.__cr(), '原文': window.__sent.slice() }));

    /* ⑤ 键条 ⏎ 仍恰好 1 个 0x0D（真点键）+ 命中区尺寸
     * ⏎ 在 TUI 那一行里（shell 模式下这行是 hidden、量为 0）⇒ 量尺寸前**临时把那一行显示出来**，量完还原。 */
    out['05_键条回车'] = await page.evaluate(async () => {
      const keys = [...document.querySelectorAll('#keybar .key')];
      const cr = keys.find((k) => (k.textContent || '').trim() === '⏎');
      if (!cr) return { error: '没找到键条的 ⏎' };
      const touched = [];
      let n = cr.parentElement;
      while (n && n.id !== 'keybar') { if (n.classList.contains('hidden')) { n.classList.remove('hidden'); touched.push(n); } n = n.parentElement; }
      await new Promise((x) => setTimeout(x, 60));
      const b = cr.getBoundingClientRect();
      const target = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      window.__clear();
      (target && target.closest('.key') ? target.closest('.key') : cr).click();
      await new Promise((x) => setTimeout(x, 250));
      const visible = keys.filter((k) => k.getBoundingClientRect().height > 0);
      const heights = visible.map((k) => Math.round(k.getBoundingClientRect().height));
      const res = {
        '收到0x0D个数': window.__cr(), '原文': window.__sent.slice(),
        '回车键宽': Math.round(b.width), '回车键高': Math.round(b.height),
        '可见键数': visible.length, '键高最小': heights.length ? Math.min(...heights) : null, '键高最大': heights.length ? Math.max(...heights) : null,
        '全部可见键都≥44高': heights.length > 0 && heights.every((h) => h >= 44),
        '临时显示过几层': touched.length
      };
      touched.forEach((el) => el.classList.add('hidden'));
      return res;
    });

    /* ⑥ keyCode===229 的合成中间态不该发（口径③） */
    await page.evaluate(() => window.__clear());
    out['06_229不发'] = await page.evaluate(() => {
      const el = document.getElementById('cinput');
      const kd = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
      Object.defineProperty(kd, 'keyCode', { get: () => 229 });
      el.dispatchEvent(kd);
      const ku = new KeyboardEvent('keyup', { key: 'Enter', isComposing: true, bubbles: true });
      Object.defineProperty(ku, 'keyCode', { get: () => 229 });
      el.dispatchEvent(ku);
      return { '收到0x0D个数': window.__cr() };
    });

    /* ⑥b 长按（自动重复的 keydown，e.repeat=true）不该刷屏：一次按下 + 5 次重复 ⇒ 仍 1 个 0x0D */
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__clear());
    out['06b_长按不刷屏'] = await page.evaluate(() => {
      const el = document.getElementById('cinput');
      const mk = (rep) => {
        const e = new KeyboardEvent('keydown', { key: 'Enter', repeat: !!rep, isComposing: true, bubbles: true, cancelable: true });
        Object.defineProperty(e, 'keyCode', { get: () => 13 });
        return e;
      };
      el.dispatchEvent(mk(false));
      for (let i = 0; i < 5; i++) el.dispatchEvent(mk(true));
      return { '收到0x0D个数': window.__cr() };
    });

    out['07_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
