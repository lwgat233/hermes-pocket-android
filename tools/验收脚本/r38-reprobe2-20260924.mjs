/* R-38 复测 · 补测段：① 确认「去群聊 →」真触摸后**真的切了板块**（它的处理器是 HP.App.showBoard('group')，
 *              上一版我查错了对象——查的是 talk 板块的 HP.Talk.view）；② 重算末尾到 #composer 顶的间隙。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r38-reprobe2-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R38-复测-补测',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(async () => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
          { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] },
          { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] },
          { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', channels: [] },
          { full_name: 'owner.me', title: '我（经理）', online: true, state: 'running', channels: [] },
          { full_name: 'home.maid', title: '可爱女仆', online: false, state: 'paused', channels: [] }] }], channels: { qqbot: 1, wechat: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2600));
      const sc = [...document.querySelectorAll('.panel-body')].find((e) => e.scrollHeight > e.clientHeight) || document.querySelector('.panel-body');
      window.__sc = sc;
      sc.scrollTop = sc.scrollHeight;
    });
    await page.waitForTimeout(700);
    const boardNow = () => page.evaluate(() => {
      const boards = [...document.querySelectorAll('[id^="tab-"]')].map((e) => ({ id: e.id, visible: !!(e.offsetParent || e.getClientRects().length) }));
      return { visibleBoards: boards.filter((b) => b.visible).map((b) => b.id), groupTitle: (() => { const t = document.querySelector('#tab-group .tk-title'); return t ? t.textContent.trim() : null; })(), stream: !!document.getElementById('tk-stream') };
    });
    out.scroller = await page.evaluate(() => { const sc = window.__sc; const r = sc.getBoundingClientRect(); const cr = document.getElementById('composer').getBoundingClientRect(); const kids = [...sc.children].filter((c) => c.getBoundingClientRect().height > 0); const last = kids[kids.length - 1]; return { sel: { id: sc.id || null, cls: String(sc.className) }, scrollTop: Math.round(sc.scrollTop), scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, rectBottom: Math.round(r.bottom), composerTop: Math.round(cr.top), innerHeight: window.innerHeight, vvHeight: Math.round((window.visualViewport || {}).height || 0), lastChild: last ? { tag: last.tagName, cls: String(last.className), bottom: Math.round(last.getBoundingClientRect().bottom) } : null, gapToComposer: last ? Math.round(cr.top - last.getBoundingClientRect().bottom) : null, childCount: kids.length }; });
    out.boardBefore = await boardNow();
    const g = await page.evaluate(() => { const e = document.getElementById('tk-gogroup'); const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
    tap(g.x, g.y);
    await page.waitForTimeout(1300);
    out.boardAfterGogroup = await boardNow();
    return out;
  }
};
