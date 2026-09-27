/* R-36 复测 · 主块②聊天页-群聊（不接主机＝真路径）+ 跨块①聊天页-单聊（回执形状控制）
 * 关键手法：**不整体替换 HP.App.rpc**，只包一层（属性/角色数据走 stub，talk.shout/talk.say 落回**真 rpc**）
 *          → 不接主机那条判据跑的是真路径（真报「还没连接」），不是我把异常喂进去的。
 * 真触摸：adb shell input tap（系统触摸链路）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r36-reprobe-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R36-复测-送达口径',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    /* 只包一层：角色/消息用 stub，传输层（talk.shout / talk.say）落回真 rpc */
    await page.evaluate(() => {
      const orig = HP.App.rpc.bind(HP.App);
      window.__origRpc = orig;
      HP.App.rpc = async (op, args) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
          { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] },
          { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] },
          { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', channels: [] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.sessions') return {};
        if (op === 'talk.deliveries') return { items: [] };
        return orig(op, args);            /* ← 关键：shout/say 走真路径 */
      };
      HP.App.sessionId = 'probe';
      window.__toasts = [];
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__toasts.push(String(m || '')); return ot.apply(this, arguments); };
    });
    const dev = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; }, sel);
    const rows = () => page.evaluate(() => {
      const box = document.getElementById('tk-sends');
      if (!box) return { found: false };
      return { found: true, rows: [...box.querySelectorAll('.tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), cls: r.className.replace('tk-sendrow ', ''), text: (r.querySelector('.tk-sendtext') || {}).textContent || '', subs: [...r.querySelectorAll('.tk-sendsub')].map((s) => s.textContent), retry: !!r.querySelector('[data-testid="talk-retry"]') })) };
    });

    try {
    /* 0) 校准触摸 */
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 900)); });
    const w0 = await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim());
    const dw = await dev('#tk-whosay2'); tap(dw.x, dw.y); await page.waitForTimeout(600);
    const w1 = await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim());
    out.calibration = { before: w0, after: w1, changed: w0 !== w1 };

    /* 1) 主块②群聊 · 不接主机（真路径）：真触摸「广播」 */
    await page.evaluate(async () => {
      HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 800));
      window.__toasts = [];
      document.getElementById('tk-shoutin').value = 'R36-noHost';
    });
    const dShout = await dev('#tk-shoutok');
    tap(dShout.x, dShout.y);
    await page.waitForTimeout(1600);
    out.noHostShout = await rows();
    out.noHostShout.raw = await page.evaluate(() => { const b = document.getElementById('tk-sends'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : null; });
    out.noHostShout.hasDeliveredWord = /已送达/.test(String(out.noHostShout.raw));
    out.noHostShout.hasMsDigits = /\d+\s*ms/.test(String(out.noHostShout.raw));
    out.noHostShout.toasts = await page.evaluate(() => window.__toasts.slice());

    /* 2) 群聊 · 平台回执形状（stub 传输层；ms 用台账真值 8382=台账 #1190 的实测 ms） */
    await page.evaluate(async () => {
      const orig = window.__origRpc;
      HP.App.rpc = async (op, args) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
          { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] },
          { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] },
          { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', channels: [] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.shout') return { results: [{ role: 'pipeline.tester', delivered: true, ms: 8382 }, { role: 'pipeline.author', delivered: false, error: '阶段没放行' }] };
        return orig(op, args);
      };
      HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 700));
      document.getElementById('tk-shoutin').value = 'R36-platform';
    });
    const dShout2 = await dev('#tk-shoutok');
    tap(dShout2.x, dShout2.y);
    await page.waitForTimeout(1600);
    out.platformShout = await rows();

    /* 3) 跨块①单聊 · A 回执没 delivered → 中性态；B 明确没投成 → 没送达 */
    const waitFor = async (sel, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const ok = await page.evaluate((s) => !!document.querySelector(s), sel); if (ok) return true; await page.waitForTimeout(250); } return false; };
    const sayRun = async (reply, mark) => {
      await page.evaluate(async (rep, mk) => {
        const orig = window.__origRpc;
        HP.App.rpc = async (op, args) => {
          if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
          if (op === 'talk.since') return { messages: [], last: 0 };
          if (op === 'talk.asks') return { count: 0, asks: [] };
          if (op === 'talk.thread') return { items: [] };
          if (op === 'talk.say') return JSON.parse(rep);
          return orig(op, args);
        };
        HP.App.state = 'connected';
        HP.App.showBoard('talk');
        await HP.Talk.openRole('pipeline.author');
        await new Promise((r) => setTimeout(r, 1600));
      }, JSON.stringify(reply), mark);
      const okIn = await waitFor('#tk-sayin');
      if (!okIn) return { found: false, why: '#tk-sayin 没出现' };
      await page.evaluate((mk) => { document.getElementById('tk-sayin').value = mk; }, mark);
      const d = await dev('#tk-sayok');
      tap(d.x, d.y);
      await page.waitForTimeout(1500);
      return rows();
    };
    out.singleUnconfirmed = await sayRun({}, 'R36-say-A');
    out.singleFailed = await sayRun({ delivered: false, error: '阶段没放行' }, 'R36-say-B');
    out.singleDelivered = await sayRun({ delivered: true }, 'R36-say-C');   /* 对照：有 delivered=true 才该绿+ms */

    /* 4) 常驻按键/遮挡 */
    out.chrome = await page.evaluate(() => {
      const vis = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; };
      const box = document.getElementById('tk-sends');
      const r = box ? box.getBoundingClientRect() : null;
      return { keybar: vis('keybar'), composer: vis('composer'), sendsBox: r ? { y: Math.round(r.y), h: Math.round(r.height) } : null, viewportH: window.innerHeight };
    });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
