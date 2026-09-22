/* F-NET-8 判据：历史上下行 —— 采集存区间 → 统计一处 → 绘图一处（柱 + 饼），数字必须对得上。
 * 关键断言：区间条数 = 采集条数；柱上两段数字之和 = 汇总数字；空转不占位；上限是环形；落盘内容与内存一致。
 */

/* 断言要匹配的界面文案（正则源串 / 按钮名）：中文集中在此，与界面上的文案对照 */
const TEXT = {
  sumToken: '合计',
  bucketSummary: '12 条区间 → 12 组',
  groupSummary: '每 10 条合一组（120 条区间 → 12 组）',
  noSamplesYet: '还没有历史采样',
  legacyOnlyTotal: '老版本只存了一个累计总数',
  clearedHistory: '已清掉 2 条历史区间',
  resetDone: '已归零',
  btnClearHistory: '清空历史',
  btnResetCounter: '计数归零',
};

const readDialog = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return null;
  const bars = [...d.querySelectorAll('.net-col')].map((c) => ({
    up: Number(c.querySelector('.net-up').dataset.v), down: Number(c.querySelector('.net-down').dataset.v),
    'upHeight': c.querySelector('.net-up').style.height, downHeight: c.querySelector('.net-down').style.height,
    'toast': c.querySelector('.net-col') ? '' : c.title
  }));
  const legend = [...d.querySelectorAll('.net-legend-row[data-name]')].map((r) => ({
    name: r.dataset.name, value: Number(r.dataset.value), pct: Number(r.dataset.pct), labelText: r.textContent
  }));
  return {
    'heading': d.querySelector('.sheet-t').textContent,
    'rows': [...d.querySelectorAll('.row-item')].map((r) => ({
      id: r.dataset.testid,
      'title': (r.querySelector('.ri-t') || {}).textContent || '',
      'sub': (r.querySelector('.ri-s') || {}).textContent || '',
      'right': (r.querySelector('.ri-r') || {}).textContent || ''
    })),
    'statusLines': [...d.querySelectorAll('.sheet-body .ui-status, .tf-hist .ui-status')].map((s) => s.textContent),
    bars,
    legend,
    'sumText': (d.querySelector('[data-testid="net-sum"]') || {}).textContent || '',
    'hasBars': !!d.querySelector('[data-testid="net-bars"]'),
    'hasPie': !!d.querySelector('[data-testid="net-pie"]'),
    'buttons': [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim())
  };
});
const closeDialog = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));
const toast = (page) => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const clickButton = (page, re) => page.evaluate((r) => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  [...d.querySelectorAll('.btnrow button')].find((b) => new RegExp(r).test(b.textContent)).click();
}, re);

