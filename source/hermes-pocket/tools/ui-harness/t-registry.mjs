/* 功能覆盖自检（"开发不足"清单必须是空的）——统一验收的一部分。
 * 为什么单独立一个驱动：`HP.Registry.check()` 的判据是**读 DOM**（栏目 tab 在不在、宿主栏目里那一行在不在），
 * 所以必须在**把全部栏目都渲染过一遍**之后再读；否则会报出一串"没挂上"的假红
 * （实测：只画了一部分时 `没挂上=['prompt(行)','model(行)','skills-dl(行)']`，全部画完是 `[]`）。
 * Hermes 那几行还要 `sessionId/state` 置成"已连接"才渲染。
 */
export default {
  name: '功能覆盖自检：登记表 11 项全挂上、没归属/没测/未做 全空',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => { HP.App.sessionId = 's1'; HP.App.state = 'connected'; });
    await page.waitForTimeout(200);
    out.notMountedBeforeRender = await page.evaluate(() => HP.Registry.check().notMounted);

    await page.evaluate(async () => {
      for (const b of HP.Registry.boards.filter((x) => x.tab)) { try { await HP.App.openBoard(b.id); } catch (e) {} }
      HP.App.closePanel();
    });
    await page.waitForTimeout(600);
    out.selfCheck = await page.evaluate(() => HP.Registry.check());
    out.drawer = await page.evaluate(async () => {
      const expected = HP.Registry.boards.filter((b) => b.status === 'ready' && !b.kind && b.tab).length;
      document.getElementById('btn-panel').click();                 // ☰ 开抽屉（和用户手点同一条路）
      await new Promise((r) => setTimeout(r, 300));
      const itemCount = document.querySelectorAll('#dw-body [data-testid^="board-"]').length;
      const names = [...document.querySelectorAll('#dw-body [data-testid^="board-"]')]
        .map((e) => e.getAttribute('data-testid').replace('board-', ''));
      document.getElementById('drawer-scrim').click();              // 点空白收起
      return { expected, itemCount, names };
    });
    out.hermesRowsPresent = await page.evaluate(() => {
      const tab = document.getElementById('tab-hermes');
      return {
        promptRow: !!(tab && tab.querySelector('[data-testid="remote-prompt"]')),
        modelRow: !!(tab && tab.querySelector('[data-testid="remote-model"]')),
        skillDetailRow: !!(tab && tab.querySelector('[data-skill]'))
      };
    });

    out.conclusion = {
      registryAll11Ready: out.selfCheck.total === 11 && out.selfCheck.readyCount === 11,
      ungroupedEmpty: out.selfCheck.ungrouped.length === 0,
      notMountedEmpty: out.selfCheck.notMounted.length === 0,
      untestedEmpty: out.selfCheck.untested.length === 0,
      notDoneEmpty: out.selfCheck.notDone.length === 0,
      emptyGroupsAllEmpty: out.selfCheck.emptyGroups.length === 0 && out.selfCheck.uiEmptyGroups.length === 0,
      drawerBoardsMatchRegistry: out.drawer.itemCount === out.drawer.expected && out.drawer.expected > 0,
      hermesRowsAllInDom: out.hermesRowsPresent.promptRow && out.hermesRowsPresent.modelRow && out.hermesRowsPresent.skillDetailRow
    };
    return out;
  }
};
