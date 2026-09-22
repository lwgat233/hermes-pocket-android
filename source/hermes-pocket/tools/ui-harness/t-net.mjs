/* F-NET-2 判据：连通性 / 丢包 / 延迟 —— 解析用**真样本**（tools/check_net_py.py 把 Bridge.kt 里的命令
 * 原样抽出来跑，落进 fixtures/net-samples.json），界面流程用测试台的假桥驱动。
 * 另外把 F-NET-8 的两个纯函数（区间 → 统计、统计 → 图）也在这里算数字（它们的界面在 M4B）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HP_HOST = '192.168.1.10';

/* 样本文件的键名就是中文（fixtures/ 是数据文件，不改动；harness 也按这些键取样本）——
 * 中文键名只在这里出现一次，样本侧改名时只动这一处 */
const SAMPLE_KEY = {
  pingLost100: 'ping_丢失100',
  pingDnsFail: 'ping_域名解析失败',
  tcpLocal22: 'tcp_本机22',
  tcpNoListener: 'tcp_没人听'
};

/* 界面文案（期望值，不能改；提到常量位置，免得落进正则字面量/调用实参。
 * 名字带 Pattern 的是**正则源**（原来写成正则字面量），保留元字符语义。 */
const TEXT = {
  notTested: '没测过',
  cannotTest: '测不了',
  didNotRun: '没跑成',
  tcpUp: '通',
  tcpDown: '不通',
  tcpDownPrefix: '不通：',
  tcpDownToast: '端口不通',
  save: '保存',
  tcpUpPattern: '^通 · \\d+ ms$',            // 原正则 /^通 · \d+ ms$/
  savedPattern: '已保存：example\\.local',    // 原正则 /已保存：example\.local/
  totalPattern: '合计 16.1KB',               // 原正则 /合计 16.1KB/
  twoBuckets: '10 条区间 → 2 组'
};
const RE_TCP_UP = new RegExp(TEXT.tcpUpPattern);
const RE_SAVED = new RegExp(TEXT.savedPattern);
const RE_TOTAL = new RegExp(TEXT.totalPattern);

const here = path.dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/net-samples.json'), 'utf8'));

/* 期望值从样本自身推出来（每次重抓样本 RTT 都会变，别把上次的数字写死） */
const expected = (() => {
  const tx = sample.ping_loopback.match(/(\d+)\s+packets transmitted/);
  const avg = sample.ping_loopback.match(/rtt min\/avg\/max\/\w+ = ([\d.]+)\/([\d.]+)\/([\d.]+)/);
  const ms = sample[SAMPLE_KEY.tcpLocal22].match(/@@MS (\d+)/);
  return {
    loopbackTx: tx ? Number(tx[1]) : -1,
    loopbackAvg: avg ? Number(avg[2]) : -1,
    portMs: ms ? Number(ms[1]) : -1,
    host: HP_HOST,       // 见下：默认目标（跟界面里 target() 推出来的一致）
    port: 22
  };
})();

const readRow = (page, testid) => page.evaluate((id) => {
  const r = document.querySelector('#tab-net [data-testid="' + id + '"]');
  if (!r) return null;
  const text = (sel) => { const e = r.querySelector(sel); return e ? e.textContent : ''; };
  return { title: text('.ri-t'), sub: text('.ri-s'), right: text('.ri-r'), hasRight: !!r.querySelector('.ri-r') };
}, testid);
const readSheet = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return null;
  return {
    title: d.querySelector('.sheet-t').textContent,
    fields: [...d.querySelectorAll('.sheet-body .field')].map((f) => ({
      label: f.querySelector('label').textContent,
      editable: !!f.querySelector('input'),
      value: ((f.querySelector('input') || f.querySelector('.val') || {}).value ?? (f.querySelector('.val') || {}).textContent)
    })),
    text: (d.querySelector('.sheet-pre') || {}).textContent || '',
    buttons: [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim())
  };
});
const tapRow = (page, testid) => page.evaluate((id) => document.querySelector('#tab-net [data-testid="' + id + '"]').click(), testid);
/** 点小窗下排的某个动作（按文案找；文案从 Node 侧传进去，页里不必再写一遍中文） */
const tapButton = (page, label) => page.evaluate((text) => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  [...d.querySelectorAll('.btnrow button')].find((b) => b.textContent.includes(text)).click();
}, label);
const toastText = (page) => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const closeSheets = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));