export default {
  name: 'F-NET-8 历史上下行：采集区间 → 统计 → 柱/饼',

  check: async (page) => {
    const out = {};

    /* ① 采集：有增量才记一条区间；空转不记 */
    out.collected = await page.evaluate(() => {
      const A = HP.App;
      A.initTraffic();
      A.traffic.samples = [];
      A.traffic.down = 0; A.traffic.up = 0; A.traffic._d = 0; A.traffic._u = 0;
      const before = A.traffic.samples.length;
      A.sampleTraffic();                                   // 没流量 → 不该记
      const afterIdle = A.traffic.samples.length;
      A.traffic.down += 300; A.traffic.up += 100; A.traffic._at = Date.now() - 2000;
      A.sampleTraffic();
      A.traffic.down += 700; A.traffic.up += 200; A.traffic._at = Date.now() - 2000;
      A.sampleTraffic();
      const s = A.traffic.samples;
      return {
        'initialCount': before, afterIdleCount: afterIdle, count: s.length,
        'firstSample': s[0], lastSample: s[s.length - 1],
        'sumUpDown': { up: s.reduce((a, x) => a + x.up, 0), down: s.reduce((a, x) => a + x.down, 0) },
        'timeWindowOk': s.every((x) => x.t1 > x.t0)
      };
    });

    /* ② 上限：环形（丢最旧的） */
    out.cap = await page.evaluate(() => {
      let list = [];
      for (let i = 1; i <= 200; i++) list = HP.Net.pushSample(list, { t0: i * 1000, t1: i * 1000 + 900, up: i, down: i * 2 });
      return { MAX: HP.Net.MAX, count: list.length, oldest: list[0].up, newest: list[list.length - 1].up };
    });

    /* ③ 落盘：跟累计值同一个节流口；读回来跟内存一致；坏 JSON 当空 */
    out.persistence = await page.evaluate(() => {
      const A = HP.App;
      A.traffic.cumAt = 0;                                  // 骗过节流，立刻落一次
      A.sampleTraffic();
      const saved = (window.__prefs || {}).trafficSamples || '';
      const savedCum = (window.__prefs || {}).trafficCum;
      const readBack = A.loadTrafficSamples();
      const memory = A.traffic.samples;
      // 权威源是内存里的 App.prefs（界面读它），测试台 stub 的 window.__prefs 只是落盘那一份
      const original = A.prefs.trafficSamples;
      A.prefs.trafficSamples = '{坏掉的 json';
      const badData = A.loadTrafficSamples();
      A.prefs.trafficSamples = original;
      return {
        'savedOk': saved.length > 0, countSame: readBack.length === memory.length,
        'lastSame': JSON.stringify(readBack[readBack.length - 1]) === JSON.stringify(memory[memory.length - 1]),
        'cumWritten': typeof savedCum === 'number',
        'badDataEmpty': Array.isArray(badData) && badData.length === 0
      };
    });

    /* ④ 界面：柱数 = 组数，柱上数字之和 = 汇总，饼的占比与合计 */
    await page.evaluate(() => {
      const A = HP.App;
      A.traffic.samples = [];
      for (let i = 0; i < 12; i++) A.traffic.samples.push({ t0: 1000 + i * 1000, t1: 1900 + i * 1000, up: 100 * (i + 1), down: 200 * (i + 1) });
      A.traffic.down = 45678; A.traffic.up = 12345; A.traffic.evt = 42;
      A.traffic.t0 = Date.now() - 65000;
      A.openTrafficDialog();
    });
    await page.waitForTimeout(700);
    out.dialog = await readDialog(page);
    out.uiNumbers = await page.evaluate(() => {
      /* net.js（app 侧）的统计字段当前按中文键返回 —— 应用侧改名时同步这两行 */
      const sampleCountKey = '采集条数';
      const bucketCountKey = '区间条数';
      const s = HP.Net.bucketize(HP.App.traffic.samples, 1);
      return { up: s.up, down: s.down, total: s.total, sampleCount: s[sampleCountKey], bucketCount: s[bucketCountKey] };
    });
    await closeDialog(page);

    /* ⑤ 柱数分组：120 条 → 12 根柱（每组 10 条） */
    await page.evaluate(() => {
      const A = HP.App;
      A.traffic.samples = [];
      for (let i = 0; i < 120; i++) A.traffic.samples.push({ t0: i * 1000, t1: i * 1000 + 900, up: 50, down: 70 });
      A.openTrafficDialog();
    });
    await page.waitForTimeout(700);
    out.grouped = await readDialog(page);
    await closeDialog(page);

    /* ⑥ 空历史：不画空图，如实说；老版本只有一个累计总数时也要说清 */
    await page.evaluate(() => {
      const A = HP.App;
      A.traffic.samples = [];
      A.traffic.legacyCum = 5000;
      A.openTrafficDialog();
    });
    await page.waitForTimeout(700);
    out.emptyHistory = await readDialog(page);
    await closeDialog(page);

    /* ⑦ 两个动作：清空历史 / 计数归零（归零不动历史） */
    await page.evaluate(() => {
      const A = HP.App;
      A.traffic.samples = [{ t0: 1, t1: 2, up: 5, down: 9 }, { t0: 3, t1: 4, up: 6, down: 10 }];
      A.saveTrafficSamples();
      A.traffic.down = 111; A.traffic.up = 22;
      A.openTrafficDialog();
    });
    await page.waitForTimeout(700);
    await clickButton(page, TEXT.btnClearHistory);
    await page.waitForTimeout(300);
    out.cleared = {
      'toast': await toast(page),
      'memoryCount': await page.evaluate(() => HP.App.traffic.samples.length),
      'persistence': await page.evaluate(() => (window.__prefs || {}).trafficSamples)
    };
    await clickButton(page, TEXT.btnResetCounter);
    await page.waitForTimeout(300);
    out.resetCounter = { toast: await toast(page), sessionDown: await page.evaluate(() => HP.App.traffic.down) };
    await closeDialog(page);

    /* ⑧ 老累计值不伪造桶：有 trafficCum、没有 samples → 图不画、条数还是 0 */
    out.oldData = await page.evaluate(() => {
      HP.App.prefs.trafficCum = 5000000;      // 老版本只存过这个
      HP.App.prefs.trafficSamples = '';
      HP.App.initTraffic();
      return { count: HP.App.traffic.samples.length, cum: HP.App.traffic.cum, legacy: HP.App.traffic.legacyCum };
    });

    /* ⑨ 登记表自检：先把每个栏目都过一遍（自检读的是 DOM —— 没渲染过的栏目当然查不到它里面那行） */
    await page.evaluate(() => {
      document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
      HP.App.sessionId = 's1'; HP.App.state = 'connected';   // 自检要过 Hermes 栏目，它没连接时不渲染远端行
    });
    for (const b of ['hosts', 'keys', 'settings', 'hermes', 'sessions', 'net']) {
      await page.evaluate((id) => HP.App.openBoard(id), b);   // openBoard = 切栏目 + 读数据 + 渲染
      await page.waitForTimeout(900);
    }
    out.registry = await page.evaluate(() => HP.Registry.check());

    out.verdict = {
      'recordsOnlyOnDelta': out.collected.initialCount === 0 && out.collected.afterIdleCount === 0 && out.collected.count === 2,
      'segmentHasTimeWindow': out.collected.timeWindowOk && out.collected.firstSample.down === 300 && out.collected.lastSample.down === 700,
      'segmentsSumEqualsDelta': out.collected.sumUpDown.up === 300 && out.collected.sumUpDown.down === 1000,
      'capIsRing': out.cap.count === out.cap.MAX && out.cap.oldest === 81 && out.cap.newest === 200,
      'persistedMatchesMemory': out.persistence.savedOk && out.persistence.countSame && out.persistence.lastSame && out.persistence.cumWritten,
      'badPersistedEmpty': out.persistence.badDataEmpty,
      'dialogHeadingAndFourRows': out.dialog.heading === '流量统计' &&
        out.dialog.rows.map((r) => r.id).join(',') === 'tf-down,tf-up,tf-avg,tf-cum' &&
        out.dialog.rows[0].right === '44.6K' && out.dialog.rows[1].right === '12.1K',
      'threeActionsPresent': out.dialog.buttons.join('/') === '计数归零/清空历史/关闭',
      'barsEqualGroups': out.dialog.bars.length === out.uiNumbers.bucketCount && out.dialog.bars.length === 12,
      'barsSumEqualsTotal': out.dialog.bars.reduce((a, c) => a + c.down, 0) === out.uiNumbers.down &&
        out.dialog.bars.reduce((a, c) => a + c.up, 0) === out.uiNumbers.up,
      'piePercentAndTotal': out.dialog.legend.length === 2 && out.dialog.legend[0].name === '下行' &&
        out.dialog.legend[0].value === out.uiNumbers.down && out.dialog.legend[1].value === out.uiNumbers.up &&
        out.dialog.legend[0].pct + out.dialog.legend[1].pct === 100 &&
        new RegExp(TEXT.sumToken).test(out.dialog.sumText) && new RegExp(TEXT.bucketSummary).test(out.dialog.sumText),
      'barHeightSameDenominator': out.dialog.bars.every((c) => /px$/.test(c.upHeight) && /px$/.test(c.downHeight)) &&
        out.dialog.bars[11].downHeight === '90px' &&            // 最大那一桶顶满图高（同一分母）
        parseFloat(out.dialog.bars[5].downHeight) === 45 &&     // 第 6 桶是最大桶的一半
        out.dialog.bars.every((c, i) => i === 0 || parseFloat(c.downHeight) > parseFloat(out.dialog.bars[i - 1].downHeight)),
      'oneTwentyIntoTwelveBars': out.grouped.bars.length === 12 && new RegExp(TEXT.groupSummary).test(out.grouped.statusLines.join(' ')),
      'emptyHistoryNoChart': out.emptyHistory.hasBars === false && out.emptyHistory.bars.length === 0 &&
        new RegExp(TEXT.noSamplesYet).test(out.emptyHistory.statusLines.join(' ')) && new RegExp(TEXT.legacyOnlyTotal).test(out.emptyHistory.statusLines.join(' ')),
      'clearHistoryReallyClears': new RegExp(TEXT.clearedHistory).test(out.cleared.toast) && out.cleared.memoryCount === 0 && out.cleared.persistence === '[]',
      'resetOnlySession': out.resetCounter.sessionDown === 0 && new RegExp(TEXT.resetDone).test(out.resetCounter.toast),
      'legacyCumNoFakeBuckets': out.oldData.count === 0 && out.oldData.cum === 5000000 && out.oldData.legacy === 5000000,
      'registryHasTraffic': out.registry.notMounted.length === 0 && out.registry.untested.length === 0 &&
        out.registry.uiEmptyGroups.length === 0 && out.registry.notDone.length === 0 &&
        out.registry.readyCount === out.registry.total
    };
    return out;
  }
};
