/* R-36 定位探针：验证「不接主机时广播也显示『已送达 ≈29ms』」是不是**假成功**。
 * 做法：在页面里按情况替换桥的回包（模拟真实 Bridge.kt 的各种返回），走真路径 HP.Talk.send()，
 *       读 DOM 里那条发送状态（[data-testid="talk-sendrow"]）的真实文案。
 * 只读不写：不改工程文件、不碰平台。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r36-fake-sent.mjs
 * 夹具：evidence/R34-定位-20260924/fixtures/roles-json.json（角色名用）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROLES = JSON.parse(fs.readFileSync(
  process.env.HP_FIXTURES
    ? path.join(process.env.HP_FIXTURES, 'roles-json.json')
    : path.resolve(HERE, '../../../../evidence/R34-定位-20260924/fixtures/roles-json.json'), 'utf8'));

export default {
  name: 'R-36 定位：不接主机时「已送达」是真是假（逐条走真 send() 状态机）',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    /* 装一个可编程的桥：默认放通；每个用例前设好该 op 的回包 */
    await page.evaluate((ROLES) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      const errReply = (rid, error) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'err', _rid: rid, msg: error }) });   /* 真错误封包：transport.js:127-132 */
      window.__case = { op: null, mode: 'ok', data: null };
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        const c = window.__case;
        if (m && c.op && m.t === c.op) {
          if (c.mode === 'ok') { setTimeout(() => reply(m._rid, c.data || {}), 3); return; }
          if (c.mode === 'err') { setTimeout(() => errReply(m._rid, '还没连接'), 3); return; }
          if (c.mode === 'silent') { return; }                    /* 桥不回：验 3s/8s 分支 */
        }
        return orig(t);
      };
    }, ROLES);

    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); HP.Talk.render(); });
    await page.waitForTimeout(700);

    /* 跑一个发送用例，返回那条状态行的真实文案 */
    const run = async (label, op, mode, data, target, kind) => {
      const r = await page.evaluate(async ({ op, mode, data, target, kind }) => {
        window.__case = { op, mode, data };
        HP.Talk.sends = [];                       /* 每条用例从干净状态起 */
        HP.Talk.sendSeq = 0;
        const p = HP.Talk.send(target, kind, '探针：' + op + '/' + mode);
        await Promise.race([p, new Promise((r2) => setTimeout(r2, 1200))]);
        await new Promise((r2) => setTimeout(r2, 600));      /* 等 render/tick 落定再读 DOM */
        const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')];
        const last = rows[rows.length - 1];
        const s0 = HP.Talk.sends[HP.Talk.sends.length - 1];
        return {
          行: last ? last.innerText.replace(/\n+/g, ' ').trim() : null,
          状态: last ? last.getAttribute('data-state') : null,
          类: last ? last.className : null,
          内存态: s0 ? { state: s0.state, ms: s0.ms, msApprox: s0.msApprox, note: s0.note, parts: s0.parts } : null,
          状态文案: s0 ? HP.Talk.sendStateText(s0) : null
        };
      }, { op, mode, data, target, kind });
      out[label] = r;
      return r;
    };

    /* 用例 1（复现 tester 的观察）：广播 + 不接主机 —— 真 Bridge 的返回是 {broadcast:true, raw:{}}（异常被 runCatching 吞掉） */
    await run('① 广播_不接主机(桥吞异常回空raw)', 'talk.shout', 'ok', { broadcast: true, raw: {} }, '全体', 'broadcast');

    /* 用例 2：广播 + 连着主机（真回包形状：raw.results 逐角色） */
    await run('② 广播_连着主机(真回包_results)', 'talk.shout', 'ok', {
      broadcast: true,
      raw: { id: 9999, broadcast: true, count: 2, results: [{ role: 'home.maid', delivered: true, ms: 1491 }, { role: 'pipeline.author', delivered: false, error: 'tmux 没在跑' }] }
    }, '全体', 'broadcast');

    /* 用例 3：单聊 + 不接主机（Bridge 填 delivered=false） */
    await run('③ 单聊_不接主机(桥delivered=false)', 'talk.say', 'ok', { to: 'pipeline.author', kind: 'private', delivered: false, raw: {} }, 'pipeline.author', 'private');

    /* 用例 4：单聊 + 桥回包缺 delivered 字段（App 的乐观默认） */
    await run('④ 单聊_回包缺delivered', 'talk.say', 'ok', { to: 'pipeline.author', kind: 'private' }, 'pipeline.author', 'private');

    /* 用例 5：单聊 + 桥 delivered=true 但平台 raw 明说 delivered=false（Bridge 的语义错） */
    await run('⑤ 单聊_平台raw说没投成但桥说成功', 'talk.say', 'ok', {
      to: 'pipeline.author', kind: 'private', delivered: true,
      raw: { id: 9998, delivered: false, error: '库按角色过滤：看不到这个会话', to: 'pipeline.author' }
    }, 'pipeline.author', 'private');

    /* 用例 6：桥直接报错（rpc 层 err） */
    await run('⑥ 单聊_桥报错', 'talk.say', 'err', null, 'pipeline.author', 'private');

    /* 用例 7：桥不回 —— 3s 应转「还在发…」，8s 应转「没送达：超时」 */
    await page.evaluate(() => {
      window.__case = { op: 'talk.shout', mode: 'silent', data: null };
      HP.Talk.sends = []; HP.Talk.sendSeq = 0;
      HP.Talk.send('全体', 'broadcast', '探针：桥不回');
    });
    await page.waitForTimeout(3400);
    out['⑦a 桥不回_3s后'] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')];
      const last = rows[rows.length - 1];
      return last ? { 行: last.innerText.replace(/\n+/g, ' ').trim(), 状态: last.getAttribute('data-state') } : null;
    });
    await page.waitForTimeout(5200);
    out['⑦b 桥不回_8s后'] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')];
      const last = rows[rows.length - 1];
      return last ? { 行: last.innerText.replace(/\n+/g, ' ').trim(), 状态: last.getAttribute('data-state') } : null;
    });

    out.判定依据 = {
      'talk.js:1181': 'const ok = (bridged === null) ? true : !!bridged;  ← 回执缺 delivered 就当成功',
      'talk.js:1183': 's.ms = (ms != null) ? ms : Math.round(performance.now() - s.t0); ← 没给耗时就用界面往返毫秒',
      'talk.js:1184': "s.msApprox = (ms == null);  ← 于是显示成「已送达 ≈Nms」",
      'Bridge.kt:748-752': 'talk.shout：runCatching 吞异常后**无条件 ok**，只填 {broadcast:true, raw:{}} —— 从不填 delivered',
      'Bridge.kt:763-764': 'talk.say：delivered = r.isSuccess（命令有没有抛错），**不是平台回报的投递结果**'
    };
    return out;
  }
};
