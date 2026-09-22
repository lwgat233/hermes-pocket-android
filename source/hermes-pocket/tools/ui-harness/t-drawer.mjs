/* F-UI-7 判据：左侧隐藏栏（抽屉）
 * 读回来的事实：抽屉条目数 = 登记表里"能用"的栏目数；点条目能真的切到那一栏；
 *               行的样式合规（两行制 / 触控 ≥44px）；覆盖自检的四类缺口为空。
 */
const expectedPlannedToast = '还没做';   // 点了"没做"的栏目时界面给的提示（与界面比较的期望文案，保持中文）

const openDrawer = (page) => page.evaluate(() => {
  document.getElementById('btn-panel').click();
  return { show: document.getElementById('drawer').classList.contains('show') };
});

export default {
  name: 'F-UI-7 左侧隐藏栏 + 功能登记表',

  check: async (page) => {
    const out = {};
    /* ① 登记表自检：读回来的是"缺口名单"。
     * ⚠ 自检的判据是**读 DOM**（栏目 tab / 宿主栏目里那一行），所以必须先把全部栏目渲染一遍再读；
     *   否则会报一串"没挂上"的假红（实测只画一部分时 没挂上=['prompt(行)','model(行)','skills-dl(行)']，
     *   全部画完是 []）。统一验收里另有一条 t-registry.mjs 专门盯这个。 */
    out.renderAllBoards = await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      for (const b of HP.Registry.boards.filter((x) => x.tab)) { try { await HP.App.openBoard(b.id); } catch (e) {} }
      HP.App.closePanel();
      return true;
    });
    await page.waitForTimeout(600);
    out.selfCheck = await page.evaluate(() => HP.Registry.check());
    /* ② 点 ☰ 开抽屉：条目必须由登记表生成，数量要对得上 */
    await openDrawer(page);
    await page.waitForTimeout(350);
    out.drawer = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#dw-body [data-testid]')].map((e) => ({
        id: e.dataset.testid.replace('board-', ''),
        t: (e.querySelector('.ri-t') || {}).textContent,
        s: (e.querySelector('.ri-s') || {}).textContent,
        h: Math.round(e.getBoundingClientRect().height)
      }));
      const groups = [...document.querySelectorAll('#dw-body .dw-group')].map((e) => e.textContent);
      const ready = HP.Registry.groups.reduce((a, g) => a + HP.Registry.boardsOf(g.id).length, 0);   // 只数真栏目
      const planned = HP.Registry.boards.filter((b) => b.status !== 'ready').map((b) => b.id);
      return { rowCount: rows.length, registryReadyCount: ready, groups, rows, plannedHidden: rows.every((r) => !planned.includes(r.id)) };
    });
    /* ③ 行的样式规范（两行制 + 触控目标） */
    out.rowStyle = await page.evaluate(() => {
      const r = document.querySelector('#dw-body .row-item');
      const t = r.querySelector('.ri-t'), s = r.querySelector('.ri-s');
      const ct = getComputedStyle(t), cs = getComputedStyle(s);
      return {
        titleFontSize: ct.fontSize, titleFontWeight: ct.fontWeight, subFontSize: cs.fontSize,
        rowHeight: Math.round(r.getBoundingClientRect().height),
        pass: parseFloat(ct.fontSize) >= 14 && parseInt(ct.fontWeight, 10) >= 600 &&
              parseFloat(cs.fontSize) <= 12 && r.getBoundingClientRect().height >= 44
      };
    });
    /* ④ 带右列的行：右列必须固定、数值不许截断（临时用渲染器造一行量完就删） */
    out.rightColumn = await page.evaluate(() => {
      const row = HP.UI.row({ title: '下载行（临时）', sub: 'https://example.com/very/long/path', right: '123.4 KB' });
      document.getElementById('dw-body').appendChild(row);
      const el = row.querySelector('.ri-r');
      const c = getComputedStyle(el);
      const res = {
        flexBasis: c.flexBasis, whiteSpace: c.whiteSpace, textOverflow: c.textOverflow,
        scrollWidth: el.scrollWidth, clientWidth: el.clientWidth
      };
      res.valueNotTruncated = res.scrollWidth <= res.clientWidth + 1;
      res.pass = c.flexBasis === 'auto' && c.whiteSpace === 'nowrap' && c.textOverflow !== 'ellipsis' && res.valueNotTruncated;
      row.remove();
      return res;
    });
    /* ⑤ 选栏目：一个个点过去，正文区必须真的换过去 */
    out.selectBoard = await page.evaluate(async () => {
      document.getElementById('btn-panel').click();
      await new Promise((r) => setTimeout(r, 250));
      const res = [];
      for (const id of ['settings', 'keys', 'hermes', 'hosts', 'sessions', 'net']) {
        const row = document.querySelector('#dw-body [data-testid="board-' + id + '"]');
        if (!row) { res.push({ id, ok: false, why: '抽屉里没有这一条' }); continue; }
        row.click();
        await new Promise((r) => setTimeout(r, 350));
        const b = HP.Registry.get(id);
        res.push({
          id,
          drawerClosed: !document.getElementById('drawer').classList.contains('show'),
          panelOpen: !document.getElementById('overlay').classList.contains('hidden'),
          tabSwitched: document.getElementById('tab-' + b.tab).classList.contains('on'),
          title: document.getElementById('board-title').textContent
        });
        document.getElementById('btn-panel').click();       // 再开抽屉，继续点下一个
        await new Promise((r) => setTimeout(r, 250));
      }
      document.getElementById('drawer-scrim').click();      // 点空白处收起
      await new Promise((r) => setTimeout(r, 250));
      res.push({ scrimClosed: !document.getElementById('drawer').classList.contains('show') });
      return res;
    });
    /* ⑥ 没做的栏目：点它要点不动、并且有明确反馈（不是静默）。
     * 不再指望"登记表里还剩一个 planned"——都做完的时候那条断言就没东西可试了；
     * 这里临时塞一个 planned 项进去，测完撤掉。 */
    out.plannedNotClickable = await page.evaluate(async () => {
      const before = document.getElementById('board-title').textContent;
      const itemCountBefore = document.querySelectorAll('#dw-body .dw-item').length;
      HP.Registry.boards.push({ id: '__tmp__', group: 'conn', name: '临时没做的', sub: '测用', tab: null, status: 'planned', test: '' });
      const itemCountAfter = document.querySelectorAll('#dw-body .dw-item').length;
      HP.App.openBoard('__tmp__');
      const result = {
        probeId: '__tmp__',
        titleUnchanged: document.getElementById('board-title').textContent === before,
        toast: (document.getElementById('toast') || {}).textContent || '',
        plannedNotInDrawer: itemCountBefore === itemCountAfter
      };
      HP.Registry.boards = HP.Registry.boards.filter((b) => b.id !== '__tmp__');
      return result;
    });

    /* ⑦ 判据：上面读到的每一个数字/状态都要能成立（以前这里只有"观察"，没有"判"） */
    // 驱动把「点空白收起」也塞进了 selectBoard 那个数组（末尾一条没有 id），先拆出来再判
    const switches = out.selectBoard.filter((r) => r.id);
    const collapsed = out.selectBoard.find((r) => r.scrimClosed !== undefined);
    out.conclusion = {
      drawerRowCountMatchesReadyBoards: out.drawer.rowCount === out.drawer.registryReadyCount,
      drawerHasThreeGroups: out.drawer.groups.join('/') === '连接/Hermes/诊断',
      plannedNotShown: out.drawer.plannedHidden === true,
      rowStyleCompliant: out.rowStyle.pass === true,
      rightColumnNotTruncated: out.rightColumn.pass === true && out.rightColumn.valueNotTruncated === true,
      everyBoardOpens: switches.length === 6 && switches.every((r) => r.drawerClosed && r.panelOpen && r.tabSwitched),
      titleFollowsBoard: switches.every((r) => r.title && r.title.length > 0),
      scrimCollapsesDrawer: !!collapsed && collapsed.scrimClosed === true,
      plannedNotClickableWithToast: out.plannedNotClickable.titleUnchanged === true &&
        out.plannedNotClickable.toast.includes(expectedPlannedToast) && out.plannedNotClickable.plannedNotInDrawer === true,
      selfCheckFourGapsEmpty: out.selfCheck.ungrouped.length === 0 && out.selfCheck.emptyGroups.length === 0 && out.selfCheck.untested.length === 0
    };
    return out;
  }
};
