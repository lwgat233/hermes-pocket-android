/* R-28（聊天历史优化）定位探针：喂**平台真实回包**（evidence/R28-定位-20260923/batch0.json 200 条
 * + batch1.json 74 条），量：首屏拉多少、内存多少、能翻到多旧、几轮才追到最新、有没有搜索/清空入口。
 * 只读不写：不改 talk.js、不改平台数据。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r28-history.mjs
 * 夹具目录可用 HP_FIXTURES 覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R28-定位-20260923');
const B0 = JSON.parse(fs.readFileSync(path.join(FX, 'batch0.json'), 'utf8'));
const B1 = JSON.parse(fs.readFileSync(path.join(FX, 'batch1.json'), 'utf8'));

export default {
  name: 'R-28 定位：首屏拉多少 / 内存 / 能翻多旧 / 追到最新几轮 / 有无搜索清空',

  check: async (page) => {
    const out = {};
    out.夹具 = {
      batch0: { 条数: B0.messages.length, 首id: B0.messages[0].id, 末id: B0.messages[B0.messages.length - 1].id, last: B0.last },
      batch1: { 条数: B1.messages.length, 首id: B1.messages[0].id, 末id: B1.messages[B1.messages.length - 1].id, last: B1.last }
    };

    /* 桥：talk.since 按 id 回真夹具（id=0 → batch0；id=927 → batch1；其余 → 空） */
    await page.evaluate(({ B0, B1 }) => {
      window.__sinceCalls = [];
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 原样 */ }
        if (m && m.t === 'talk.since') {
          window.__sinceCalls.push(m.id);
          const data = (m.id === 0) ? B0 : (m.id === 927 ? B1 : { last: m.id, messages: [] });
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data }) }), 5);
          return;
        }
        return origPost(t);
      };
      window.__origPost = origPost;
    }, { B0, B1 });

    /* ① 首屏（进频道页）：拉几轮、拿到多少条、追到最新要几轮 */
    out.首屏与追平 = await page.evaluate(async () => {
      const T = HP.Talk;
      T.msgs = []; T.last = 0;
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 600));      // 首屏 render 走完
      const afterFirst = { 条数: T.msgs.length, last: T.last, 首id: T.msgs[0] && T.msgs[0].id, 末id: T.msgs[T.msgs.length - 1] && T.msgs[T.msgs.length - 1].id };
      let rounds = 0;
      while (T.last < 1031 && rounds < 12) { await T.tick(); rounds += 1; }
      return {
        首屏: afterFirst,
        首屏后还要几轮tick才追到最新: rounds,
        追平后: { 条数: T.msgs.length, last: T.last, 末id: T.msgs[T.msgs.length - 1] && T.msgs[T.msgs.length - 1].id },
        每次since请求的id: window.__sinceCalls.slice(),
        每轮最多条数: 200
      };
    });

    /* ② 渲染层能翻到多旧（只画最后 80 条）：DOM 节点数、滚到顶后的第一条 */
    out.能翻多旧 = await page.evaluate(() => {
      const T = HP.Talk;
      HP.App.showBoard('group');
      const s = document.getElementById('tk-stream');
      s.scrollTop = 0;
      const kids = [...s.children];
      return {
        内存里有几条: T.msgs.length,
        DOM里几条: kids.length,
        内存里最老id: T.msgs[0] && T.msgs[0].id,
        DOM里最老id: kids[0] && kids[0].getAttribute('data-tk-id'),
        DOM里最新id: kids[kids.length - 1] && kids[kids.length - 1].getAttribute('data-tk-id'),
        滚到顶还能看到更老的吗: (kids[0] && kids[0].getAttribute('data-tk-id')) === String(T.msgs[0] && T.msgs[0].id),
        有没有翻旧入口: !!document.querySelector('#tab-group [data-testid="talk-more"], #tab-talk [data-testid="talk-more"]')
      };
    });

    /* ③ 有没有搜索 / 清空入口 */
    out.搜索与清空 = await page.evaluate(() => {
      const txt = (el) => (el && el.textContent || '').trim();
      const all = [...document.querySelectorAll('#tab-talk *, #tab-group *')];
      return {
        搜索类控件: all.filter((e) => e.tagName === 'INPUT' && /search/i.test(e.type || '')).length,
        '带搜字的控件': all.filter((e) => /搜/.test(txt(e)) && ['BUTTON', 'INPUT'].includes(e.tagName)).map(txt),
        '带清空删除清除字的控件': all.filter((e) => /清空|删除|清除/.test(txt(e)) && ['BUTTON', 'INPUT'].includes(e.tagName)).map(txt),
        全部按钮文案: all.filter((e) => e.tagName === 'BUTTON').map(txt).filter(Boolean).slice(0, 20)
      };
    });

    /* ④ 内存：再用 CDP 读堆，喂 274 条前后相减 */
    const client = await page.context().newCDPSession(page);
    const heap = async () => (await client.send('Runtime.getHeapUsage')).usedSize;
    const before = await heap();
    const kept = await page.evaluate(({ B0, B1 }) => {
      HP.Talk.msgs = B0.messages.concat(B1.messages);
      return HP.Talk.msgs.length;
    }, { B0, B1 });
    await new Promise((r) => setTimeout(r, 400));
    const after = await heap();
    out.内存 = {
      条数: kept,
      堆字节_前: before,
      堆字节_后: after,
      堆差字节: after - before,
      每条约字节: Math.round((after - before) / kept),
      折算KB: Number(((after - before) / 1024).toFixed(1))
    };

    await page.evaluate(() => { window.HermesPocket.postMessage = window.__origPost; });
    return out;
  }
};
