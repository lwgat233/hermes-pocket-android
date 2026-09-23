/* R-26（自动本地存储优化）定位探针：用**平台真实回包**喂桥，量四件事：
 *   ① 现在 localStorage 里有什么、各多大；
 *   ② 「单聊页每 2.5s 重画一次」往 localStorage 写几次、多少字节（真调 HP.Talk.paintChat）；
 *   ③ 在真输入框里敲字（草稿）每次写多少字节；
 *   ④ 回滚缓冲占多少内存（真 xterm，喂 5000 行）；
 *   ⑤ 写满配额会怎样：配额多少、满了以后应用的写是静默丢还是抛错。
 * 只读不写：不改 talk.js、不改平台数据（桥只在页面里拦，跑完还原）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r26-storage.mjs
 * 真实回包夹具：evidence/R26-定位-20260923/fixtures/*.json（HP_FIXTURES 可换目录）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES
  || path.resolve(HERE, '../../../../evidence/R26-定位-20260923/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const FIX = {
  'talk.roles': read('roles-json.json'),
  'talk.sessions': read('sessions-json.json'),
  'talk.deliveries': read('deliveries.json'),
  'talk.thread': read('thread-pipeline.tester.json')
};

export default {
  name: 'R-26 定位：本地存了什么 / 多大 / 什么时候落盘 / 满了会怎样',

  check: async (page) => {
    const out = {};

    /* ① 现状清单 */
    out.现状 = await page.evaluate(() => {
      const enc = new TextEncoder();
      const rows = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        rows.push({ 键: k, 字节: enc.encode(localStorage.getItem(k) || '').length });
      }
      rows.sort((a, b) => b.字节 - a.字节);
      return {
        回滚缓冲_设置项默认: HP.App.pref('scrollback', '5000'),
        回滚缓冲_term生效值: HP.App.term.options.scrollback,
        当前localStorage项数: rows.length,
        合计字节: rows.reduce((n, r) => n + r.字节, 0),
        明细: rows
      };
    });

    /* ② 单聊页一次重画（每 2.5s 轮询会走到）写了多少 */
    out.单聊每2_5s一次重画 = await page.evaluate(async (FIX) => {
      const T = HP.Talk;
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const origSet = localStorage.setItem.bind(localStorage);
      const enc = new TextEncoder();
      let log = [];
      localStorage.setItem = (k, v) => { log.push({ 键: k, 字节: enc.encode(String(v)).length }); return origSet(k, v); };
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && FIX[m.t]) {
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: FIX[m.t] }) }), 5);
          return;
        }
        return origPost(t);
      };
      const sum = (a) => a.reduce((n, x) => n + x.字节, 0);
      const r = { full_name: 'pipeline.tester', title: '测试者' };
      /* 注：paintChat 末尾 talk.js:991 调的 this.pullRoleOutput 在这个文件里没有定义（那是已登记的 R-32），
         这里补个空壳只为让这条测量跑完；R-32 本身会让 2.5s 轮询那条路每次都抛，另有记录。 */
      const pullMissing = typeof T.pullRoleOutput !== 'function';
      T.pullRoleOutput = () => { };
      log = []; await T.openRole('pipeline.tester');      // 真路径：进单聊页（内部建 #tk-chat 并调 paintChat）
      await new Promise((res) => setTimeout(res, 400));
      const open = log.map((x) => x.键 + ':' + x.字节);
      let 缓存写抛错 = '';
      log = []; try { await T.paintChat(r); } catch (e) { 缓存写抛错 = String(e && e.message).slice(0, 60); } const one = log.slice();      // 之后每次重画
      log = []; try { await T.paintChat(r); } catch (e) { /* 同上 */ } const two = log.slice();
      log = []; await T.tick(); const poll = log.slice();           // 2.5s 轮询里那一句（talk.since）
      window.HermesPocket.postMessage = origPost; localStorage.setItem = origSet;
      return {
        pullRoleOutput本来缺定义: pullMissing,
        进单聊页_次数: open.length, 进单聊页_明细: open,
        再次重画1: { 次数: one.length, 字节: sum(one), 明细: one.map((x) => x.键 + ':' + x.字节) },
        再次重画2: { 次数: two.length, 字节: sum(two), 明细: two.map((x) => x.键 + ':' + x.字节) },
        轮询tick: { 次数: poll.length, 明细: poll.map((x) => x.键 + ':' + x.字节) }
      };
    }, FIX);

    /* ③ 草稿：真输入框里敲 6 个字 */
    out.草稿逐字写 = await page.evaluate(async (FIX) => {
      const T = HP.Talk;
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const origSet = localStorage.setItem.bind(localStorage);
      const enc = new TextEncoder();
      let log = [];
      localStorage.setItem = (k, v) => { log.push({ 键: k, 字节: enc.encode(String(v)).length }); return origSet(k, v); };
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 原样 */ }
        if (m && FIX[m.t]) {
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: FIX[m.t] }) }), 5);
          return;
        }
        return origPost(t);
      };
      const r = { full_name: 'pipeline.tester', title: '测试者' };
      await T.openRole('pipeline.tester');
      await new Promise((res) => setTimeout(res, 300));
      const inp = document.querySelector('[data-testid="talk-sayin"]');
      let res;
      if (!inp) {
        res = { 找到输入框: false };
      } else {
        log = [];
        for (let i = 1; i <= 6; i += 1) {
          inp.value = '试试'.repeat(i);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        res = { 找到输入框: true, 敲6次写入次数: log.length, 写入字节: log.reduce((n, x) => n + x.字节, 0), 明细: log };
      }
      window.HermesPocket.postMessage = origPost; localStorage.setItem = origSet;
      return res;
    }, FIX);

    /* ④ 回滚缓冲吃多少内存（真 xterm，喂 5000 行 × 78 列；用 CDP 读 V8 堆用量，前后相减） */
    const client = await page.context().newCDPSession(page);
    const heap = async () => (await client.send('Runtime.getHeapUsage')).usedSize;
    const heapBefore = await heap();
    const scrollInfo = await page.evaluate(async () => {
      const t = HP.App.term;
      const line = 'x'.repeat(78) + '\r\n';
      for (let i = 0; i < 5000; i += 1) t.write(line);
      return { 设置的行数上限: t.options.scrollback, 行列数: t.cols + '×' + t.rows };
    });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => globalThis.gc && globalThis.gc());
    const heapAfter = await heap();
    out.回滚缓冲 = {
      ...scrollInfo,
      缓冲里现在多少行: await page.evaluate(() => HP.App.term.buffer.active.length),
      堆字节_前: heapBefore,
      堆字节_后: heapAfter,
      堆差字节: heapAfter - heapBefore,
      每行约字节: Math.round((heapAfter - heapBefore) / 5000),
      折算MB: Number(((heapAfter - heapBefore) / 1048576).toFixed(2)),
      量法: 'CDP Runtime.getHeapUsage usedSize，喂前后各读一次（含渲染开销，属上界）'
    };

    /* ⑤ 写满配额：配额多少、满了以后应用的写是什么反应 */
    out.写满配额 = await page.evaluate(async (FIX) => {
      const enc = new TextEncoder();
      let quotaBytes = 0, err = '', idx = 0; const probeKey = '__r26_fill';
      /* 逐级缩小块长逼近上限：最后一级 64 字符，保证真写满（不然小写还能塞进去，测不出「满了」） */
      for (const sz of [262144, 16384, 1024, 64, 1]) {
        const c = 'a'.repeat(sz);
        let stop = false;
        const tries = sz === 1 ? 400 : 5000;
        let n = 0;
        while (!stop && idx < 5000 && n < tries) {
          n += 1;
          try { localStorage.setItem(probeKey + (idx += 1), c); quotaBytes += sz; }
          catch (e) { err = String(e && e.name) + ': ' + String(e && e.message).slice(0, 60); stop = true; }
        }
      }
      // 满的状态下：应用自己的缓存写（走真路径）
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 原样 */ }
        if (m && FIX[m.t]) {
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: FIX[m.t] }) }), 5);
          return;
        }
        return origPost(t);
      };
      let 缓存写抛错 = '';
      try { await HP.Talk.paintChat({ full_name: 'pipeline.tester', title: '测试者' }); }
      catch (e) { 缓存写抛错 = String(e && e.message).slice(0, 80); }
      // 偏好兜底那条路：rpc 失败时 setPref 会写 localStorage（app.js:167，没 try/catch）
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 原样 */ }
        if (m && m.t === 'pref.set') {
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'err', _rid: m._rid, msg: '模拟通道断' }) }), 5);
          return;
        }
        return origPost(t);
      };
      let 偏好兜底抛错 = '';
      try { await HP.App.setPref('scrollback', '20000'); }
      catch (e) { 偏好兜底抛错 = String(e && e.message).slice(0, 80); }
      let 原样写抛错 = '';
      try { localStorage.setItem('hp.__probe_r26', '1'); }
      catch (e) { 原样写抛错 = String(e && e.name); }
      const 兜底键写进去了 = localStorage.getItem('hp.scrollback');
      localStorage.removeItem('hp.__probe_r26');
      window.HermesPocket.postMessage = origPost;
      for (let i = 0; i < 80; i += 1) localStorage.removeItem(probeKey + i);
      return {
        配额约字节: quotaBytes,
        配额约MB: Number((quotaBytes / 1048576).toFixed(2)),
        写满时的异常: err,
        满时_原样setItem: 原样写抛错 || '（没抛）',
        满时_缓存写抛错: 缓存写抛错 || '（没抛，静默）',
        满时_偏好兜底抛错: 偏好兜底抛错 || '（没抛，静默）',
        满时_偏好兜底键落盘了吗: 兜底键写进去了,
        写的字节数单位: enc.encode('a').length
      };
    }, FIX);

    return out;
  }
};
