/* F-UI-7 判据：左侧隐藏栏（抽屉）
 * 读回来的事实：抽屉条目数 = 登记表里"能用"的栏目数；点条目能真的切到那一栏；
 *               行的样式合规（两行制 / 触控 ≥44px）；覆盖自检的四类缺口为空。
 */
const openDrawer = (page) => page.evaluate(() => {
  document.getElementById('btn-panel').click();
  return { show: document.getElementById('drawer').classList.contains('show') };
});

export default {
  name: 'F-UI-7 左侧隐藏栏 + 功能登记表',

  check: async (page) => {
    const out = {};
    /* ① 登记表自检：读回来的是"缺口名单" */
    out.自检 = await page.evaluate(() => HP.Registry.check());
    /* ② 点 ☰ 开抽屉：条目必须由登记表生成，数量要对得上 */
    await openDrawer(page);
    await page.waitForTimeout(350);
    out.抽屉 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#dw-body [data-testid]')].map((e) => ({
        id: e.dataset.testid.replace('board-', ''),
        t: (e.querySelector('.ri-t') || {}).textContent,
        s: (e.querySelector('.ri-s') || {}).textContent,
        h: Math.round(e.getBoundingClientRect().height)
      }));
      const groups = [...document.querySelectorAll('#dw-body .dw-group')].map((e) => e.textContent);
      const ready = HP.Registry.boards.filter((b) => b.status === 'ready').length;
      const planned = HP.Registry.boards.filter((b) => b.status !== 'ready').map((b) => b.id);
      return { 条目数: rows.length, 登记可用数: ready, 集合: groups, 条目: rows, 未做的没摆出来: rows.every((r) => !planned.includes(r.id)) };
    });
    /* ③ 行的样式规范（两行制 + 触控目标） */
    out.行样式 = await page.evaluate(() => {
      const r = document.querySelector('#dw-body .row-item');
      const t = r.querySelector('.ri-t'), s = r.querySelector('.ri-s');
      const ct = getComputedStyle(t), cs = getComputedStyle(s);
      return {
        标题字号: ct.fontSize, 标题字重: ct.fontWeight, 次行字号: cs.fontSize,
        行高: Math.round(r.getBoundingClientRect().height),
        达标: parseFloat(ct.fontSize) >= 14 && parseInt(ct.fontWeight, 10) >= 600 &&
              parseFloat(cs.fontSize) <= 12 && r.getBoundingClientRect().height >= 44
      };
    });
    /* ④ 带右列的行：右列必须固定、数值不许截断（临时用渲染器造一行量完就删） */
    out.右列规范 = await page.evaluate(() => {
      const row = HP.UI.row({ title: '下载行（临时）', sub: 'https://example.com/very/long/path', right: '123.4 KB' });
      document.getElementById('dw-body').appendChild(row);
      const el = row.querySelector('.ri-r');
      const c = getComputedStyle(el);
      const res = {
        flexBasis: c.flexBasis, whiteSpace: c.whiteSpace, textOverflow: c.textOverflow,
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth
      };
      res.数值没被截断 = res.scrollWidth <= res.clientWidth + 1;
      res.达标 = c.flexBasis === 'auto' && c.whiteSpace === 'nowrap' && c.textOverflow !== 'ellipsis' && res.数值没被截断;
      row.remove();
      return res;
    });
    /* ⑤ 选栏目：一个个点过去，正文区必须真的换过去 */
    out.选栏目 = await page.evaluate(async () => {
      document.getElementById('btn-panel').click();
      await new Promise((r) => setTimeout(r, 250));
      const res = [];
      for (const id of ['settings', 'keys', 'hermes', 'hosts']) {
        const row = document.querySelector('#dw-body [data-testid="board-' + id + '"]');
        if (!row) { res.push({ id, ok: false, why: '抽屉里没有这一条' }); continue; }
        row.click();
        await new Promise((r) => setTimeout(r, 350));
        const b = HP.Registry.get(id);
        res.push({
          id,
          抽屉收起: !document.getElementById('drawer').classList.contains('show'),
          面板打开: !document.getElementById('overlay').classList.contains('hidden'),
          切到了: document.getElementById('tab-' + b.tab).classList.contains('on'),
          抬头: document.getElementById('board-title').textContent
        });
        document.getElementById('btn-panel').click();       // 再开抽屉，继续点下一个
        await new Promise((r) => setTimeout(r, 250));
      }
      document.getElementById('drawer-scrim').click();      // 点空白处收起
      await new Promise((r) => setTimeout(r, 250));
      res.push({ 点空白收起: !document.getElementById('drawer').classList.contains('show') });
      return res;
    });
    /* ⑥ 没做的栏目：点它要点不动（有明确反馈，不是静默） */
    out.未做的点不动 = await page.evaluate(() => {
      const before = document.getElementById('board-title').textContent;
      HP.App.openBoard('sessions');
      return { 抬头没变: document.getElementById('board-title').textContent === before };
    });
    return out;
  }
};
