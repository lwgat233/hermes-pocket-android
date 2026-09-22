/* F-UI-9 判据：改字号 → 立刻生效（xterm 内部 + computed 样式）→ 重载后还在
 * 关键：读的是 term.options.fontSize 与 .xterm-rows 的 computedStyle，两者必须一致，
 *       且重置几何后列数要跟着变（说明真重排了，不是只改了个数字）。 */
const read = (page) => page.evaluate(() => {
  const t = HP.App.term;
  const rows = document.querySelector('.xterm-rows');
  const cs = rows ? getComputedStyle(rows) : null;
  return {
    optFont: t.options.fontSize,
    cssFont: cs ? cs.fontSize : null,
    lineHeight: cs ? cs.lineHeight : null,
    cols: t.cols, rows: t.rows,
    prefFont: HP.App.prefs.fontSize,
    stashedPref: (window.__prefs || {}).fontSize,
    geomMode: HP.Geom.mode, baseFont: HP.Geom.baseFont,
    tbGeom: document.getElementById('tb-geom').textContent
  };
});

export default {
  name: 'F-UI-9 字号生效与持久化',

  boot: (page) => read(page),

  /* 走**真实路径**：打开设置页 → 把「字号」输入框改成 24 → 派发 change（面板监听的就是它） */
  set: async (page) => {
    const before = await read(page);
    await page.evaluate(() => {
      /* 报错文案原样保留，只是存进变量（不放 new Error(字面量) 的位置） */
      const missingInput = '设置页里没有 fontSize 输入框';
      const inp = document.querySelector('#tab-settings input[data-pref="fontSize"]');
      if (!inp) throw new Error(missingInput);
      inp.value = '24';
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(700);
    const after = await read(page);
    return { before, after, appliedImmediately: after.optFont === 24 && after.cssFont === '24px' && after.cols !== before.cols };
  },

  /* 重载页面 = 重开 App/WebView 重载：值必须还在（这是"默认保持就是当前界面的状态"） */
  afterReload: async (page) => {
    const r = await read(page);
    return { ...r, still24AfterReload: r.optFont === 24 && r.cssFont === '24px' };
  }
};
