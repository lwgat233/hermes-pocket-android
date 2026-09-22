/* F-UI-9 判据（完整版）：设置改完**当场生效**、界面能**回读**、重载后**保持**。
 * 走真实路径：设置页里的 [data-pref] 控件 → dispatchEvent('change')（面板监听的就是它）。 */
const setPref = (page, k, v, type) => page.evaluate(([k, v, type]) => {
  const c = document.querySelector(`#tab-settings [data-pref="${k}"]`);
  if (!c) throw new Error('设置页里没有控件: ' + k);
  if (type === 'checkbox') c.checked = v; else c.value = String(v);
  c.dispatchEvent(new Event('change', { bubbles: true }));
}, [k, v, type]);

const read = (page) => page.evaluate(() => {
  const t = HP.App.term;
  const rows = document.querySelector('.xterm-rows');
  return {
    optFont: t.options.fontSize,
    cssFont: rows ? getComputedStyle(rows).fontSize : null,
    cols: t.cols, rows: t.rows,
    scrollback: t.options.scrollback,
    keybarHidden: document.getElementById('keybar').classList.contains('hidden'),
    composerHidden: document.getElementById('composer').classList.contains('hidden'),
    stEff: (document.getElementById('st-eff') || {}).textContent || null,
    inpFont: (document.querySelector('#tab-settings [data-pref="fontSize"]') || {}).value,
    inpScroll: (document.querySelector('#tab-settings [data-pref="scrollback"]') || {}).value,
    inpKeybar: !!(document.querySelector('#tab-settings [data-pref="showKeybar"]') || {}).checked,
    prefFont: HP.App.prefs.fontSize,
    prefScroll: HP.App.prefs.scrollback,
    prefKeybar: HP.App.prefs.showKeybar
  };
});

export default {
  name: 'F-UI-9 设置生效 / 回读 / 持久化（字号 + 回滚上限 + 开关）',

  boot: (page) => read(page),

  set: async (page) => {
    const before = await read(page);
    await setPref(page, 'fontSize', '20');
    await page.waitForTimeout(500);
    const font = await read(page);
    await setPref(page, 'scrollback', '1000');
    await page.waitForTimeout(400);
    const scroll = await read(page);
    await setPref(page, 'showKeybar', false, 'checkbox');
    await page.waitForTimeout(400);
    const kb = await read(page);
    return {
      before, font, scroll, kb,
      字号当场生效: font.optFont === 20 && font.cssFont === '20px' && font.cols !== before.cols,
      回滚上限当场生效: scroll.scrollback === 1000,
      开关当场生效: kb.keybarHidden === true,
      界面回读生效值: /字号 20px/.test(kb.stEff || '') && /回滚 1000 行/.test(kb.stEff || ''),
      控件显示与生效一致: kb.inpFont === '20' && kb.inpScroll === '1000' && kb.inpKeybar === false
    };
  },

  afterReload: async (page) => {
    const r = await read(page);
    return {
      ...r,
      重载后字号仍是20: r.optFont === 20 && r.cssFont === '20px',
      重载后回滚上限仍是1000: r.scrollback === 1000,
      重载后键条仍是关的: r.keybarHidden === true,
      重载后控件显示一致: r.inpFont === '20' && r.inpScroll === '1000' && r.inpKeybar === false
    };
  }
};
