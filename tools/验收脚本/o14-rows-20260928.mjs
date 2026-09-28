/* O14：会话页行读数（顺序 / data-testid / 右标 / 菜单主体）+ 浮层残留检查 */
export default {
  name: 'o14-rows',
  check: async (page) => {
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const sx = 1080 / 393, sy = 2138 / 778;
      const dev = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy) }; };
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const rows = [...document.querySelectorAll('#tab-sessions .row-item')];
      const out = {
        sel: (window.HP.Sessions || {}).sel || null,
        rowCount: rows.length,
        rowItems: rows.map((e, i) => ({
          i, id: e.getAttribute('data-testid'), vis: vis(e), top: Math.round(e.getBoundingClientRect().top), ...dev(e),
          t: (e.querySelector('.ri-t') || {}).textContent || null,
          s: (e.querySelector('.ri-s') || {}).textContent || null,
          r: (e.querySelector('.ri-r') || {}).textContent || null,
          full: e.innerText.replace(/\n/g, ' | ')
        })),
        maid: rows.filter((e) => /女仆|奈奈|home-?maid|home\.maid/i.test(e.innerText)).map((e, i) => ({ i, id: e.getAttribute('data-testid'), full: e.innerText.replace(/\n/g, ' | '), top: Math.round(e.getBoundingClientRect().top) })),
        lists: document.querySelectorAll('#tab-sessions .ui-list').length,
        cards: document.querySelectorAll('#tab-sessions .card').length,
        btns: [...document.querySelectorAll('#tab-sessions button')].filter(vis).map((b) => b.textContent.trim()),
        allVisBtns: [...document.querySelectorAll('button')].filter(vis).map((b) => (b.id ? '#' + b.id : b.textContent.trim().slice(0, 6))),
        dialogs: [...document.querySelectorAll('.hp-dialog')].filter(vis).map((d) => d.innerText.replace(/\n/g, '|').slice(0, 50)),
        dialogButtons: [...document.querySelectorAll('.hp-dialog button')].filter(vis).map((b) => ({ t: b.textContent.trim(), ...dev(b) })),
        ctxMenu: (document.getElementById('ctxmenu') || {}).innerText ? document.getElementById('ctxmenu').innerText.replace(/\n/g, '|').slice(0, 120) : null,
        ctxMenuVis: !!document.getElementById('ctxmenu') && vis(document.getElementById('ctxmenu')),
        panelScroll: (() => { const pb = document.querySelector('#overlay .panel-body'); return pb ? { scrollTop: Math.round(pb.scrollTop), scrollHeight: pb.scrollHeight, clientHeight: pb.clientHeight } : null; })(),
        expl: [...document.querySelectorAll('#tab-sessions *')].filter((e) => e.children.length === 0 && e.innerText.trim().length >= 6 && /说明|提示|请|用于|可以|支持|点击|选择|这里|需要|例如/.test(e.innerText)).map((e) => e.innerText.trim().slice(0, 50)),
        html: (document.getElementById('tab-sessions') || {}).innerHTML ? document.getElementById('tab-sessions').innerHTML.slice(0, 3000) : null
      };
      return out;
    });
  }
};