const openNetBoard = async (page) => {
  await page.evaluate(() => {
    document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
    HP.App.openBoard('net');
  });
  await page.waitForTimeout(700);
};

export default {
  name: 'F-NET-2 连通性 / 丢包 / 延迟（真样本解析 + 界面流程）',

  check: async (page) => {
    const out = {};

    /* ① 纯解析：喂 tools/check_net_py.py 抓的真实输出 */
    out.loopback = await page.evaluate((raw) => HP.Net.parsePing(raw), sample.ping_loopback);
    out.allLost = await page.evaluate((raw) => HP.Net.parsePing(raw), sample[SAMPLE_KEY.pingLost100]);
    out.parseFail = await page.evaluate((raw) => HP.Net.parsePing(raw), sample[SAMPLE_KEY.pingDnsFail]);
    out.tcpOpen = await page.evaluate((raw) => HP.Net.parseTcp(raw), sample[SAMPLE_KEY.tcpLocal22]);
    out.tcpClosed = await page.evaluate((raw) => HP.Net.parseTcp(raw), sample[SAMPLE_KEY.tcpNoListener]);

    /* ② 栏目与行 */
    await page.evaluate((s) => {
      window.__netSamples = s;
      window.__pingRaw = undefined; window.__tcpRaw = undefined;
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.host = { id: 'h1', host: '192.168.1.10', port: 22 };
      HP.Panels._ping = null; HP.Panels._tcp = null;
      HP.Panels.prefs = HP.Panels.prefs || {};
      window.__prefs = window.__prefs || {};
    }, sample);
    await openNetBoard(page);
    out.boardOpen = await page.evaluate(() => document.getElementById('tab-net').classList.contains('on'));
    out.rows = await page.evaluate(() => [...document.querySelectorAll('#tab-net [data-testid]')].map((r) => r.dataset.testid));
    out.neverTested = await readRow(page, 'net-ping');

    /* ③ 点「延迟与丢包」→ 跑真命令（假桥回真样本） */
    await page.evaluate(() => { window.__calls = {}; });
    await tapRow(page, 'net-ping');
    await page.waitForTimeout(1200);
    out.afterPing = {
      row: await readRow(page, 'net-ping'),
      bridgeCalls: await page.evaluate(() => window.__calls),
      bridgeArgs: await page.evaluate(() => window.__lastPing || null)
    };

    /* ④ 点「端口连通」 */
    await tapRow(page, 'net-tcp');
    await page.waitForTimeout(1200);
    out.afterTcp = { row: await readRow(page, 'net-tcp'), bridgeArgs: await page.evaluate(() => window.__lastTcp || null) };

    /* ⑤ 改目标：小窗三个可编辑字段 → 保存写进 pref，旧结果清掉 */
    await tapRow(page, 'net-target');
    await page.waitForTimeout(600);
    out.targetSheet = await readSheet(page);
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ins = [...d.querySelectorAll('.sheet-input')];
      ins[0].value = 'example.local';
      ins[1].value = '4';
      ins[2].value = '2222';
    });
    await tapButton(page, TEXT.save);
    await page.waitForTimeout(900);
    out.afterTargetChange = {
      toast: await toastText(page),
      storedPref: await page.evaluate(() => (window.__prefs || {}).netTarget || null),
      targetRow: await readRow(page, 'net-target'),
      pingRow: await readRow(page, 'net-ping'),
      sheetsLeft: await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length)
    };

    /* ⑥ 失败如实：ping 解析不了 / 端口被拒 */
    await page.evaluate((raw) => { window.__pingRaw = raw; }, sample[SAMPLE_KEY.pingDnsFail]);
    await tapRow(page, 'net-ping');
    await page.waitForTimeout(1200);
    out.pingFail = { row: await readRow(page, 'net-ping'), toast: await toastText(page) };
    await page.evaluate((raw) => { window.__tcpRaw = raw; }, sample[SAMPLE_KEY.tcpNoListener]);
    await tapRow(page, 'net-tcp');
    await page.waitForTimeout(1200);
    out.tcpFail = { row: await readRow(page, 'net-tcp'), toast: await toastText(page) };

    /* ⑦ 原始输出小窗：有原文 + 三个动作 */
    await closeSheets(page);
    await page.evaluate((pair) => { window.__pingRaw = pair.ping; window.__tcpRaw = pair.tcp; },
      { ping: sample.ping_loopback, tcp: sample[SAMPLE_KEY.tcpLocal22] });
    await tapRow(page, 'net-ping');
    await page.waitForTimeout(1100);
    await closeSheets(page);
    await tapRow(page, 'net-tcp');
    await page.waitForTimeout(1100);
    await tapRow(page, 'net-raw');
    await page.waitForTimeout(700);
    out.rawSheet = await readSheet(page);
    await closeSheets(page);

    /* ⑧ 自检：网络栏目登记为"已做"，且不许再报"没挂上 / 没测" */
    out.selfCheck = await page.evaluate(() => HP.Registry.check());

    /* ⑨ F-NET-8 的两个纯函数（区间 → 统计、统计 → 图）在这里先把数字算清（界面在 M4B） */
    out.stats = await page.evaluate(() => {
      /* net.js（app 侧）的统计字段当前按中文键返回 —— 应用侧改名时同步这两行 */
      const sampleCountKey = '采集条数';
      const bucketCountKey = '区间条数';
      const list = [];
      for (let i = 0; i < 10; i++) list.push({ t0: 1000 + i * 100, t1: 1100 + i * 100, up: 100 * (i + 1), down: 200 * (i + 1) });
      const s = HP.Net.bucketize(list, 5);
      const bars = HP.Net.bars(s);
      const pie = HP.Net.pie(s);
      const cols = [...bars.querySelectorAll('.net-col')].map((c) => ({
        up: Number(c.querySelector('.net-up').dataset.v), down: Number(c.querySelector('.net-down').dataset.v)
      }));
      return {
        sampleCount: s[sampleCountKey], bucketCount: s[bucketCountKey], up: s.up, down: s.down, total: s.total,
        share: s.share,
        barCount: cols.length,
        barUpSum: cols.reduce((a, c) => a + c.up, 0),
        barDownSum: cols.reduce((a, c) => a + c.down, 0),
        pieNumbers: [...pie.querySelectorAll('.net-legend-row[data-name]')].map((r) => ({ name: r.dataset.name, value: Number(r.dataset.value), pct: Number(r.dataset.pct), text: r.textContent })),
        sumText: pie.querySelector('[data-testid="net-sum"]').textContent,
        barHeights: [...bars.querySelectorAll('.net-col')].map((c) => c.querySelector('.net-stack').children[1].style.height),
        human: [HP.Net.bytes(0), HP.Net.bytes(999), HP.Net.bytes(1024), HP.Net.bytes(1536), HP.Net.bytes(1048576)]
      };
    });

    out.verdict = {
      loopbackSampleParses: out.loopback.ok &&
        out.loopback.transmitted === expected.loopbackTx && out.loopback.received === expected.loopbackTx && out.loopback.loss === 0 &&
        out.loopback.times.length === out.loopback.transmitted &&
        out.loopback.min <= out.loopback.avg && out.loopback.avg <= out.loopback.max && out.loopback.min > 0,
      allLostSampleParses: out.allLost.ok && out.allLost.transmitted === 2 && out.allLost.received === 0 && out.allLost.loss === 100 &&
        out.allLost.avg === null,
      parseFailReportsError: out.parseFail.ok === false && /Name or service not known/.test(out.parseFail.err),
      tcpSampleParses: out.tcpOpen.ok === true && out.tcpOpen.ms === expected.portMs &&
        out.tcpClosed.ok === false && /Connection refused/.test(out.tcpClosed.err) && out.tcpClosed.ms > 0,
      netBoardOpens: out.boardOpen === true && out.rows.join(',') === 'net-target,net-ping,net-tcp',
      neverTestedShownAsSuch: out.neverTested.sub.includes(TEXT.notTested) && out.neverTested.right === '',
      rowTapRunsRealPing: (out.afterPing.bridgeCalls['net.ping'] || 0) === 1 &&
        out.afterPing.row.sub.indexOf('3 个包 · 0% 丢包') === 0 && out.afterPing.row.right === '0.1 ms',
      rowTapRunsRealTcp: out.afterTcp.row.right === TEXT.tcpUp && RE_TCP_UP.test(out.afterTcp.row.sub) &&
        out.afterTcp.bridgeArgs.host === expected.host && out.afterTcp.bridgeArgs.port === expected.port,
      targetSheetHasThreeEditableFields: !!out.targetSheet && out.targetSheet.fields.filter((f) => f.editable).length === 3 &&
        out.targetSheet.buttons.join('/') === '保存/关闭',
      saveWritesPref: out.afterTargetChange.storedPref === '{"host":"example.local","count":4,"port":2222}' && RE_SAVED.test(out.afterTargetChange.toast),
      targetChangeClearsOldResult: out.afterTargetChange.pingRow.sub.includes(TEXT.notTested) && out.afterTargetChange.targetRow.right === 'example.local',
      pingFailureExplained: out.pingFail.row.sub.includes(TEXT.cannotTest) && out.pingFail.toast.includes(TEXT.didNotRun),
      tcpDownExplained: out.tcpFail.row.sub.includes(TEXT.tcpDownPrefix) && out.tcpFail.row.right === TEXT.tcpDown && out.tcpFail.toast.includes(TEXT.tcpDownToast),
      rawSheetHasBothTextsAndThreeActions: !!out.rawSheet && /\$ ping -c/.test(out.rawSheet.text) &&
        /rtt min\/avg\/max/.test(out.rawSheet.text) && /@@OK 1/.test(out.rawSheet.text) &&
        out.rawSheet.buttons.join('/') === '重测 ping/重测端口/关闭',
      registryNoLongerReportsNetMissing: !out.selfCheck.notMounted.some((x) => /^net/.test(x)) && out.selfCheck.untested.indexOf('net') < 0 &&
        out.selfCheck.notDone.indexOf('net') < 0 && out.selfCheck.uiEmptyGroups.length === 0,
      bucketStatsMatchNumbers: out.stats.sampleCount === 10 && out.stats.bucketCount === 2 && out.stats.up === 5500 && out.stats.down === 11000 &&
        out.stats.total === 16500 && out.stats.barUpSum === out.stats.up && out.stats.barDownSum === out.stats.down &&
        out.stats.barCount === 2,
      shareAndTotalMatch: out.stats.share[0].value === out.stats.down && out.stats.share[1].value === out.stats.up &&
        out.stats.share[0].pct + out.stats.share[1].pct === 100 && RE_TOTAL.test(out.stats.sumText) &&
        out.stats.sumText.includes(TEXT.twoBuckets),
      chartNumbersMatchHumanText: out.stats.human.join('|') === '0B|999B|1KB|1.5KB|1MB' &&
        out.stats.pieNumbers.every((r) => /B|KB|MB/.test(r.text))
    };
    return out;
  }
};
