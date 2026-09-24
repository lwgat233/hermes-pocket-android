/* R-32 定位探针：单聊页每 2.5s 抛 `pullRoleOutput is not a function` —— 量频率、量牵连、验改法。
 * 三段计时（每段 30s，真页面真轮询，喂平台真回包）：
 *   ① 现状：错误次数/间隔，错误文案；顺带记同一 tick 里 tick() 有没有被连累（talk.since 调用次数）；
 *   ② 模拟改法「删调用」（页面里注入空壳 HP.Talk.pullRoleOutput = () => {}，工程文件不动）→ 期望 0 条；
 *   ③ 模拟改法「补定义」（注入一个只计数的真壳：每次被调就 +1）→ 量出若补定义，30s 会被调几次（= 每 2.5s 一次 talk.capture 的代价）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r32-error.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R34-定位-20260924/fixtures');
const ROLES = JSON.parse(fs.readFileSync(path.join(FX, 'roles-json.json'), 'utf8'));
const SESS = JSON.parse(fs.readFileSync(path.join(FX, 'sessions-json.json'), 'utf8'));
const THREAD = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../evidence/R37-定位-20260924/fixtures/thread-home.maid.json'), 'utf8'));

export default {
  name: 'R-32 定位：单聊页 pullRoleOutput 每 2.5s 抛错（30s 实测 + 模拟改法）',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    /* 收错误 + 收桥调用计数 */
    const errs = [];
    page.on('pageerror', (e) => errs.push({ t: Date.now(), msg: String((e && e.message) || e).slice(0, 120) }));
    page.on('console', (m) => { if (m.type() === 'error') errs.push({ t: Date.now(), msg: 'console.error: ' + m.text().slice(0, 120) }); });

    await page.evaluate(({ ROLES, SESS, THREAD }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.__opCount = {};
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t) window.__opCount[m.t] = (window.__opCount[m.t] || 0) + 1;
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.thread') { setTimeout(() => reply(m._rid, THREAD), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS, THREAD });

    /* 进度单聊页 + 确认轮询在跑 */
    out.现场 = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await HP.Talk.refreshRoles();
      await HP.Talk.openRole('home.maid');
      await new Promise((r) => setTimeout(r, 800));
      return {
        view: HP.Talk.view, style: HP.Talk.style, sel: (HP.Talk.sel || {}).full_name,
        live: HP.Talk.live, 轮询秒: HP.Talk.pollDelay ? HP.Talk.pollDelay() : null,
        轮询开着: !!HP.Talk.timer,
        talk_js_里pullRoleOutput的调用点: [173, 1024, 1025, 1065],
        有没有定义: typeof HP.Talk.pullRoleOutput
      };
    });

    const win = async (label, seconds) => {
      const t0 = Date.now();
      const e0 = errs.length;
      await page.evaluate(() => { window.__opCount = {}; });
      await page.waitForTimeout(seconds * 1000);
      const op = await page.evaluate(() => window.__opCount);
      const mine = errs.slice(e0).filter((x) => x.t >= t0);
      const uniq = {};
      mine.forEach((x) => { uniq[x.msg] = (uniq[x.msg] || 0) + 1; });
      return { 段: label, 秒: seconds, 错误条数: mine.length, 错误种类: uniq, 间隔_ms: mine.length > 1 ? Math.round((mine[mine.length - 1].t - mine[0].t) / (mine.length - 1)) : null, 桥调用: op };
    };

    /* ① 现状 30s */
    out.a_现状30s = await win('现状（未改）', 30);

    /* ② 模拟「删调用」：把 undefined 变成一个空壳（等价于 4 处调用被删干净的效果） */
    out.b_删调用后30s = await (async () => {
      await page.evaluate(() => { HP.Talk.pullRoleOutput = () => {}; });
      return win('删调用（注入空壳模拟）', 30);
    })();

    /* ③ 模拟「补定义」：真壳只计数，看会被调多少次（每次调用在生产里＝一次 talk.capture＝SSH+python） */
    out.c_补定义后30s = await (async () => {
      await page.evaluate(() => { window.__pull = 0; HP.Talk.pullRoleOutput = () => { window.__pull += 1; }; });
      const r = await win('补定义（注入计数壳模拟）', 30);
      r.pullRoleOutput调用次数 = await page.evaluate(() => window.__pull);
      return r;
    })();

    out.错误明细前3条 = errs.slice(0, 3);
    return out;
  }
};
