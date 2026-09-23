/* R-30（聊天消息客户端本地化）定位探针：量「消息在客户端到底留不留、断了网还能看到什么」。
 * 真路径：openRole → paintChat（会写 HP_TALK_CACHE.thread.<角色>）；然后**模拟断网 + 重启页面**
 * （init script 把所有 talk.* 调用变成 err），看单聊/群聊两页各还能看到什么。
 * 只读不写：不改工程代码；清 localStorage 只为让基线干净（跑完把探测键删掉）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r30-offline.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R30-定位-20260923');
const THREAD = JSON.parse(fs.readFileSync(path.join(FX, 'thread-pipeline.tester.json'), 'utf8'));   // 真单聊记录（{items:[…]}）

export default {
  name: 'R-30 定位：消息留不留本地 / 断网重启后还能看到什么',

  check: async (page) => {
    const out = {};

    /* ① 基线：本地有没有消息类数据 */
    out.基线 = await page.evaluate(() => {
      const rows = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        rows.push({ 键: k, 字节: (localStorage.getItem(k) || '').length * 2 });
      }
      return { 项数: rows.length, 明细: rows };
    });

    /* ② 走真路径打开单聊（喂真夹具当记录）→ 看它往本地写了什么 */
    await page.evaluate(({ THREAD }) => {
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 原样 */ }
        if (m && m.t === 'talk.thread') {
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: THREAD }) }), 5);
          return;
        }
        return origPost(t);
      };
      window.__origPost = origPost;
    }, { THREAD });
    out.打开单聊后 = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 300));
      await HP.Talk.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 900));
      try { HP.Cache.flush(); } catch (e) { /* 老的实现没有这个入口 */ }
      await new Promise((r) => setTimeout(r, 200));
      const rows = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k.indexOf('HP_TALK_CACHE') === 0) rows.push({ 键: k, 字节: (localStorage.getItem(k) || '').length * 2 });
      }
      const box = document.getElementById('tk-chat');
      return {
        单聊气泡数: box ? box.children.length : 0,
        消息类本地键: rows,
        消息类合计字节: rows.reduce((n, r) => n + r.字节, 0),
        单聊消息落盘了: rows.some((r) => r.键.indexOf('thread.') >= 0),
        有没有频道消息的键: rows.some((r) => /stream|channel|msgs/.test(r.键))
      };
    });

    /* ③ 模拟断网 + 重启页面（init script 把 talk.* 全变 err） */
    await page.addInitScript(() => {
      const wrap = () => {
        if (!window.HermesPocket || window.__offlineWrapped) return;
        window.__offlineWrapped = true;
        const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
        window.HermesPocket.postMessage = (t) => {
          let m = null; try { m = JSON.parse(t); } catch (e) { /* 原样 */ }
          if (m && /^talk\./.test(m.t || '')) {
            const reply = JSON.stringify({ t: 'err', _rid: m._rid, msg: '探针：模拟断网' });
            setTimeout(() => window.HermesPocket.onmessage({ data: reply }), 5);
            return;
          }
          return orig(t);
        };
      };
      wrap();
      const iv = setInterval(wrap, 50);
      setTimeout(() => clearInterval(iv), 3000);
      window.__probeOffline = true;
    });
    await page.reload();
    await page.waitForFunction(() => window.HP && HP.App && HP.App.term, null, { timeout: 20000 });
    await page.waitForTimeout(800);
    out.断网重启只开单聊 = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 300));
      await HP.Talk.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 600));
      const box = document.getElementById('tk-chat');
      const txt = box ? (box.textContent || '') : '';
      return {
        断网标记: !!window.__probeOffline,
        单聊气泡数: box ? box.children.length : 0,
        首条文本: txt.slice(0, 40),
        显示的是缓存吗: /^(?!.*（还没聊过）).+/.test(txt) && (box ? box.children.length > 0 : false),
        '读到的字里有没有连不上或读不到': /连不上|读不到|失败/.test(txt)
      };
    });
    out.断网重启只开群聊 = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 500));
      const s = document.getElementById('tk-stream');
      return {
        群聊气泡数: s ? s.children.length : 0,
        群聊文本: (s ? s.textContent : '').slice(0, 60),
        内存里还有消息吗: (HP.Talk.msgs || []).length
      };
    });
    out.断网重启后本地还在吗 = await page.evaluate(() => {
      const rows = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k.indexOf('HP_TALK_CACHE') === 0) rows.push({ 键: k, 字节: (localStorage.getItem(k) || '').length * 2 });
      }
      return { 项数: rows.length, 明细: rows };
    });

    return out;
  }
};
