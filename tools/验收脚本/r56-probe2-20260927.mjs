/* R56 会话页探针（自包含，不用字符串插值） */
const SX = 1080 / 393, SY = 2138 / 778;
function devIn(el) {
  const r = el.getBoundingClientRect();
  return { x: Math.round((r.x + r.width / 2) * SX), y: Math.round(136 + (r.y + r.height / 2) * SY), w: Math.round(r.width), h: Math.round(r.height) };
}
export default {
  name: 'r56-probe2',
  check: async (page) => {
    const action = process.env.ACTION || 'rows';
    await page.waitForTimeout(400);
    if (action === 'ui') {
      return page.evaluate(() => {
        const sx = 1080 / 393, sy = 2138 / 778;
        const dev = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy) }; };
        const A = window.HP.App || {};
        const ov = document.getElementById('overlay');
        const dr = document.getElementById('drawer');
        const out = {};
        out.board = A.board === undefined ? null : A.board;
        out.overlayDisplay = ov ? getComputedStyle(ov).display : null;
        out.drawerClass = dr ? String(dr.className) : null;
        out.btnPanel = dev(document.getElementById('btn-panel'));
        out.title = document.getElementById('tb-title').textContent;
        out.sessionsRows = document.querySelectorAll('#tab-sessions .card').length;
        return out;
      });
    }
    if (action === 'drawer') {
      return page.evaluate(() => {
        const sx = 1080 / 393, sy = 2138 / 778;
        const dev = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy), h: Math.round(r.height) }; };
        const dr = document.getElementById('drawer');
        const nodes = [...dr.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.innerText.trim());
        const items = [];
        for (const e of nodes) items.push({ t: e.innerText.trim().slice(0, 18), cls: String(e.className).slice(0, 20), x: dev(e).x, y: dev(e).y, h: dev(e).h });
        return { cls: String(dr.className), text: dr.innerText.replace(/\n/g, '|').slice(0, 260), items };
      });
    }
    if (action === 'rows') {
      return page.evaluate(() => {
        const sx = 1080 / 393, sy = 2138 / 778;
        const dev = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy) }; };
        const el = document.getElementById('tab-sessions');
        if (!el) return { err: 'no #tab-sessions' };
        const cards = [...el.querySelectorAll('.card')].filter((e) => e.getBoundingClientRect().height > 0);
        const rows = [];
        for (const c of cards) rows.push({ text: c.innerText.replace(/\n/g, ' | '), cls: String(c.className), x: dev(c).x, y: dev(c).y });
        const heads = [...el.querySelectorAll('h2,h3,h4,.hd,.sec,.grp')].map((e) => e.innerText.replace(/\n/g, '/'));
        return {
          tabOn: el.classList.contains('on'),
          scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          text: el.innerText,
          html: el.innerHTML.slice(0, 6000),
          cardCount: cards.length,
          rows,
          heads,
          fullText: document.getElementById('overlay') ? document.getElementById('overlay').innerText : null
        };
      });
    }
    return { err: 'unknown action' };
  }
};
