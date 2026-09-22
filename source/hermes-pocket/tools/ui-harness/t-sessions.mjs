/* F-SESS-6 判据：会话（tmux）流程
 * ① 解析真实 tmux 输出（含"没在跑 tmux"的报错）
 * ② 启动流程：**有会话就 attach（不新建）**、没有才建 —— 全程不发任何 kill
 * ③ 界面：一行状态 + 一会话一行，点行就切过去
 */
const sampleTwo = 'hermes__HP__3__HP__1__HP__1789980000__HP__1789900000\nwork__HP__1__HP__0__HP__1789979000__HP__1789800000\n';
const sampleNone = 'no server running on /tmp/tmux-1000/default\n';

/* 传给 bootstrapSessions 的 why 参数：与原来那句中文字符串同一个值，行为不变 */
const testWhy = '测试';

const sentWrites = (page) => page.evaluate(() => (window.__sentWrites || []).slice());

const hookSend = (page) => page.evaluate(() => {
  const t = HP.App.transport;
  if (!window.__hooked) {
    window.__hooked = true;
    window.__sentAll = [];
    const o = t.send.bind(t);
    t.send = (obj) => { window.__sentAll.push(JSON.stringify(obj)); if (obj && obj.t === 'session.write') (window.__sentWrites = window.__sentWrites || []).push(obj.data); return o(obj); };
  }
  window.__sentAll = []; window.__sentWrites = [];
});

/* 把内存里的终端输入解出来（send 走的是 base64） */
const decodeSent = (page) => page.evaluate(() => (window.__sentWrites || [])
  .map((b64) => { try { return HP.dec.decode(HP.b64decode(b64)); } catch (e) { return ''; } }).join(''));

export default {
  name: 'F-SESS-6 会话（tmux）流程：能看 / 能选 / 有就不动 / 永不终止',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => { if (HP.App.closePanel) HP.App.closePanel(); });
    await page.evaluate(() => { HP.App.sessionId = 's1'; HP.App.state = 'connected'; });
    await hookSend(page);

    /* ① 解析纯函数 */
    out.parseTwo = await page.evaluate((raw) => HP.Sessions.parse(raw), sampleTwo);
    out.parseNone = await page.evaluate((raw) => HP.Sessions.parse(raw), sampleNone);

    /* ② 启动流程：远端**已经有两个会话** → 必须 attach，不许新建 */
    await hookSend(page);
    await page.evaluate((raw) => { window.__tmuxRaw = raw; HP.Sessions.at = 0; HP.Sessions.sel = ''; }, sampleTwo);
    out.bootHasSession = await page.evaluate(async (why) => {
      const r = await HP.App.bootstrapSessions(why);
      return r;
    }, testWhy);
    await page.waitForTimeout(200);
    out.bootHasSessionSent = await decodeSent(page);

    /* ②b 启动流程：远端**没有会话** → 按主机的启动命令建（stub 里主机带 startCmd） */
    await page.evaluate(() => { HP.App.host = { name: '测试主机', startCmd: "tmux new -As hermes 'hermes --tui' \\; set -g mouse on" }; });
    await hookSend(page);
    await page.evaluate((raw) => { window.__tmuxRaw = raw; HP.Sessions.at = 0; }, sampleNone);
    out.bootNoSessionHostCmd = await page.evaluate((why) => HP.App.bootstrapSessions(why), testWhy);
    out.bootNoSessionSent = await decodeSent(page);

    /* ②c 没有会话、主机也没写启动命令 → 自己建默认会话 */
    await hookSend(page);
    await page.evaluate(() => { HP.App.host.startCmd = ''; });
    out.bootNoSessionCreate = await page.evaluate((why) => HP.App.bootstrapSessions(why), testWhy);
    out.bootNoSessionCreateSent = await decodeSent(page);

    /* ③ 界面：进「会话」栏目 → 状态行 + 两行 + 右列状态；点第二行切过去 */
    await page.evaluate((raw) => { window.__tmuxRaw = raw; HP.Sessions.at = 0; HP.Sessions.sel = ''; HP.App.openBoard('sessions'); }, sampleTwo);
    await page.waitForTimeout(900);
    out.ui = await page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const rows = [...el.querySelectorAll('[data-testid^="session-"]')].map((r) => ({
        id: r.dataset.testid, t: r.querySelector('.ri-t').textContent, s: r.querySelector('.ri-s').textContent,
        r: r.querySelector('.ri-r').textContent, on: r.classList.contains('row-on')
      }));
      return { statusLine: [...el.querySelectorAll('.ui-status')].map((x) => x.textContent), rowCount: rows.length, rows: rows };
    });
    await hookSend(page);
    await page.evaluate(() => {
      const r = document.querySelector('#tab-sessions [data-testid="session-work"]');
      r.click();
    });
    await page.waitForTimeout(400);
    out.clickSecondRow = await page.evaluate(() => ({
      'selected': HP.Sessions.sel,
      'statusLine': [...document.querySelectorAll('#tab-sessions .ui-status')].map((x) => x.textContent),
      'selectedMarker': (document.querySelector('#tab-sessions [data-testid="session-work"]') || {}).className
    }));
    out.clickSecondRowSent = await decodeSent(page);

    /* ④ 「永不终止」：所有发出去的负载里都不许出现 kill */
    out.neverKill = await page.evaluate(() => {
      const all = (window.__sentAll || []).join('\n');
      return {
        'payloadCount': (window.__sentAll || []).length,
        'hasKill': /kill(-session|-server)?/.test(all),
        'hasNewAs': /new -As/.test(all)
      };
    });

    out.verdict = {
      'parsedTwoSessions': out.parseTwo.list.length === 2 && out.parseTwo.list[0].name === 'hermes' && out.parseTwo.list[0].windows === 3,
      'parseNoTmuxNoThrow': out.parseNone.list.length === 0 && !!out.parseNone.err,
      'attachWhenSessionsExist': out.bootHasSession.action === 'attach' && out.bootHasSession.name === 'hermes',
      'noCreateWhenSessionsExist': /tmux attach -t 'hermes'/.test(out.bootHasSessionSent) && !/new -As/.test(out.bootHasSessionSent),
      'hostCmdWhenNoSessions': out.bootNoSessionHostCmd.action === 'startCmd',
      'createWhenNoSessionsNoCmd': out.bootNoSessionCreate.action === 'create' && /tmux new -As 'hermes'/.test(out.bootNoSessionCreateSent),
      'twoUiRows': out.ui.rowCount === 2,
      'statusLineHasOnlineAndCount': String(out.ui.statusLine.join(' ')).includes('在线：已连接') && String(out.ui.statusLine.join(' ')).includes('远端 tmux：2 个会话'),
      'rightColumnIsState': out.ui.rows[0].r === 'attach 中' && out.ui.rows[1].r === '空闲',
      'clickRowSwitches': out.clickSecondRow.selected === 'work' && /tmux attach -t 'work'/.test(out.clickSecondRowSent),
      'uiFollowsSwitch': String(out.clickSecondRow.statusLine.join(' ')).includes('当前选中：work') && /row-on/.test(out.clickSecondRow.selectedMarker),
      'neverKillsSession': out.neverKill.hasKill === false
    };
    return out;
  }
};
