/* R48：面板/输入条可见性 + 关闭按钮坐标（用于把面板关掉再测输入条） */
export default {
  name: 'r48-ui',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const SX = 1080 / 393, SY = 2138 / 778;
      const dev = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * SX), y: Math.round(136 + (r.y + r.height / 2) * SY), w: Math.round(r.width), h: Math.round(r.height) }; };
      const ov = document.getElementById('overlay'), comp = document.getElementById('composer');
      const kb = [...document.querySelectorAll('#keybar button')].filter((b) => b.getBoundingClientRect().height > 0);
      const close = document.getElementById('btn-close-panel');
      return {
        panelOpen: getComputedStyle(ov).display !== 'none',
        composerVisible: comp ? !comp.classList.contains('hidden') && comp.getBoundingClientRect().height > 0 : null,
        composerRect: comp ? dev(comp) : null,
        keybarKeys: kb.length,
        keybarVisible: !document.getElementById('keybar').classList.contains('hidden'),
        closeBtn: close ? dev(close) : null,
        topbar: document.getElementById('tb-title').textContent + ' / ' + document.getElementById('tb-badge').textContent,
        view: window.HP && window.HP.Talk ? window.HP.Talk.view : null,
        board: window.HP && window.HP.App ? window.HP.App.board : null
      };
    });
  }
};
