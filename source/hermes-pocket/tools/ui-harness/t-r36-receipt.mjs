/* R-36 验收探针：送达口径（A 第三态「已发出（未确认）」；B/C 的桥回执形状在界面侧的表现）
 * 桥是 Kotlin，本地台跑不了原生的那半 —— 这里按 Bridge.kt 改动后**该回的形状**喂回执：
 *   · talk.say 成功但平台 raw 里没 delivered  → {to,kind,delivered:null,raw:{}}
 *   · talk.say 失败（以前被吞的「还没连接」）  → {to,kind,ok:false,delivered:false,error:'还没连接',raw:{}}
 *   · talk.shout 失败                        → {broadcast:true,ok:false,delivered:false,error:'还没连接',raw:{}}
 *   · talk.shout 成功带 results（D：那支不动） → {broadcast:true,delivered:true,raw:{results:[…]}}
 * 真机（Kotlin 那半 + 不接主机的负向用例）由 tester 第 3 步做。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r36-receipt.mjs
 */
export default {
  name: 'R-36 验收：没 delivered 不算成功（已发出（未确认））、失败带原因、广播 results 分支不动',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      HP.Talk.pullRoleOutput = () => { };
      HP.Talk.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline', online: true }];
      HP.Talk.live = true;
      window.__r36 = { op: 'talk.say', data: {} };
      window.__r36Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (!m || m.t !== window.__r36.op) return window.__r36Orig(t);
        const data = window.__r36.data;
        setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: data }) }), 20);
      };
    });

    const lastRow = () => page.evaluate(() => {
      const box = document.getElementById('tk-sends');
      if (!box) return { 有状态区: false };
      const rows = [...box.querySelectorAll('[data-testid="talk-sendrow"]')];
      const last = rows[rows.length - 1];
      return {
        有状态区: true,
        文字: last ? last.innerText.replace(/\s+/g, ' ').trim() : '',
        状态: last ? last.getAttribute('data-state') : null,
        类: last ? last.className : null,
        有毫秒: last ? /\d+ms/.test(last.innerText) : null,
        有重试: last ? !!last.querySelector('[data-testid="talk-retry"]') : false
      };
    });

    /* ① C：成功但平台 raw 没有 delivered → 已发出（未确认）、不写毫秒、不是绿的、不给重试 */
    out['①_没delivered'] = await page.evaluate(async () => {
      window.__r36.op = 'talk.say';
      window.__r36.data = { to: 'pipeline.tester', kind: 'private', delivered: null, raw: {} };
      await HP.Talk.send('pipeline.tester', 'private', '探针：平台没说投成');
      await new Promise((r) => setTimeout(r, 350));
      return null;
    }).then(lastRow);

    /* ② 平台说投成了（raw.delivered=true）→ 照旧「已送达 ◯◯ms」 */
    out['②_平台说投成'] = await page.evaluate(async () => {
      window.__r36.data = { to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1370 } };
      await HP.Talk.send('pipeline.tester', 'private', '探针：平台说投成了');
      await new Promise((r) => setTimeout(r, 350));
      return null;
    }).then(lastRow);

    /* ③ 失败：桥带原因（B/C 的新形状）→ 没送达：还没连接 */
    out['③_失败带原因'] = await page.evaluate(async () => {
      window.__r36.data = { to: 'pipeline.tester', kind: 'private', ok: false, delivered: false, error: '还没连接', raw: {} };
      await HP.Talk.send('pipeline.tester', 'private', '探针：没连主机');
      await new Promise((r) => setTimeout(r, 350));
      return null;
    }).then(lastRow);

    /* ④ B：广播失败（以前被吞的那条）→ 界面必须看到「没送达：还没连接」 */
    out['④_广播失败'] = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 350));
      window.__r36.op = 'talk.shout';
      window.__r36.data = { broadcast: true, ok: false, delivered: false, error: '还没连接', raw: {} };
      await HP.Talk.send('全体', 'broadcast', '探针：不接主机广播');
      await new Promise((r) => setTimeout(r, 350));
      return null;
    }).then(lastRow);

    /* ⑤ D：广播成功带 results → 逐条结果（那支没动） */
    out['⑤_广播results'] = await page.evaluate(async () => {
      window.__r36.data = {
        broadcast: true, delivered: true,
        raw: { results: [{ role: 'pipeline.author', delivered: true, ms: 1400 }, { role: 'pipeline.renderer', delivered: false, error: '没会话' }] }
      };
      await HP.Talk.send('全体', 'broadcast', '探针：接上主机广播');
      await new Promise((r) => setTimeout(r, 350));
      const box = document.getElementById('tk-sends');
      const last = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      return {
        文字: last.innerText.replace(/\s+/g, ' ').trim(),
        状态: last.getAttribute('data-state'),
        逐条数: last.querySelectorAll('.tk-sendsub').length
      };
    });

    /* ⑥ 兜底：桥整条不给 delivered 字段（旧桥的形状）也不能算成功 */
    out['⑥_旧桥形状'] = await page.evaluate(async () => {
      window.__r36.op = 'talk.say';
      window.__r36.data = { to: 'pipeline.tester', kind: 'private', raw: { id: 42 } };
      await HP.Talk.send('pipeline.tester', 'private', '探针：旧桥形状');
      await new Promise((r) => setTimeout(r, 350));
      const box = document.getElementById('tk-sends');
      const last = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      return {
        文字: last.innerText.replace(/\s+/g, ' ').trim(),
        状态: last.getAttribute('data-state'),
        没被当成已送达: !/已送达/.test(last.innerText)
      };
    });

    await page.waitForTimeout(200);
    out['⑦_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
