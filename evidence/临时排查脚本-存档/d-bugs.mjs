/* 用户这轮报的几条，先在本地台把**事实**读回来（每条都读读数，不猜原因）。
 * 键名一律加引号 —— 这个坑已经吃过三次（带空格/带符号的键会直接 SyntaxError）。
 */
export default {
  name: 'debug: 用户报的四条（未连接开抽屉 / 沉浸退出 / 切模式 / 点终端焦点）',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      HP.App.sessionId = null; HP.App.state = 'idle';
      window.__发的 = [];
      const 原 = HP.App.send.bind(HP.App);
      HP.App.send = (d) => { window.__发的.push(String(d)); return 原(d); };
    });
    await page.waitForTimeout(300);

    /* ① 没连接时点 ☰：有没有报错、有没有弹"错误"提示、抽屉能不能开 */
    out['没连接时'] = await page.evaluate(async () => {
      const 错误 = [];
      const 原err = console.error.bind(console);
      console.error = (...a) => { 错误.push(String(a[0]).slice(0, 160)); 原err(...a); };
      const toast = document.getElementById('toast');
      if (toast) toast.textContent = '';
      let 抛了 = null;
      try { HP.App.openDrawer(); } catch (e) { 抛了 = String(e).slice(0, 200); }
      await new Promise((r) => setTimeout(r, 500));
      const d = document.getElementById('drawer');
      const r = {
        '抽屉打开': d.classList.contains('show'),
        '抽屉条目数': document.querySelectorAll('#dw-body [data-testid^="board-"]').length,
        '抬头': ((document.getElementById('drawer-title') || {}).textContent || '').trim(),
        '弹出来的提示': toast ? toast.textContent.slice(0, 200) : '(没有 toast 元素)',
        '提示是否还在显示': toast ? toast.classList.contains('show') : null,
        '控制台错误': 错误.slice(0, 5),
        '抛异常': 抛了
      };
      HP.App.closeDrawer();
      return r;
    });

    /* ② 沉浸（全屏）模式：输入框在不在；退出之后 ☰ 还灵不灵、终端还能不能拖 */
    out['沉浸'] = await page.evaluate(async () => {
      const 读 = () => {
        const c = document.getElementById('composer').getBoundingClientRect();
        return {
          '输入框display': getComputedStyle(document.getElementById('composer')).display,
          '输入框矩形高': Math.round(c.height),
          '输入框在视口内': c.height > 0 && c.top >= 0 && c.bottom <= window.innerHeight + 1,
          '顶栏display': getComputedStyle(document.getElementById('topbar')).display,
          '键条display': getComputedStyle(document.getElementById('keybar')).display,
          'stage高度': Math.round(document.getElementById('stage').getBoundingClientRect().height),
          '视口高': window.innerHeight
        };
      };
      const 前 = 读();
      document.body.classList.add('immersive');
      await new Promise((r) => setTimeout(r, 300));
      const 中 = 读();
      document.body.classList.remove('immersive');
      await new Promise((r) => setTimeout(r, 400));
      const 后 = 读();
      document.getElementById('btn-panel').click();          // 退出沉浸后点 ☰
      await new Promise((r) => setTimeout(r, 450));
      const 抽屉开 = document.getElementById('drawer').classList.contains('show');
      const b = document.getElementById('btn-panel').getBoundingClientRect();
      const 落点 = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      HP.App.closeDrawer();
      await new Promise((r) => setTimeout(r, 200));
      // 上下滑动到底有没有效果：先喂 200 行（缓冲比屏幕高），再拖 —— 正常屏应当真的滚（viewportY 变小）
      const 拖 = {};
      const 喂 = () => {
        const 行 = [];
        for (let i = 1; i <= 200; i += 1) 行.push('line ' + i);
        HP.App.onData({ data: HP.b64encode(HP.enc.encode(行.join('\r\n') + '\r\n')), seq: 500 });
      };
      const 拖一次 = () => {
        const th0 = document.getElementById('termhost').getBoundingClientRect();
        const x0 = Math.round(th0.x + th0.width / 2), y1 = Math.round(th0.y + th0.height * 0.3);
        const 派 = (t2, y) => document.getElementById('stage').dispatchEvent(new PointerEvent(t2, {
          pointerId: 2, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x0, clientY: y
        }));
        const 前 = HP.App.term.buffer.active.viewportY;
        派('pointerdown', y1);
        for (let i = 1; i <= 9; i += 1) 派('pointermove', y1 + i * 22);   // 往下拖 = 看更早的内容
        派('pointerup', y1 + 198);
        return 前;
      };
      喂();
      await new Promise((r) => setTimeout(r, 500));
      拖.底部 = { 'viewportY': HP.App.term.buffer.active.viewportY, 'baseY': HP.App.term.buffer.active.baseY };
      const 拖前 = 拖一次();
      await new Promise((r) => setTimeout(r, 400));
      拖.拖之前 = 拖前;
      拖.拖之后 = HP.App.term.buffer.active.viewportY;
      拖.向上拖动真的滚了 = 拖.拖之后 < 拖.拖之前;
      HP.App.scrollToBottom && HP.App.scrollToBottom();
      await new Promise((r) => setTimeout(r, 300));
      const th = document.getElementById('termhost').getBoundingClientRect();
      const x = Math.round(th.x + th.width / 2), y0 = Math.round(th.y + th.height / 2);
      const 字节前 = window.__发的.length;
      const 视图前 = { viewportY: HP.App.term.buffer.active.viewportY, pan: (document.getElementById('panner').style.transform || '') };
      const 派 = (t, y) => document.getElementById('stage').dispatchEvent(new PointerEvent(t, {
        pointerId: 1, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y
      }));
      派('pointerdown', y0);
      for (let i = 1; i <= 6; i += 1) 派('pointermove', y0 - i * 18);
      派('pointerup', y0 - 108);
      await new Promise((r) => setTimeout(r, 300));
      拖['拖前后发出的字节数'] = [字节前, window.__发的.length];
      拖['发出的字节样本'] = window.__发的.slice(字节前, 字节前 + 4);
      拖['终端行数'] = HP.App.term.buffer.active.length;
      // 退出沉浸之后**再拖一次**：这才是"退出全屏后上下滑动还有没有效果"的直接判据
      const 退出后再拖 = {};
      if (HP.App.scrollToBottom) HP.App.scrollToBottom();
      await new Promise((r) => setTimeout(r, 300));
      const 退前 = 拖一次();
      await new Promise((r) => setTimeout(r, 400));
      退出后再拖['拖之前'] = 退前;
      退出后再拖['拖之后'] = HP.App.term.buffer.active.viewportY;
      退出后再拖['向上拖动真的滚了'] = 退出后再拖['拖之后'] < 退出后再拖['拖之前'];
      if (HP.App.scrollToBottom) { HP.App.scrollToBottom(); }
      await new Promise((r) => setTimeout(r, 300));
      退出后再拖['baseY'] = HP.App.term.buffer.active.baseY;
      退出后再拖['回到底部后viewportY'] = HP.App.term.buffer.active.viewportY;
      return { '进沉浸前': 前, '沉浸中': 中, '退出后': 后, '退出后点☰抽屉开': 抽屉开, '点☰那一下落在': 落点 ? 落点.tagName + '.' + String(落点.className || '').slice(0, 30) : null, '拖动': 拖, '退出后再拖': 退出后再拖 };
    });

    /* ③ 攒着 → 实时：框里的内容去哪了 */
    out['切模式'] = await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      await HP.App.setPref('liveComposer', false, { apply: false });
      const c = document.getElementById('cinput');
      c.value = 'echo hi';
      window.__发的.length = 0;
      await HP.App.toggleLiveComposer();                                  // 用户真按的那个键（走真路径）
      await new Promise((r) => setTimeout(r, 200));
      const 切到实时 = { '框里': c.value, '发的': window.__发的.slice() };
      c.value = '第二段';
      window.__发的.length = 0;
      await HP.App.toggleLiveComposer();                                  // 再按一次 = 切回攒着
      await new Promise((r) => setTimeout(r, 200));
      return { '切到实时': 切到实时, '切回攒着': { '框里': c.value, '发的': window.__发的.slice() } };
    });

    /* ④ 点终端之后的焦点 + 隐藏输入框的 inputmode（真机软键盘的总闸） */
    out['点终端'] = await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      await HP.App.setPref('tapKeyboard', false, { apply: false });
      const ta = HP.App.term.textarea;
      ta.blur();
      const r = document.getElementById('termhost').getBoundingClientRect();
      return { '点之前indtemode': ta.getAttribute('inputmode'), '中心': { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } };
    });
    await page.mouse.click(out['点终端'].中心.x, out['点终端'].中心.y);
    await page.waitForTimeout(350);
    out['点终端']['点之后'] = await page.evaluate(() => {
      const ta = HP.App.term.textarea;
      return { '焦点': document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : ''), '是隐藏输入框': document.activeElement === ta, 'inputmode': ta.getAttribute('inputmode') };
    });

    out['结论'] = {
      '没连接开抽屉不报错也不算错': out['没连接时']['控制台错误'].length === 0 && out['没连接时']['抛异常'] === null,
      '没连接时提示里没有错误字样': !/问题|错误|失败|异常/.test(out['没连接时']['弹出来的提示'] || ''),
      '没连接抽屉照样能开': out['没连接时']['抽屉打开'] === true && out['没连接时']['抽屉条目数'] > 0,
      '沉浸模式里输入框还在且看得见': out['沉浸']['沉浸中']['输入框display'] !== 'none' && out['沉浸']['沉浸中']['输入框在视口内'] === true,
      '沉浸模式顶栏与键条仍然藏起来': out['沉浸']['沉浸中']['顶栏display'] === 'none' && out['沉浸']['沉浸中']['键条display'] === 'none',
      '退出沉浸后点☰能开抽屉': out['沉浸']['退出后点☰抽屉开'] === true,
      '退出沉浸后向上拖动真的滚了': out['沉浸']['退出后再拖']['向上拖动真的滚了'] === true,
      '退出沉浸前后拖动行为一致': out['沉浸']['拖动']['向上拖动真的滚了'] === true,
      '退回底部按钮能把视图还回最新': out['沉浸']['退出后再拖']['回到底部后viewportY'] === out['沉浸']['退出后再拖']['baseY'],
      '切到实时把攒着的送出去且不加回车': out['切模式']['切到实时']['发的'].length === 1 && out['切模式']['切到实时']['发的'][0] === 'echo hi' && !/\r/.test(out['切模式']['切到实时']['发的'][0]),
      '切到实时后框里清空': out['切模式']['切到实时']['框里'] === '',
      '切回攒着不丢草稿': out['切模式']['切回攒着']['框里'] === '第二段',
      '点终端焦点不落隐藏输入框': out['点终端']['点之后']['是隐藏输入框'] === false,
      '没要键盘时inputmode是none': out['点终端']['点之后']['inputmode'] === 'none'
    };
    return out;
  }
};
