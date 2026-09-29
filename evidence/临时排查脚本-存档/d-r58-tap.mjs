/* R-58 调试：点终端那一下到底有没有调 snapToBottom（以及是不是被后续 resize/还原顶回去） */
export default {
  name: '调试：tap 路径 vs 直接 snapToBottom',
  check: async (page) => {
    const out = {};
    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.showBoard('host');
      HP.App.toggleTerm(true);
      await new Promise((r) => setTimeout(r, 400));
      for (let i = 1; i <= 200; i++) HP.App.term.write('行 ' + i + '\r\n');
      await new Promise((r) => setTimeout(r, 300));
      window.__m = () => {
        const v = document.querySelector('.xterm-viewport');
        return { t: Math.round(v.scrollTop), h: Math.round(v.scrollHeight), c: Math.round(v.clientHeight), 离底: Math.round(v.scrollHeight - v.clientHeight - v.scrollTop) };
      };
      window.__up = (px) => { const v = document.querySelector('.xterm-viewport'); v.scrollTop = Math.max(0, v.scrollTop - px); v.dispatchEvent(new Event('scroll', { bubbles: true })); };
      window.__tap = () => {
        const st = document.getElementById('stage'); const r = st.getBoundingClientRect();
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        const mk = (ty) => new PointerEvent(ty, { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true });
        st.dispatchEvent(mk('pointerdown')); st.dispatchEvent(mk('pointerup'));
      };
      window.__calls = 0;
      const orig = HP.App.snapToBottom.bind(HP.App);
      HP.App.snapToBottom = () => { window.__calls++; return orig(); };
    });
    await page.waitForTimeout(300);

    out['A_直接snap'] = await page.evaluate(async () => {
      window.__up(400);
      const before = window.__m();
      HP.App.snapToBottom();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { before, 两帧后: window.__m() };
    });

    out['B_点终端'] = await page.evaluate(async () => {
      window.__up(400);
      const before = window.__m();
      window.__calls = 0;
      window.__tap();
      const calls = window.__calls;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const 两帧后 = window.__m();
      await new Promise((r) => setTimeout(r, 400));
      return { before, 'snapToBottom被调次数': calls, 两帧后, '400ms后': window.__m() };
    });
    out['C_看闸'] = await page.evaluate(async () => {
      const w = HP.App.watcher || {};
      const v = document.querySelector('.xterm-viewport');
      const before = window.__m();
      window.__up(400);
      const up = window.__m();
      /* 直接调 xterm 自己的 API（绕过我那句闸） */
      HP.App.term.scrollToBottom();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const 直接API后 = window.__m();
      /* 直接设 scrollTop */
      v.scrollTop = v.scrollHeight;
      await new Promise((r) => setTimeout(r, 60));
      const 直接设scrollTop后 = window.__m();
      return {
        alt: !!w.alt, mouseMode: w.mouseMode, watcher有吗: !!HP.App.watcher,
        before, up, 直接API后, 直接设scrollTop后,
        收起态: document.body.classList.contains('term-hide')
      };
    });

    return out;
  }
};
