/* F-UI-11 判据：启动到底慢在哪（读数），以及"来回切栏目不要反复读远端"
 * 读回来的是 performance.now() 的时间戳与远端读取次数 —— 不是"感觉快了"。
 */
export default {
  name: 'F-UI-11 启动时间线 + Hermes 页读取策略',

  check: async (page) => {
    const out = {};
    /* ① 启动打点：六个阶段都该有读数，而且"终端可显示"不该等面板/远端 */
    out.bootTimeline = await page.evaluate(() => {
      const b = HP.BOOT || {};
      /* HP.BOOT 的打点名是 app.js（应用侧）的中文键，本文件只按名字取两个关键阶段，不改它 */
      const KEY = { terminalVisible: '终端可显示', panelReady: '面板就绪' };
      return {
        marks: b,
        stageCount: Object.keys(b).length,
        terminalVisible: b[KEY.terminalVisible],
        panelReady: b[KEY.panelReady]
      };
    });
    /* ② 启动期间不该去读远端技能（那时还没连接，白等） */
    out.remoteCallsAtBoot = await page.evaluate(() => HP.Panels._hermesCalls || 0);

    /* ③ 连上后第一次进「技能与记忆」→ 读一次，并把耗时显示出来 */
    await page.evaluate(async () => {
      HP.App.sessionId = 's1';
      HP.App.state = 'connected';
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(900);
    out.firstOpen = await page.evaluate(() => {
      /* 界面上的两处文案（与页面文本比较用）：抽成常量，不做正则字面量、也不当键 */
      const readoutLabel = '读取耗时';
      const loadingLabel = '读取中';
      const text = document.getElementById('tab-hermes').textContent || '';
      return {
        calls: HP.Panels._hermesCalls || 0,
        elapsedMs: HP.Panels._hermesMs || 0,
        hasReadoutLine: text.indexOf(readoutLabel) >= 0,
        stillLoading: text.indexOf(loadingLabel) >= 0
      };
    });

    /* ④ 切走再切回来（60 秒内）→ 应命中缓存，不再读远端，也不该再出现"读取中" */
    await page.evaluate(() => HP.App.openBoard('hosts'));
    await page.waitForTimeout(400);
    await page.evaluate(() => HP.App.openBoard('hermes'));
    await page.waitForTimeout(700);
    out.afterReturn = await page.evaluate(() => {
      const loadingLabel = '读取中';
      const text = document.getElementById('tab-hermes').textContent || '';
      return {
        calls: HP.Panels._hermesCalls || 0,
        stillLoading: text.indexOf(loadingLabel) >= 0,
        skillCount: document.querySelectorAll('#tab-hermes [data-skill]').length
      };
    });

    out.checks = {
      sixStagesMeasured: out.bootTimeline.stageCount >= 6,
      terminalNotWaitingForPanels: (out.bootTimeline.terminalVisible || 1e9) <= (out.bootTimeline.panelReady || 0),
      noRemoteReadAtBoot: out.remoteCallsAtBoot === 0,
      firstOpenReadsOnce: out.firstOpen.calls === 1 && !out.firstOpen.stillLoading,
      hasElapsedReadout: out.firstOpen.hasReadoutLine && out.firstOpen.elapsedMs >= 0,
      returnHitsCache: out.afterReturn.calls === 1 && !out.afterReturn.stillLoading,
      skillListRendered: out.afterReturn.skillCount > 0
    };
    return out;
  }
};
