/* R-49#3 靶子探针：在**内容超一屏**的条件下量终端页的滚动读数。
 * 与 t-r49-term-bottom.mjs 的区别：① 用**真渲染路径** `HP.App.onData`（不是直接 term.write）
 * ② 灌的是宿主靶子 `tools/target-lines.sh` 的同一套文本（300 行「终端靶子-NNN 时间戳 行号=N」）
 * ③ 单独给「scrollHeight > clientHeight」这条判据的读数（tester 之前量到 561=561 是没内容可滚）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r49-target-300.mjs
 */
export default {
  name: 'R-49#3：内容超一屏（靶子 300 行，走真渲染路径）时的滚动读数',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(async () => {
      HP.App.sessionId = HP.App.sessionId || 's1';
      HP.App.state = 'connected';
      HP.App.showBoard('host');
      HP.App.toggleTerm(true);                 /* R-58：终端默认收起 ⇒ 先展开 */
      await new Promise((r) => setTimeout(r, 300));
      window.__vp = () => document.querySelector('.xterm-viewport');
      window.__m = () => {
        const v = window.__vp();
        if (!v) return { err: '没有 .xterm-viewport' };
        return { scrollTop: Math.round(v.scrollTop), scrollHeight: Math.round(v.scrollHeight),
                 clientHeight: Math.round(v.clientHeight), 离底: Math.round(v.scrollHeight - v.clientHeight - v.scrollTop) };
      };
      window.__feed = (from, to) => {
        for (let i = from; i <= to; i++) {
          const s = '终端靶子-' + String(i).padStart(3, '0') + ' 12:00:00 行号=' + i + '\r\n';
          HP.App.onData({ data: HP.b64encode(HP.enc.encode(s)), seq: i });      /* 真渲染路径 */
        }
      };
      window.__tapStage = () => {
        const st = document.getElementById('stage');
        const r = st.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        const mk = (t) => new PointerEvent(t, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true });
        st.dispatchEvent(mk('pointerdown')); st.dispatchEvent(mk('pointerup'));
      };
      window.__up = (px) => {
        const v = window.__vp();
        v.scrollTop = Math.max(0, v.scrollTop - px);
        v.dispatchEvent(new Event('scroll', { bubbles: true }));
      };
    });
    await page.waitForTimeout(300);

    out['00_空终端'] = await page.evaluate(() => window.__m());
    out['01_灌300行后'] = await page.evaluate(async () => {
      window.__feed(1, 300);
      await new Promise((r) => setTimeout(r, 600));
      const m = window.__m();
      m['有滚动空间'] = m.scrollHeight > m.clientHeight;
      m['超出一屏的像素'] = m.scrollHeight - m.clientHeight;
      m['行高约'] = m.scrollHeight > 0 ? Math.round((m.scrollHeight - m.clientHeight) / 300 * 100) / 100 : null;
      return m;
    });
    out['02_点终端即贴底'] = await page.evaluate(async () => {
      window.__up(400);
      const 上翻后 = window.__m();
      window.__tapStage();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const 两帧后 = window.__m();
      await new Promise((r) => setTimeout(r, 800));
      return { 上翻后, 两帧后, 一秒后: window.__m() };
    });
    out['03_上翻后新输出不拽回'] = await page.evaluate(async () => {
      window.__up(600);
      const 上翻 = window.__m();
      window.__feed(301, 340);
      await new Promise((r) => setTimeout(r, 400));
      const 新输出后 = window.__m();
      return { 上翻, 新输出后, 位置没被拽回: Math.abs(新输出后.scrollTop - 上翻.scrollTop) <= 2,
               上翻时离底: 上翻.离底, 新输出后离底: 新输出后.离底 };
    });
    out['04_贴底时跟随'] = await page.evaluate(async () => {
      HP.App.snapToBottom();
      await new Promise((r) => setTimeout(r, 200));
      const 贴底 = window.__m();
      window.__feed(341, 365);
      await new Promise((r) => setTimeout(r, 400));
      return { 贴底, 新输出后: window.__m() };
    });
    out['05_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
