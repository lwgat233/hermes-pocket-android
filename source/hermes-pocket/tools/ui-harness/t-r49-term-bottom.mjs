/* R-49 验收探针：点终端 / 进终端页即贴底；新输出贴底跟随；手动上翻后不被硬拽回去；重画不顶回顶部。
 * 读数取 xterm 自己的滚动容器 `.xterm-viewport`（scrollTop / scrollHeight / clientHeight）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r49-term-bottom.mjs
 */
export default {
  name: 'R-49 验收：终端页一进/一点即到最底，且不拽回手动上翻的位置',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(async () => {
      HP.App.sessionId = HP.App.sessionId || 's1';
      HP.App.state = 'connected';
      HP.App.showBoard('host');
      HP.App.toggleTerm(true);            /* R-58 起终端默认收起 ⇒ 本探针要先展开才量得到滚动容器 */
      await new Promise((r) => setTimeout(r, 300));
      /* 灌够高的内容，让终端真的能滚 */
      for (let i = 1; i <= 200; i++) HP.App.term.write('R-49 行 ' + i + '\r\n');
      await new Promise((r) => setTimeout(r, 300));
      window.__vp = () => document.querySelector('.xterm-viewport');
      window.__m = () => {
        const v = window.__vp();
        return { scrollTop: Math.round(v.scrollTop), scrollHeight: Math.round(v.scrollHeight), clientHeight: Math.round(v.clientHeight), 离底: Math.round(v.scrollHeight - v.clientHeight - v.scrollTop) };
      };
      window.__write = (n) => { for (let i = 0; i < n; i++) HP.App.term.write('新输出行 ' + i + '\r\n'); };
      window.__scrollUp = (px) => {
        const v = window.__vp();
        v.scrollTop = Math.max(0, v.scrollTop - px);
        v.dispatchEvent(new Event('scroll', { bubbles: true }));
      };
      window.__tapStage = () => {
        const st = document.getElementById('stage');
        const r = st.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        const mk = (type) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true });
        st.dispatchEvent(mk('pointerdown'));
        st.dispatchEvent(mk('pointerup'));
      };
    });
    await page.waitForTimeout(400);

    /* 先手动上翻，确认"真的能离开底部"（不然下面几条判据没意义） */
    out['00_可上翻'] = await page.evaluate(() => {
      window.__scrollUp(400);
      return window.__m();
    });

    /* ① 点一下终端 ⇒ 贴底；进页瞬间（同拍 + 2 帧）/1 秒后/新输出后各一次读数 */
    out['01_点终端即贴底'] = await page.evaluate(async () => {
      window.__tapStage();
      const 同拍 = window.__m();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   /* xterm 的贴底走 rAF，量"下一帧" */
      const 两帧后 = window.__m();
      await new Promise((r) => setTimeout(r, 1000));
      const 一秒后 = window.__m();
      window.__write(30);
      await new Promise((r) => setTimeout(r, 300));
      const 新输出后 = window.__m();
      return { 同拍, 两帧后, 一秒后, 新输出后 };
    });

    /* ①b 关掉盖层（= "进终端页"）也贴底 */
    out['02_进页即贴底'] = await page.evaluate(async () => {
      window.__scrollUp(500);
      const 上翻后 = window.__m();
      HP.App.openPanel();
      await new Promise((r) => setTimeout(r, 200));
      HP.App.closePanel();
      await new Promise((r) => setTimeout(r, 200));
      return { 上翻后, 关盖层后: window.__m() };
    });

    /* ② 手动上翻 + 新输出 ⇒ 位置不变（别硬拽回底部）；在底部时新输出 ⇒ 继续跟随 */
    out['03_上翻后不拽回'] = await page.evaluate(async () => {
      window.__scrollUp(600);
      const 上翻 = window.__m();
      window.__write(40);
      await new Promise((r) => setTimeout(r, 300));
      const 新输出后 = window.__m();
      return { 上翻, 新输出后, '位置没被拽回底部': Math.abs(新输出后.scrollTop - 上翻.scrollTop) <= 2 };
    });

    /* ③ 连续 3 次重画/刷新 ⇒ 位置不被顶回顶部 */
    out['04_重画不顶回'] = await page.evaluate(async () => {
      const start = window.__m();
      for (let i = 0; i < 3; i++) {
        HP.App.resetGeometry();
        HP.App.showBoard('host');
        await new Promise((r) => setTimeout(r, 150));
      }
      const after = window.__m();
      return { 重画前: start, 重画后: after, '没被顶回顶部': Math.abs(after.scrollTop - start.scrollTop) <= 2 };
    });

    /* ④ 贴底时新输出继续跟随（回到底部后再验一次） */
    out['05_贴底时跟随'] = await page.evaluate(async () => {
      HP.App.snapToBottom();
      await new Promise((r) => setTimeout(r, 100));
      const 贴底 = window.__m();
      window.__write(25);
      await new Promise((r) => setTimeout(r, 300));
      return { 贴底, 新输出后: window.__m() };
    });

    out['06_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
