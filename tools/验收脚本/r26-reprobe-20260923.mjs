/* R-26 复测 · 设备真机驱动（①容量上限 ②落盘节流 ③清理 ④满配额 ⑤设置页占用/原生侧暂不可用 ⑥真机配额与 spill）
 * 产品路径：走 talk.js 自己的 CACHE（= HP.Cache.set + cacheOpt），不是自己造一个 set。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r26-reprobe-20260923.mjs
 */
export default {
  name: 'R26-复测-本地存储',
  check: async (page) => {
    const out = {};

    /* ① 200 条喂进 talk.thread（产品自己的 rpcCache → CACHE.set）→ 只落 50 条 */
    out.C1 = await page.evaluate(async () => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.thread') return { items: Array.from({ length: 200 }, (_, k) => ({ who: 'role', body: '第 ' + k + ' 条 ' + 'z'.repeat(30), at: 1790120000 + k })) };
        if (op === 'talk.roles') return { roles: [] };
        if (op === 'talk.since') return { messages: [], last: 0 };
        return {};
      };
      HP.Talk.sel = { full_name: 'pipeline.tester', title: '测试者' };
      await HP.Talk.paintChat(HP.Talk.sel);
      await new Promise((r) => setTimeout(r, 400));
      HP.Cache.flush();
      const raw = localStorage.getItem('HP_TALK_CACHE.thread.pipeline.tester');
      let n = null, shape = null;
      try { const v = JSON.parse(raw); shape = Object.keys(v || {}); n = Array.isArray(v) ? v.length : (v && Array.isArray(v.items) ? v.items.length : null); } catch (e) { shape = ['parse-fail']; }
      return { fed: 200, storedItems: n, storedKeys: shape, storedBytes: (raw || '').length, maxItemsPref: HP.App.pref('cacheMaxItems', 50) };
    });

    /* ② 落盘节流：产品路径 draft.<角色>（throttle 500）连写 10 次 → 真落盘几次 */
    out.C2 = await page.evaluate(async () => {
      const key = 'HP_TALK_CACHE.draft.pipeline.tester';
      let realWrites = 0;
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === key) realWrites++; return orig.call(this, k, v); };
      const w0 = HP.Cache.report().writes;
      for (let i = 0; i < 10; i += 1) HP.Cache.set('draft.pipeline.tester', 'v' + i, { throttle: 500 });
      await new Promise((r) => setTimeout(r, 900));
      const w1 = HP.Cache.report().writes;
      Storage.prototype.setItem = orig;
      return { calls: 10, throttleMs: 500, realWritesBySetItem: realWrites, writesDelta: w1 - w0, value: localStorage.getItem(key), mergedSkipped: HP.Cache.report().merged };
    });

    /* ③ 清理两个键后占用读数的变化（字节对账） */
    out.C3 = await page.evaluate(async () => {
      HP.Cache.set('probe.keep1', new Array(300).fill('k'), { now: true });
      HP.Cache.set('probe.keep2', new Array(300).fill('m'), { now: true });
      HP.Cache.set('probe.drop1', new Array(400).fill('d'), { now: true });
      HP.Cache.set('probe.drop2', new Array(400).fill('e'), { now: true });
      const before = HP.Cache.report();
      const drop = before.items.filter((it) => it.k === 'probe.drop1' || it.k === 'probe.drop2');
      const dropBytes = drop.reduce((a, x) => a + x.bytes, 0);
      HP.Cache.del('probe.drop1'); HP.Cache.del('probe.drop2');
      const after = HP.Cache.report();
      return {
        beforeKB: +(before.total / 1024).toFixed(1), afterKB: +(after.total / 1024).toFixed(1),
        droppedKB: +(dropBytes / 1024).toFixed(1), countBefore: before.count, countAfter: after.count,
        deltaMatches: Math.abs((before.total - after.total) - dropBytes) <= 2
      };
    });

    /* ④ 满配额：让 setItem 抛 QuotaExceededError → 一次提示 + 降级不再抛 */
    out.C4 = await page.evaluate(async () => {
      let toasts = 0;
      const origToast = HP.App.toast;
      HP.App.toast = function () { toasts += 1; return origToast.apply(this, arguments); };
      const orig = Storage.prototype.setItem;
      let thrown = 0;
      Storage.prototype.setItem = function () { thrown += 1; const e = new Error('quota exceeded (test)'); e.name = 'QuotaExceededError'; throw e; };
      let r1 = null, r2 = null, err = null;
      try { r1 = HP.Cache.set('probe.quota', new Array(50).fill('q'), { now: true }); } catch (e) { err = String(e && e.message); }
      const rep1 = HP.Cache.report();
      try { r2 = HP.Cache.set('probe.quota2', new Array(50).fill('q'), { now: true }); } catch (e) { err = String(e && e.message); }
      Storage.prototype.setItem = orig; HP.App.toast = origToast;
      const rep2 = HP.Cache.report();
      const res = {
        setReturned1: r1, setReturned2: r2, uncaughtInProbe: err, thrownBySetItem: thrown,
        toasts: toasts, degraded: rep1.degraded, lastError: String(rep1.lastError || '').slice(0, 40),
        skippedAfterDegrade: rep2.merged - rep1.merged
      };
      HP.Cache.degraded = false; HP.Cache.toldOnce = false; HP.Cache.lastError = null;   /* 复位，别污染后面几条 */
      return res;
    });

    /* ⑤ 设置页：本地占用回读 + 原生侧（app.storage 未做）如实显示「暂不可用」 */
    out.C5 = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1200));
      const txt = (document.querySelector('#tab-settings') || document.body).textContent.replace(/\s+/g, ' ');
      const m = txt.match(/本地占用[^【]{0,160}/);
      const native = txt.match(/原生侧[^【]{0,80}/);
      const reportToggle = !!HP.Panels && JSON.stringify(HP.Panels.spec || {}).indexOf('storageReport') >= 0;
      return { occupancyLine: m ? m[0].slice(0, 160) : null, nativeLine: native ? native[0].slice(0, 90) : null, hasStorageReportToggle: reportToggle, reportTotalKB: +(HP.Cache.report().total / 1024).toFixed(1) };
    });

    /* ⑥ 真机配额实况 + spill：逐块写直到抛 QuotaExceededError，记下临界值；再查有没有 spill 分支 */
    out.C6 = await page.evaluate(async () => {
      const keys = [];
      let bytes = 0, hitAt = null, errName = null;
      const chunk = 'x'.repeat(64 * 1024);
      try {
        for (let i = 0; i < 200; i += 1) {
          const k = 'RC_TEST_FILL.' + i;
          localStorage.setItem(k, chunk + i);
          keys.push(k); bytes += chunk.length + k.length;
        }
      } catch (e) { hitAt = bytes; errName = String(e && (e.name || e.message)); }
      keys.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      const spillMention = typeof HP.Cache.spill !== 'function';
      return { filledChars: bytes, filledKB: +(bytes / 1024).toFixed(0), quotaHitAtKB: hitAt == null ? null : +(hitAt / 1024).toFixed(0), errorName: errName, spillImplemented: !spillMention, restoredLengthAfterCleanup: localStorage.length };
    });

    const c1 = out.C1, c2 = out.C2, c3 = out.C3, c4 = out.C4, c5 = out.C5, c6 = out.C6;
    out.verdict = {
      '①200条只落50条': c1.storedItems === 50,
      '②10次连写只落1次': c2.realWritesBySetItem === 1 && c2.writesDelta === 1,
      '③清理2键占用对账': c3.deltaMatches === true && (c3.countBefore - c3.countAfter) === 2,
      '④满配额一次提示+降级不抛': c4.uncaughtInProbe == null && c4.toasts === 1 && c4.degraded === true && /配额满/.test(c4.lastError) && c4.skippedAfterDegrade >= 1,
      '⑤设置页能读回占用': !!(c5.occupancyLine && /KB|字节|B\b/.test(c5.occupancyLine)),
      '⑤原生侧如实写暂不可用': !!(c5.nativeLine && /暂不可用/.test(c5.nativeLine))
    };
    return out;
  }
};
