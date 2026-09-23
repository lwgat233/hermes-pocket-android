/* R-26 验收探针：本地存储（占用读数 / 条数上限 / 落盘节流 / 自动清理 / 满配额不静默 / 省电不冲突）
 * 走**真页面/真写入路径**（HP.Talk.refreshRoles、paintChat、设置页 renderSettings），用平台真回包当夹具。
 * 条数上限那段把真回包形状复制到 200 条，只为撞上限用（形状=平台真的，条数=撑爆用）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r26-storage.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '../../../../evidence/R26-定位-20260923/fixtures');
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

export default {
  name: 'R-26 验收：占用读数/条数上限/落盘节流/自动清理/满配额不静默/省电不冲突',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });

    const threadFix = read('thread-pipeline.tester.json');
    const rolesFix = read('roles-json.json');
    const big200 = { role: threadFix.role, count: 200, items: [] };
    while (big200.items.length < 200) {
      threadFix.items.forEach((it, i) => { if (big200.items.length < 200) big200.items.push(Object.assign({}, it, { id: big200.items.length + 1 })); });
    }

    const out = {};

    /* 装计量与假桥（只劫持 HP_TALK_CACHE.* 的 setItem，统计真落盘次数） */
    await page.evaluate(() => {
      window.__r26 = { puts: 0, byKey: {} };
      window.__r26Orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf('HP_TALK_CACHE.') === 0) { window.__r26.puts++; window.__r26.byKey[k] = (window.__r26.byKey[k] || 0) + 1; }
        return window.__r26Orig.call(this, k, v);
      };
      window.__r26Reset = () => { window.__r26 = { puts: 0, byKey: {} }; };
      window.__r26Fail = (on) => {
        Storage.prototype.setItem = on
          ? function (k, v) { if (String(k).indexOf('HP_TALK_CACHE.') === 0) { const e = new Error('QuotaExceededError: Setting the value of ' + k); e.name = 'QuotaExceededError'; throw e; } return window.__r26Orig.call(this, k, v); }
          : function (k, v) { if (String(k).indexOf('HP_TALK_CACHE.') === 0) { window.__r26.puts++; window.__r26.byKey[k] = (window.__r26.byKey[k] || 0) + 1; } return window.__r26Orig.call(this, k, v); };
      };
      const T = HP.Talk;
      T.pullRoleOutput = () => { };                     /* R-32 既有缺陷，单独登记，这里避开 */
      T.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline', online: true }];
      window.__r26Say = window.HermesPocket.postMessage.bind(window.HermesPocket);
    });
    const stub = (op, payload) => page.evaluate(({ op, payload }) => {
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (!m || m.t !== op) return window.__r26Say(t);
        setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: payload }) }), 20);
      };
    }, { op, payload });

    /* ① 能读回「现在占多少」（真写路径 + 真设置页那行字） */
    await stub('talk.roles', rolesFix);
    out['①_写入与读数'] = await page.evaluate(async () => {
      await HP.Talk.refreshRoles();                     /* 真路径：rpcCache → CACHE.set */
      HP.Cache.flush();
      const r = HP.Cache.report();
      return { 键数: r.count, 合计KB: Math.round(r.total / 1024), 键: r.items.map((x) => x.k), 降级: r.degraded };
    });
    await page.evaluate(() => HP.App.openBoard('settings'));
    await page.waitForTimeout(700);
    out['①_设置页读数'] = await page.evaluate(() => {
      const line = document.getElementById('st-store');
      const nat = document.getElementById('st-store-native');
      return {
        合计那行: line ? line.textContent : null,
        有数字: !!(line && /KB/.test(line.textContent)),
        原生侧那行: nat ? nat.textContent : null,
        有看明细键: !!document.querySelector('[data-store="detail"]'),
        有清理键: !!document.querySelector('[data-store="clean"]')
      };
    });

    /* ② 条数上限：真回包撑到 200 条，落盘只留 cacheMaxItems 条；连续重画不再增长 */
    await stub('talk.thread', big200);
    out['②_条数上限'] = await page.evaluate(async () => {
      const T = HP.Talk;
      const role = { full_name: 'pipeline.tester', title: '测试者' };
      window.__r26Reset();
      await T.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 300));
      await T.paintChat(role);
      HP.Cache.flush();
      const raw = localStorage.getItem('HP_TALK_CACHE.thread.pipeline.tester');
      const first = JSON.parse(raw);
      const bytes1 = raw.length * 2;
      for (let i = 0; i < 3; i++) { await T.paintChat(role); await new Promise((r) => setTimeout(r, 50)); }
      HP.Cache.flush();
      const raw2 = localStorage.getItem('HP_TALK_CACHE.thread.pipeline.tester');
      const second = JSON.parse(raw2);
      return {
        回包条数: 200, 落盘条数_首次: first.items.length, 落盘条数_再重画3次后: second.items.length,
        字节_首次: bytes1, 字节_再重画3次后: raw2.length * 2,
        上限设置值: parseInt(HP.App.pref('cacheMaxItems', 50), 10)
      };
    });

    /* ③ 落盘节流：同一键连写 10 次 → 真落盘 ≤1 次（1s 窗口合并）；草稿 6 次按键 ≤1 次 */
    out['③_落盘节流'] = await page.evaluate(async () => {
      const T = HP.Talk;
      const role = { full_name: 'pipeline.tester', title: '测试者' };
      window.__r26Reset();
      for (let i = 0; i < 10; i++) { await T.paintChat(role); await new Promise((r) => setTimeout(r, 30)); }
      const threadPuts = window.__r26.byKey['HP_TALK_CACHE.thread.pipeline.tester'] || 0;
      HP.Cache.flush();
      const afterFlush = (window.__r26.byKey['HP_TALK_CACHE.thread.pipeline.tester'] || 0);
      window.__r26Reset();
      const inp = document.getElementById('tk-sayin');
      for (let i = 0; i < 6; i++) { inp.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 20)); }
      const draftPuts = window.__r26.byKey['HP_TALK_CACHE.draft.pipeline.tester'] || 0;
      HP.Cache.flush();
      return { 十次重画_真落盘: threadPuts, 收尾flush后: afterFlush, 敲六下_真落盘: draftPuts, 合并计数: HP.Cache.report().merged };
    });

    /* ④ 自动清理：造两个「7 天没用过」的键 + 清理后读数下降 */
    out['④_自动清理'] = await page.evaluate(async () => {
      HP.Cache.set('deliveries', { items: [{ a: 'x'.repeat(200) }] }, { now: true });
      HP.Cache.set('asks', { asks: [{ q: 'y'.repeat(200) }] }, { now: true });
      const m = HP.Cache._meta();
      m.deliveries.at = Math.floor(Date.now() / 1000) - 30 * 86400;      /* 30 天前用过 */
      m.asks.at = Math.floor(Date.now() / 1000) - 30 * 86400;
      HP.Cache._metaSave(m);
      const before = HP.Cache.report().total;
      const c = HP.Cache.cleanup({ days: 7, budgetBytes: 2 * 1024 * 1024 });
      const after = HP.Cache.report().total;
      return { 清掉的键数: c.removed, 释放字节: c.freed, 清理前合计: before, 清理后合计: after, 读数跟着降: after < before };
    });

    /* ⑤ 满了不静默：配额异常 → 一次可读提示 + 降级 + 不冒异常；设置兜底写也不抛 */
    out['⑤_满配额护栏'] = await page.evaluate(async () => {
      window.__r26Fail(true);
      let threw = '';
      try { HP.Cache.set('thread.pipeline.tester', { items: [{ id: 1 }] }, { now: true }); } catch (e) { threw = String(e && e.message); }
      const toast = document.getElementById('toast');
      const degraded = HP.Cache.degraded;
      const skippedBefore = HP.Cache.report().merged;
      const secondTry = HP.Cache.set('thread.pipeline.tester', { items: [{ id: 2 }] }, { now: true });   /* 降级后不该再撞墙 */
      let prefThrew = '';
      let prefRes = null;
      try { prefRes = HP.Cache.setPrefFallback('fontSize', '13'); } catch (e) { prefThrew = String(e && e.message); }
      window.__r26Fail(false);
      const rep = HP.Cache.report();
      return {
        写时抛了吗: threw || '（没抛）',
        出现提示: !!(toast && /存储满了/.test(toast.textContent || '')),
        提示原文: (toast && toast.textContent) || '',
        降级标记: degraded,
        降级后再写返回: secondTry,
        设置兜底抛了吗: prefThrew || '（没抛）',
        设置兜底返回: prefRes,
        报告里也标降级: rep.degraded
      };
    });

    /* ⑥ 省电不冲突：Cache 里没有定时器；节流窗口过后不留定时器；进设置页只算一次 */
    out['⑥_省电不冲突'] = await page.evaluate(async () => {
      const tickers = Object.keys(HP.Cache).filter((k) => /tick|interval|loop/i.test(k));
      await new Promise((r) => setTimeout(r, 1200));
      const timers = Object.keys(HP.Cache._timers || {}).length;
      const writes = HP.Cache._writes;
      await new Promise((r) => setTimeout(r, 800));
      return { 缓存里的定时器字段: tickers, 静置后挂着的节流定时器: timers, 静置期间自发落盘: HP.Cache._writes - writes };
    });

    /* ⑦ 不回归：设置读写仍生效 + 单聊/群聊仍渲染 */
    out['⑦_不回归'] = await page.evaluate(async () => {
      await HP.App.setPref('scrollback', '1000');
      const back = HP.App.pref('scrollback', '5000');
      const val = HP.Cache.getPrefFallback('scrollback');
      await HP.App.setPref('scrollback', '5000');
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 400));
      const stream = document.getElementById('tk-stream');
      return { 设置读回: back, 群聊容器在: !!stream };
    });

    await page.waitForTimeout(300);
    out['⑧_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
