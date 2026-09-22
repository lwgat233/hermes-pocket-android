/* 用户报的「没连接的时候点 ☰ 报错」（N-1）：
 * 根因是**我自己**在开抽屉时跑功能自检，并把"还没渲染"当成"栏目登记有问题"弹了一条像错误的提示。
 * 判据：① 开抽屉不抛异常、不写控制台错误；② 抽屉照样打开、条目照常列出；
 *      ③ 不再弹带"问题/错误/失败"字样的提示；④ 自检里那三条落进「未渲染」，不落进「没挂上」。
 */
export default {
  name: '没连接时开抽屉：不报错 · 照样能用 · 自检分清「未渲染」',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => { HP.App.sessionId = null; HP.App.state = 'idle'; });
    await page.waitForTimeout(300);

    out.readings = await page.evaluate(async () => {
      const errors = [];
      const origErr = console.error.bind(console);
      console.error = (...a) => { errors.push(String(a[0]).slice(0, 160)); origErr(...a); };
      const toast = document.getElementById('toast');
      if (toast) { toast.textContent = ''; toast.classList.remove('show'); }
      let thrown = null;
      try { HP.App.openDrawer(); } catch (e) { thrown = String(e).slice(0, 200); }
      await new Promise((r) => setTimeout(r, 500));
      const d = document.getElementById('drawer');
      const selfCheck = HP.Registry.check();
      const r = {
        drawerOpen: d.classList.contains('show'),
        itemCount: document.querySelectorAll('#dw-body [data-testid^="board-"]').length,
        itemNames: [...document.querySelectorAll('#dw-body [data-testid^="board-"]')]
          .map((e) => e.getAttribute('data-testid').replace('board-', '')),
        toastText: toast ? toast.textContent.slice(0, 200) : '',
        toastVisible: toast ? toast.classList.contains('show') : null,
        consoleErrors: errors.slice(0, 5),
        thrownError: thrown,
        selfCheckNotRendered: selfCheck.notRendered,
        selfCheckNotMounted: selfCheck.notMounted
      };
      HP.App.closeDrawer();
      console.error = origErr;
      return r;
    });

    /* 真点一次 ☰（走用户手点的路），确认不是"只有内部调用能用" */
    await page.evaluate(() => HP.App.closeDrawer());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('btn-panel').click());
    await page.waitForTimeout(400);
    out.tapMenu = await page.evaluate(() => ({
      drawerOpen: document.getElementById('drawer').classList.contains('show'),
      itemCount: document.querySelectorAll('#dw-body [data-testid^="board-"]').length
    }));
    await page.evaluate(() => HP.App.closeDrawer());

    /* 期望文案：提示里不该出现这些字样（拆开只为不做正则字面量） */
    const errorWords = '问题,错误,失败,异常'.split(',');

    out.verdict = {
      'openDrawerNoThrow': out.readings.thrownError === null,
      'openDrawerNoConsoleError': out.readings.consoleErrors.length === 0,
      'openDrawerStillWorks': out.readings.drawerOpen === true && out.readings.itemCount > 0,
      'tapMenuOpensDrawer': out.tapMenu.drawerOpen === true && out.tapMenu.itemCount === out.readings.itemCount,
      'noErrorToast': !errorWords.some((w) => String(out.readings.toastText || '').includes(w)),
      'notRenderedNotMissing': out.readings.selfCheckNotMounted.length === 0 && out.readings.selfCheckNotRendered.length > 0,
      'noDeadEntries': out.readings.itemNames.length === 6
    };
    return out;
  }
};
