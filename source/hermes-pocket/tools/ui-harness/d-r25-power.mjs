/* R-25（省电模式优化）定位探针：量「前台 / 省电」两态的定时器清单、DOM 变更、rpc 频率。
 * 全部走**工程自己的入口**（HP.App.resumeWork / pauseWork / applyPowerSave、HP.Talk.startPoll），
 * 只读不写：不改 app.js/talk.js，跑完还原（省电状态会恢复）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r25-power.mjs
 */
export default {
  name: 'R-25 定位：前台 vs 省电的定时器 / DOM 变更 / rpc 频率',

  check: async (page) => {
    const out = {};

    /* ① 定时器清单：用真入口重开一遍，数清「谁会起、周期多少」 */
    out.定时器清单 = await page.evaluate(async () => {
      const T = HP.Talk; const A = HP.App;
      const origSI = window.setInterval; const origCI = window.clearInterval;
      let made = []; let cleared = 0; let clearedMs = [];
      const byId = new Map();
      window.setInterval = (fn, ms) => { const id = origSI(fn, ms); made.push(ms); byId.set(id, ms); return id; };
      window.clearInterval = (id) => { cleared += 1; if (byId.has(id)) clearedMs.push(byId.get(id)); return origCI(id); };
      // 先全停，再用真入口逐条开 —— 这样量到的就是工程自己会起的那些
      A.pauseWork(); T.stopPoll(); A.stopPing();
      made = []; cleared = 0; clearedMs = [];
      A.resumeWork();
      const 前台起 = made.slice();
      made = []; cleared = 0; clearedMs = [];
      A.startPing();
      const ping起的 = made.slice();
      made = []; cleared = 0; clearedMs = [];
      T.startPoll();
      const 轮询起的 = made.slice();
      made = []; cleared = 0; clearedMs = [];
      A.pauseWork();
      const 省电停掉 = clearedMs.slice();
      T.stopPoll();
      window.setInterval = origSI; window.clearInterval = origCI;
      return {
        resumeWork起的周期ms: 前台起,
        startPing起的周期ms: ping起的,
        Talk_startPoll起的周期ms: 轮询起的,
        pauseWork清掉的周期ms: 省电停掉,
        resumeWork里还有什么: 'rAF 看门狗（requestAnimationFrame 自续，app.js:1647/238）—— 每秒约屏幕刷新率次，只读两个数字'
      };
    });

    /* ② 前台空闲 4s：DOM 变更次数 + rpc 次数 */
    const measure = async (secs) => page.evaluate(async (s) => {
      const ops = {};
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        try { const m = JSON.parse(t); ops[m.t] = (ops[m.t] || 0) + 1; } catch (e) { /* 非 JSON */ }
        return origPost(t);
      };
      let muts = 0;
      const mo = new MutationObserver((recs) => { muts += recs.length; });
      mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      await new Promise((r) => setTimeout(r, s * 1000));
      mo.disconnect();
      window.HermesPocket.postMessage = origPost;
      const total = Object.values(ops).reduce((a, b) => a + b, 0);
      return { 秒数: s, DOM变更次数: muts, 每秒DOM变更: Number((muts / s).toFixed(1)), rpc次数: total, rpc每秒: Number((total / s).toFixed(2)), rpc明细: ops };
    }, secs);

    out.前台空闲 = await measure(4);

    /* ③ 切到群聊栏目（让 talk 轮询在跑），量 6s 的 talk.since —— 前台 */
    await page.evaluate(() => { HP.App.showBoard('group'); });
    await page.waitForTimeout(300);
    out.前台_群聊页6s = await measure(6);

    /* ④ 真入口进省电：量同一批（省电时轮询停没停，是这次要看的重点） */
    out.进省电 = await page.evaluate(async () => {
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      let powerReq = null;
      window.HermesPocket.postMessage = (t) => {
        try { const m = JSON.parse(t); if (m.t === 'app.power') powerReq = m; } catch (e) { /* 非 JSON */ }
        return origPost(t);
      };
      await HP.App.applyPowerSave(true, '探针');
      const A = HP.App;
      const r = {
        app_power请求: powerReq,
        省电标记: A._powerSave,
        tick定时器还在: !!A._tickTimer,
        流量定时器还在: !!A._trafficTimer,
        ping定时器还在: !!A.ping.timer,
        rAF看门狗还在: !!A._watchRaf,
        talk轮询还在: !!HP.Talk.timer,
        唤醒锁字段: (A._powerState || {}).wakeHeld,
        心跳字段: (A._powerState || {}).keepalive
      };
      window.HermesPocket.postMessage = origPost;
      return r;
    });
    out.省电时_群聊页6s = await measure(6);

    /* ⑤ 回前台：省电有没有恢复回去 */
    out.恢复 = await page.evaluate(async () => {
      await HP.App.applyPowerSave(false, '探针');
      const A = HP.App;
      return { 省电标记: A._powerSave, tick定时器还在: !!A._tickTimer, 流量定时器还在: !!A._trafficTimer, talk轮询还在: !!HP.Talk.timer };
    });
    out.恢复后前台 = await measure(4);

    return out;
  }
};
