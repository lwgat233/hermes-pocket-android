/* R-47 定位探针：频道/终端切页卡顿 —— **只量不改**。
 * 量六项（本人 2026-09-27 原话：频道加载卡顿，包括终端等等的，需要优化）：
 *   ① 切页耗时：频道页 / 终端页 / 回聊天页(单聊) 各 3 次（performance.now 打点，同步段 + 首次可见）
 *   ② 卡顿时长：PerformanceObserver('longtask')，>50ms 全列
 *   ③ 首屏渲染次数：paintRole/paintChannel/paintGroup/paintSends/render/paintStream/paintChat/renderHermes
 *   ④ talk.* / hermes.* RPC：次数 + 每次耗时（包装 HP.App.rpcRaw —— 所有 RPC 的唯一出口）
 *   ⑤ 掉帧：切页后 2 秒内 rAF 帧数/长间隔（>33ms 记一次"掉帧"）
 *   ⑥ 同源项：R-46 首屏双份渲染（#tk-sayin / 气泡数）· R-11（renderHermes 次数）· R-26 轮询周期与轮询次数 ·
 *             终端回滚缓冲 · R-39 --sayline-h 写入次数
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r47-perf.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R40-定位-20260924/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const ROLES = read('roles-json.json');
const SESS = read('sessions-json.json');
const THREAD = JSON.parse(fs.readFileSync(
  path.resolve(HERE, '../../../../evidence/R37-定位-20260924/fixtures/thread-home.maid.json'), 'utf8'));

export default {
  name: 'R-47 定位：频道/终端切页卡顿（六项读数，只量不改）',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    /* 0) 假桥：talk.* 三个 fixture（和 R-39/R-42 一样的起法） */
    await page.evaluate(({ ROLES, SESS, THREAD }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.thread') { setTimeout(() => reply(m._rid, THREAD), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS, THREAD });

    /* 1) 装计数器（只包函数，不改逻辑；页面每次 reload 都要重装） */
    await page.evaluate(() => {
      const S = window.__r47 = {
        rpc: {}, renders: {}, longtasks: [], saylineWrites: 0, frames: [], notes: [],
      };
      // ④ RPC：唯一出口 HP.App.rpcRaw
      const orig = HP.App.rpcRaw.bind(HP.App);
      HP.App.rpcRaw = function (type, payload, timeout) {
        const t0 = performance.now();
        const rec = S.rpc[type] || (S.rpc[type] = { n: 0, ms: 0, max: 0 });
        rec.n++;
        const p = orig(type, payload, timeout);
        if (p && typeof p.then === 'function') {
          p.then(() => {
            const d = performance.now() - t0;
            rec.ms += d; rec.max = Math.max(rec.max, d);
            if (rec.n === 1) rec.first = Math.round(d);
          }, () => { });
        }
        return p;
      };
      // ③ 渲染函数计数
      ['render', 'paintRole', 'paintChannel', 'paintGroup', 'paintStream', 'paintSends', 'paintChat'].forEach((m) => {
        const o = HP.Talk && HP.Talk[m];
        if (typeof o !== 'function') return;
        HP.Talk[m] = function (...a) { S.renders[m] = (S.renders[m] || 0) + 1; return o.apply(this, a); };
      });
      if (HP.Panels && typeof HP.Panels.renderHermes === 'function') {
        const o = HP.Panels.renderHermes;
        HP.Panels.renderHermes = function (...a) { S.renders.renderHermes = (S.renders.renderHermes || 0) + 1; return o.apply(this, a); };
      }
      // ⑥ R-39：--sayline-h 被写几次
      const sp = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (name, v, prio) {
        if (name === '--sayline-h') window.__r47.saylineWrites++;
        return sp.call(this, name, v, prio);
      };
      // ② longtask
      try {
        new PerformanceObserver((l) => l.getEntries().forEach((e) =>
          S.longtasks.push({ t: Math.round(e.startTime), dur: Math.round(e.duration) }))).observe({ entryTypes: ['longtask'] });
      } catch (e) { S.notes.push('longtask 观察不到：' + e); }
      // ⑤ rAF 采样器
      window.__r47Sample = (ms) => new Promise((res) => {
        const ts = []; const t0 = performance.now();
        const step = (t) => { ts.push(t); (t - t0 < ms) ? requestAnimationFrame(step) : res(ts); };
        requestAnimationFrame(step);
      });
      window.__r47Stats = (ts) => {
        if (!ts.length) return { frames: 0 };
        let dropped = 0, maxGap = 0;
        for (let i = 1; i < ts.length; i++) { const g = ts[i] - ts[i - 1]; if (g > 33.4) dropped++; if (g > maxGap) maxGap = g; }
        return { frames: ts.length, spanMs: Math.round(ts[ts.length - 1] - ts[0]), droppedFrames: dropped, maxGapMs: Math.round(maxGap) };
      };
      window.__r47Mark = () => ({ renders: JSON.parse(JSON.stringify(S.renders)), rpc: JSON.parse(JSON.stringify(S.rpc)), saylineWrites: S.saylineWrites, longtasks: S.longtasks.length });
      window.__r47Delta = (a) => {
        const d = { renders: {}, rpc: {}, saylineWrites: S.saylineWrites - a.saylineWrites, longtasks: S.longtasks.slice(a.longtasks) };
        Object.keys(S.renders).forEach((k) => { const v = (S.renders[k] || 0) - (a.renders[k] || 0); if (v) d.renders[k] = v; });
        Object.keys(S.rpc).forEach((k) => {
          const n = (S.rpc[k] || { n: 0 }).n - ((a.rpc[k] || { n: 0 }).n);
          if (n) d.rpc[k] = { n, maxMs: Math.round((S.rpc[k] || {}).max || 0) };
        });
        return d;
      };
    });

    /* 2) 冷启动基线：等应用起来（首次进终端） */
    await page.waitForFunction(() => window.HP && HP.App && HP.App.state === 'connected', null, { timeout: 15000 }).catch(() => { });
    await page.waitForTimeout(800);

    const doSwitch = async (label, fn, opts = {}) => {
      const before = await page.evaluate(() => window.__r47Mark());
      const sampler = page.evaluate((ms) => window.__r47Sample(ms).then((ts) => window.__r47Stats(ts)), opts.sampleMs || 2000);
      const timing = await fn();                       // fn 自己负责页面内打点并返回 {syncMs, firstPaintMs}
      const frames = await sampler;
      const after = await page.evaluate(() => window.__r47Mark());
      const delta = await page.evaluate((a) => window.__r47Delta(a), before);
      return { label, syncMs: Math.round(timing.syncMs * 10) / 10, firstPaintMs: Math.round(timing.firstPaintMs * 10) / 10, frames, delta };
    };

    /* 三段切页：页面内打点 —— syncMs = 同步调用的耗时（DOM 重建）；firstPaintMs = 到"新内容第一帧被画出来" */
    const enterChannel = () => page.evaluate(async () => {
      const t0 = performance.now();
      HP.App.openBoard('talk');
      const syncMs = performance.now() - t0;
      const paint = await new Promise((r) => requestAnimationFrame((t) => r(t)));
      await new Promise((r) => setTimeout(r, 900));
      return { syncMs, firstPaintMs: paint - t0 };
    });
    const enterTerminal = () => page.evaluate(async () => {
      const t0 = performance.now();
      HP.App.closePanel();
      const syncMs = performance.now() - t0;
      const paint = await new Promise((r) => requestAnimationFrame((t) => r(t)));
      await new Promise((r) => setTimeout(r, 900));
      return { syncMs, firstPaintMs: paint - t0 };
    });
    const enterChat = () => page.evaluate(async () => {
      const parts = {}; let t = performance.now();
      HP.App.openBoard('talk');
      parts.openBoardMs = performance.now() - t;                 // 建/显示频道页（同步段）
      await new Promise((r) => setTimeout(r, 400));              // 等角色列表就绪（**不计入切页耗时**）
      t = performance.now(); await HP.Talk.refreshRoles();
      parts.refreshRolesMs = performance.now() - t;              // 拉角色列表（RPC）
      t = performance.now(); await HP.Talk.openRole('home.maid');
      parts.openRoleMs = performance.now() - t;                  // 进单聊（建整页 DOM，同步段）
      const paint = await new Promise((r) => requestAnimationFrame((x) => r(x)));
      const firstPaintMs = paint - t;                            // 到"单聊页第一帧"
      await new Promise((r) => setTimeout(r, 900));
      return { syncMs: parts.openRoleMs, firstPaintMs, parts };
    });

    const first = { channel: [], terminal: [], chat: [] };
    for (let i = 1; i <= 3; i++) {
      first.channel.push(await doSwitch(`频道页 #${i}`, enterChannel));
      first.terminal.push(await doSwitch(`终端页 #${i}`, enterTerminal));
      first.chat.push(await doSwitch(`回聊天页(单聊) #${i}`, enterChat));
    }
    out.切页耗时_三次 = first;

    /* 3) ① 耗时汇总 */
    const agg = (arr) => ({
      次数: arr.length,
      ms: arr.map((x) => x.syncMs),
      首次可见ms: arr.map((x) => x.syncMs),
    });
    out['① 切页耗时_同步段ms'] = { 频道页: agg(first.channel).ms, 终端页: agg(first.terminal).ms, 聊天页: agg(first.chat).ms };

    /* 4) ② 长任务（>50ms 全列） */
    const lt = await page.evaluate(() => window.__r47.longtasks.slice());
    out['② 长任务'] = {
      总数: lt.length,
      最长ms: lt.reduce((m, x) => Math.max(m, x.dur), 0),
      全部: lt.map((x) => x.dur),
      明细: lt,
    };

    /* 5) ③ 渲染次数（累计） */
    out['③ 渲染次数_累计'] = await page.evaluate(() => JSON.parse(JSON.stringify(window.__r47.renders)));

    /* 6) ④ RPC 次数与耗时（累计） */
    out['④ RPC_累计'] = await page.evaluate(() => {
      const r = window.__r47.rpc; const o = {};
      Object.keys(r).sort().forEach((k) => { o[k] = { n: r[k].n, 首次ms: r[k].first, 最大ms: Math.round(r[k].max), 合计ms: Math.round(r[k].ms) }; });
      return o;
    });

    /* 7) ⑥ 同源项：R-46 / R-11 / R-26 / 回滚缓冲 / --sayline-h */
    await page.evaluate(async () => {          // R-46：单聊首屏
      HP.App.openBoard('talk');
      await new Promise((r) => setTimeout(r, 600));
      await HP.Talk.openRole('home.maid');
      await new Promise((r) => setTimeout(r, 600));
    });
    const r46first = await page.evaluate(() => ({
      tk_sayin: document.querySelectorAll('#tk-sayin').length,
      tk_sayline: document.querySelectorAll('#tk-sayline').length,
      bub: document.querySelectorAll('#tk-chat .tk-bub').length,
    }));
    await page.evaluate(async () => { HP.Talk.render(); await new Promise((r) => setTimeout(r, 400)); });
    const r46after = await page.evaluate(() => ({
      tk_sayin: document.querySelectorAll('#tk-sayin').length,
      bub: document.querySelectorAll('#tk-chat .tk-bub').length,
    }));
    const mark11 = await page.evaluate(() => window.__r47Mark());
    await page.evaluate(async () => { HP.App.openBoard('hermes'); await new Promise((r) => setTimeout(r, 900)); });
    const hermesDelta = await page.evaluate((a) => window.__r47Delta(a), mark11);
    // R-26：轮询周期 + 空闲 6 秒里的轮询次数
    const pollBefore = await page.evaluate(() => window.__r47Mark());
    await page.evaluate(async () => {
      HP.App.openBoard('talk'); await new Promise((r) => setTimeout(r, 300));
      await HP.Talk.openRole('home.maid');
    });
    await page.waitForTimeout(6000);
    const pollDelta = await page.evaluate((a) => window.__r47Delta(a), pollBefore);
    const misc = await page.evaluate(() => ({
      poll_ms: HP.Talk.POLL_MS, poll_save_ms: HP.Talk.POLL_SAVE_MS, powerSave: !!HP.Talk._powerSave,
      当前轮询间隔: HP.Talk.pollMs ? HP.Talk.pollMs() : null,
      scrollback: (HP.App.prefs && HP.App.prefs.scrollback) || (HP.App.term && HP.App.term.options && HP.App.term.options.scrollback) || null,
      saylineWrites: window.__r47.saylineWrites,
      saylineH: getComputedStyle(document.documentElement).getPropertyValue('--sayline-h'),
    }));
    out['⑥ 同源项'] = {
      'R-46 单聊首屏(真机=2份)': { 首屏: r46first, 重画一次后: r46after, 结论: r46first.tk_sayin === 1 ? '本机台仍是 1 份（与 R-39 一致，真机才是 2 份）' : '本机台也出现多份' },
      'R-11 Hermes 页': { '切到 hermes 这一次的渲染/调用': hermesDelta, 累计: await page.evaluate(() => JSON.parse(JSON.stringify(window.__r47.renders))) },
      'R-26 轮询': { 常量: { POLL_MS: misc.poll_ms, POLL_SAVE_MS: misc.poll_save_ms, powerSave: misc.powerSave, 实际间隔: misc.当前轮询间隔 }, 空闲6秒里的调用: pollDelta.rpc, 渲染: pollDelta.renders },
      '终端回滚缓冲': misc.scrollback,
      'R-39 --sayline-h': { 累计写入次数: misc.saylineWrites, 当前值: misc.saylineH },
    };

    /* 8) 页面/视口基本信息（口径说明用） */
    out.环境 = await page.evaluate(() => ({
      viewport: { w: innerWidth, h: innerHeight },
      ua: navigator.userAgent.slice(0, 60),
      talkView: HP.Talk.view, tab: (document.querySelector('.tabs button.on') || {}).dataset ? document.querySelector('.tabs button.on').dataset.tab : null,
      longtaskSupported: typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes && PerformanceObserver.supportedEntryTypes.includes('longtask'),
    }));
    return out;
  },
};
