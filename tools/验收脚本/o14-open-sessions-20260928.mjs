/* O14：用 App 自己的 API 打开会话页（与抽屉里点「会话」同一条路） */
export default {
  name: 'o14-open-sessions',
  check: async (page) => {
    return page.evaluate(async () => {
      const A = window.HP.App;
      const out = {};
      try {
        A.showBoard('sessions');
        await new Promise((r) => setTimeout(r, 1200));
        if (window.HP.Sessions && window.HP.Sessions.refresh) { try { await window.HP.Sessions.refresh(); } catch (e) { out.refreshErr = String(e.message || e); } }
        if (window.HP.Panels && window.HP.Panels.renderSessions) window.HP.Panels.renderSessions();
        await new Promise((r) => setTimeout(r, 900));
        const tab = document.getElementById('tab-sessions');
        const rows = [...document.querySelectorAll('#tab-sessions .row-item')];
        out.tabOn = tab ? tab.classList.contains('on') : null;
        out.rows = rows.length;
        out.layoutRows = rows.filter((e) => e.getBoundingClientRect().height > 0).length;
        out.board = A.board === undefined ? null : A.board;
      } catch (e) { out.err = String(e.message || e); }
      return out;
    });
  }
};
