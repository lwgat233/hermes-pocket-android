/* R-35 复测 · 主块＝设置页（清理确认）—— 全部用 `adb shell input tap` 系统触摸
 * 坐标映射：css × (1080/innerWidth, 2138/innerHeight) + y 偏移 136（WebView [0,136][1080,2274]）
 * 先做一次**校准触摸**（群聊身份键：点了文案必变）确认映射对；再接设置页四条判据。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r35-reprobe-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R35-复测-清理确认',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      window.__toasts = [];
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__toasts.push(String(m || '')); return ot.apply(this, arguments); };
      window.__origToast = ot;
    });

    const dev = (el) => page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }, el);

    /* 0) 校准触摸：群聊身份键点了文案必变 */
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 900)); });
    const w0 = await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim());
    const dw = await dev('#tk-whosay2');
    tap(dw.x, dw.y);
    await page.waitForTimeout(700);
    const w1 = await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim());
    out.calibration = { before: w0, after: w1, changed: w0 !== w1, device: dw };

    /* 1) 设置页：把「本地占用」卡滚进视野，读前后基线 */
    await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1300));
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      const sc = card.closest('.panel-body');
      sc.scrollTop = card.getBoundingClientRect().top + sc.scrollTop - 200;
      await new Promise((r) => setTimeout(r, 400));
      HP.Cache.del('probe.keepA'); HP.Cache.del('probe.keepB');
      HP.Cache.set('probe.keepA', new Array(200).fill('a'), { now: true });
      HP.Cache.set('probe.keepB', new Array(200).fill('b'), { now: true });
      await new Promise((r) => setTimeout(r, 200));
    });
    const snap = () => page.evaluate(() => {
      const r = HP.Cache.report();
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      return { keys: r.count, kb: +(r.total / 1024).toFixed(1), cardHead: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 46), dialogOpen: !!document.querySelector('.hp-dialog') };
    });
    out.before = await snap();

    /* 1b) 真触摸「清理」→ 确认框真出现？ */
    const dClean = await dev('[data-store="clean"]');
    tap(dClean.x, dClean.y);
    await page.waitForTimeout(900);
    out.dialogAfterCleanTap = await page.evaluate(() => {
      const d = document.querySelector('.hp-dialog');
      if (!d) return { open: false };
      const yes = d.querySelector('[data-y]'), no = d.querySelector('[data-n]');
      const rect = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), w: Math.round(r.width), h: Math.round(r.height) }; };
      return { open: true, text: d.textContent.replace(/\s+/g, ' ').trim().slice(0, 160), yesLabel: yes ? String(yes.textContent).trim() : null, noLabel: no ? String(no.textContent).trim() : null, yesDevice: rect(yes), noDevice: rect(no) };
    });

    /* 2) 真触摸「取消」→ 前后读数必须一模一样 */
    if (out.dialogAfterCleanTap.open) {
      const nd = out.dialogAfterCleanTap.noDevice;
      tap(nd.x, nd.y);
      await page.waitForTimeout(700);
    }
    out.afterCancel = await snap();
    out.afterCancelToasts = await page.evaluate(() => window.__toasts.slice());

    /* 3) 再点「清理」→ 真触摸「确定」→ 真清 + 原 toast（差值要对得上） */
    const dClean2 = await dev('[data-store="clean"]');
    tap(dClean2.x, dClean2.y);
    await page.waitForTimeout(800);
    out.dialog2 = await page.evaluate(() => { const d = document.querySelector('.hp-dialog'); const y = d && d.querySelector('[data-y]'); if (!d || !y) return null; const r = y.getBoundingClientRect(); return { text: d.textContent.replace(/\s+/g, ' ').trim().slice(0, 140), yesDevice: { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) } }; });
    if (out.dialog2) { tap(out.dialog2.yesDevice.x, out.dialog2.yesDevice.y); await page.waitForTimeout(1000); }
    out.afterConfirm = await snap();
    out.afterConfirmToasts = await page.evaluate(() => window.__toasts.slice());

    /* 4a) 负向：真触摸「看明细」不该弹确认框 */
    await page.evaluate(() => { window.__toasts = []; });
    const dDetail = await dev('[data-store="detail"]');
    tap(dDetail.x, dDetail.y);
    await page.waitForTimeout(900);
    out.negativeDetail = await page.evaluate(() => ({ dialogOpen: !!document.querySelector('.hp-dialog'), toasts: window.__toasts.slice() }));

    /* 4b) 干净态（0 键）点清理照样弹，且提示写 0 个键 */
    await page.evaluate(async () => {
      HP.Cache.clearAll();
      await new Promise((r) => setTimeout(r, 300));
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      const sc = card.closest('.panel-body'); sc.scrollTop = card.getBoundingClientRect().top + sc.scrollTop - 200;
      window.__toasts = [];
    });
    out.emptyState = await page.evaluate(() => { const r = HP.Cache.report(); return { keys: r.count, kb: +(r.total / 1024).toFixed(1) }; });
    const dClean3 = await dev('[data-store="clean"]');
    tap(dClean3.x, dClean3.y);
    await page.waitForTimeout(800);
    out.emptyDialog = await page.evaluate(() => {
      const d = document.querySelector('.hp-dialog');
      if (!d) return { open: false };
      return { open: true, saysZeroKeys: /0 个键/.test(d.textContent), text: d.textContent.replace(/\s+/g, ' ').trim().slice(0, 140) };
    });
    /* 关掉（取消） */
    const cancelDev = await page.evaluate(() => { const n = document.querySelector('.hp-dialog [data-n]'); if (!n) return null; const r = n.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
    if (cancelDev) { tap(cancelDev.x, cancelDev.y); await page.waitForTimeout(500); }

    /* 5) 常驻按键/遮挡 + R-38 复核（只报读数） */
    out.chrome = await page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); if (!e) return null; const bs = [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0); return { n: bs.length }; }; return { keybar: vis('keybar'), composer: vis('composer') }; });
    out.r38 = await page.evaluate(async () => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
          { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] },
          { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] },
          { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', channels: [] },
          { full_name: 'owner.me', title: '我（经理）', online: true, state: 'running', channels: [] },
          { full_name: 'home.maid', title: '可爱女仆', online: false, state: 'paused', channels: [] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2500));
      const g = document.getElementById('tk-gogroup');
      const gr = g.getBoundingClientRect();
      const gh = document.elementFromPoint(Math.round(gr.x + gr.width / 2), Math.round(gr.y + gr.height / 2));
      const maid = document.querySelector('[data-role="home.maid"]');
      const mr = maid.getBoundingClientRect();
      const mh = document.elementFromPoint(Math.round(mr.x + mr.width / 2), Math.round(mr.y + mr.height / 2));
      const comp = document.getElementById('composer').getBoundingClientRect();
      return {
        gogroup: { px: { x: Math.round(gr.x), y: Math.round(gr.y), w: Math.round(gr.width), h: Math.round(gr.height) }, inViewport: gr.bottom <= window.innerHeight, hitSelf: !!(gh && (gh === g || g.contains(gh))), hitWhat: gh ? gh.tagName : null },
        homeMaid: { px: { x: Math.round(mr.x), y: Math.round(mr.y), w: Math.round(mr.width), h: Math.round(mr.height) }, hitSelf: !!(mh && (mh === maid || maid.contains(mh))), hitWhat: mh ? mh.tagName + '.' + String(mh.className).split(' ')[0] : null, composerRect: { y: Math.round(comp.y), h: Math.round(comp.height) }, overlapsComposer: comp.bottom > mr.top && comp.top < mr.bottom },
        viewport: { w: window.innerWidth, h: window.innerHeight }
      };
    });
    return out;
  }
};
