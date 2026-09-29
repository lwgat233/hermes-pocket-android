/* R52R53 复测：先从 hermes 会话 detach（别把键打进我自己的会话），再 attach r52t（cwd=roles-chat） */
export default {
  name: 'r52-attach',
  check: async (page) => {
    const R = {};
    const flags = () => page.evaluate(() => ({ badge: (document.getElementById('tb-badge') || {}).textContent, sel: HP.Sessions.sel, list: (HP.Sessions.list || []).map((x) => x.name), tail: (((document.querySelector('#termsizer') || {}).innerText) || '').split('\n').filter((l) => l.trim()).slice(-2).join(' | ').slice(0, 140) }));
    try {
      R['01_起'] = await flags();
      await page.evaluate(() => { window.HP.App.send('\x02d'); return 1; });   // 从 hermes detach
      await page.waitForTimeout(2500);
      R['02_detach后'] = await flags();
      await page.evaluate(async () => { await HP.Sessions.refresh(); return 1; });
      await page.waitForTimeout(600);
      R['03_清单'] = await flags();
      R['04_attach_r52t'] = await page.evaluate(() => ({ ok: HP.Sessions.attach('r52t'), sel: HP.Sessions.sel }));
      await page.waitForTimeout(3000);
      R['05_attach后'] = await flags();
      R['06_pwd'] = await page.evaluate(() => { window.HP.App.send('pwd\r'); return 1; });
      await page.waitForTimeout(1500);
      R['07_尾'] = await flags();
    } catch (e) { R.__err = String(e).slice(0, 200); }
    return R;
  },
};
