/* R-31 验收探针：发送状态的 8 条判据（界面侧）
 * 走**真按键 / 真 HP.Talk.send()**，在原生桥那一层按剧本回回执（形状同 Bridge.kt / talk.py），读页面上的真实文字。
 * 说明：pullRoleOutput 是既有缺陷 R-32（4 处调用 0 处定义），这里补空壳避开它，否则报错数会算在它头上。
 *      「耗时与 delivery.ms 差 ≤100ms」：界面用的是**回执里的 ms**（就是平台 delivery 台账那个数），
 *      本探针断言「界面显示值 == 回执 ms」；平台侧那半由 tester 在设备上用真台账比。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r31-sendstate.mjs
 */
export default {
  name: 'R-31 验收：发送中→已送达◯◯ms / 没送达:原因、3s 还在发、8s 超时与重试、迟到回执覆盖、广播逐条、省电档只留终态',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });

    const out = {};
    const readRows = () => page.evaluate(() => {
      const box = document.getElementById('tk-sends');
      if (!box) return { 有状态区: false, 条数: 0, 最末一条: '', 最末一条状态: null, 有重试: false, 逐条结果数: 0 };
      const rows = [...box.querySelectorAll('[data-testid="talk-sendrow"]')];
      const last = rows[rows.length - 1];
      return {
        有状态区: true,
        条数: rows.length,
        最末一条: last ? last.innerText.replace(/\s+/g, ' ').trim() : '',
        最末一条状态: last ? last.getAttribute('data-state') : null,
        有重试: last ? !!last.querySelector('[data-testid="talk-retry"]') : false,
        逐条结果数: last ? last.querySelectorAll('.tk-sendsub').length : 0
      };
    });

    await page.evaluate(() => {
      const T = HP.Talk;
      T.pullRoleOutput = () => { };                       /* R-32 既有缺陷：单独登记，这里避开 */
      T.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline', online: true }];
      T.live = true;
      window.__r31 = { mode: 'reply', payload: null, say: 0 };
      window.__r31Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null;
        try { m = JSON.parse(t); } catch (e) { }
        if (!m || (m.t !== 'talk.say' && m.t !== 'talk.shout')) return window.__r31Orig(t);
        window.__r31.say++;
        if (window.__r31.mode === 'silent') return;     /* 装死：不回执 */
        const data = window.__r31.payload || {};
        const delay = data.__delay != null ? data.__delay : 30;
        setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: data }) }), delay);
      };
    });

    /* ① 点「发送」（真按键）→ 2s 内出现终态「已送达 ◯◯ms」 */
    await page.evaluate(async () => {
      window.__r31.mode = 'reply';
      window.__r31.payload = { to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1370 } };
      await HP.Talk.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 400));
      const inp = document.getElementById('tk-sayin');
      inp.value = '探针：一句测试';                       /* 先填字（真人也是先打字再点） */
      inp.dispatchEvent(new Event('input'));
      document.getElementById('tk-sayok').click();       /* 真按键 */
    });
    await page.waitForTimeout(400);
    out['①_点发送_已送达'] = await readRows();

    /* ② 桥回 delivered:false → 显示「没送达：<原因>」并保留这条 + 重试 */
    await page.evaluate(async () => {
      window.__r31.mode = 'reply';
      window.__r31.payload = { to: 'pipeline.tester', kind: 'private', delivered: false, raw: { delivered: false, error: '阶段没放行' } };
      await HP.Talk.send('pipeline.tester', 'private', '探针：注定失败的一条');
      await new Promise((r) => setTimeout(r, 300));
    });
    out['②_没投成'] = await readRows();

    /* ③ 桥不回执：3s 内出现「还在发…」+ 重试入口 */
    await page.evaluate(() => { window.__r31.mode = 'silent'; HP.Talk.send('pipeline.tester', 'private', '探针：桥装死'); });
    await page.waitForTimeout(3300);
    out['③_桥不回执_3s'] = await readRows();

    /* ④ 到 8s → 「没送达：超时」；重试能真重发；超时后新消息也不再被吞 */
    await page.waitForTimeout(5200);
    out['④a_8s超时'] = await readRows();
    out['④b_重试与后续发送'] = await page.evaluate(async () => {
      window.__r31.mode = 'reply';
      window.__r31.payload = { to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1410 } };
      const box = document.getElementById('tk-sends');
      let rows = [...box.querySelectorAll('[data-testid="talk-sendrow"]')];
      const timed = rows[rows.length - 1];
      const saidBefore = window.__r31.say;
      timed.querySelector('[data-testid="talk-retry"]').click();            /* 真点重试 */
      await new Promise((r) => setTimeout(r, 500));
      const retryHandled = window.__r31.say > saidBefore;
      const retryRow = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      const afterRetry = { 状态: retryRow.getAttribute('data-state'), 文字: retryRow.innerText.replace(/\s+/g, ' ').trim(), 真重发: retryHandled };
      /* 超时那条还卡着 rpc（20s 才回），这时再发一条新消息：不该被吞 */
      const before = window.__r31.say;
      await HP.Talk.send('pipeline.tester', 'private', '探针：超时之后还能发');
      await new Promise((r) => setTimeout(r, 400));
      const newest = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      return { 重试后: afterRetry, 后续新消息发出去了: window.__r31.say > before, 后续状态: newest.getAttribute('data-state'), 后续文字: newest.innerText.replace(/\s+/g, ' ').trim() };
    });

    /* ⑤ 迟到的回执要能覆盖「超时」终态（9s 才回执） */
    out['⑤_迟到回执覆盖'] = await page.evaluate(async () => {
      window.__r31.mode = 'reply';
      window.__r31.payload = { __delay: 9000, to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1370 } };
      const p = HP.Talk.send('pipeline.tester', 'private', '探针：迟到 9s 的回执');
      await new Promise((r) => setTimeout(r, 4000));
      const box = document.getElementById('tk-sends');
      const mid = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      const at4s = { 状态: mid.getAttribute('data-state'), 文字: mid.innerText.replace(/\s+/g, ' ').trim() };
      await p;                                            /* 等回执到（9s） */
      await new Promise((r) => setTimeout(r, 300));
      const late = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      return { 四秒时: at4s, 回执到达后: { 状态: late.getAttribute('data-state'), 文字: late.innerText.replace(/\s+/g, ' ').trim() } };
    });

    /* ⑥ 耗时读数 = 回执里的 ms */
    out['⑥_耗时对齐'] = await page.evaluate(async () => {
      window.__r31.mode = 'reply';
      window.__r31.payload = { to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1420 } };
      await HP.Talk.send('pipeline.tester', 'private', '探针：对齐耗时');
      await new Promise((r) => setTimeout(r, 350));
      const box = document.getElementById('tk-sends');
      const last = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      const t = last.innerText.replace(/\s+/g, ' ').trim();
      const m = /(\d+)ms/.exec(t);
      return { 界面毫秒: m ? Number(m[1]) : null, 回执ms: 1420, 差: m ? Math.abs(Number(m[1]) - 1420) : null, 文字: t };
    });

    /* ⑦ 广播 3 个角色：逐条结果 + 汇总 */
    out['⑦_广播逐条'] = await page.evaluate(async () => {
      window.__r31.mode = 'reply';
      window.__r31.payload = {
        count: 3,
        results: [
          { role: 'pipeline.author', delivered: true, ms: 1410 },
          { role: 'pipeline.tester', delivered: true, ms: 1380 },
          { role: 'pipeline.renderer', delivered: false, error: '没会话' }
        ]
      };
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 400));
      const inp = document.getElementById('tk-shoutin');
      inp.value = '探针：广播一条';
      document.getElementById('tk-shoutok').click();       /* 真按键 */
      await new Promise((r) => setTimeout(r, 500));
      const box = document.getElementById('tk-sends');
      const last = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      return {
        状态: last.getAttribute('data-state'),
        文字: last.innerText.replace(/\s+/g, ' ').trim(),
        逐条结果数: last.querySelectorAll('.tk-sendsub').length,
        含2比3: /2\/3/.test(last.innerText),
        含没会话: /没会话/.test(last.innerText)
      };
    });

    /* ⑧ 省电档：sendTiming 关掉 → 仍给终态，不显示毫秒（也不做每秒刷新） */
    out['⑧_省电档'] = await page.evaluate(async () => {
      await HP.App.setPref('sendTiming', false);
      const off = HP.Talk.timing();
      window.__r31.mode = 'reply';
      window.__r31.payload = { to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1440 } };
      await HP.Talk.send('pipeline.tester', 'private', '探针：省电档');
      await new Promise((r) => setTimeout(r, 350));
      const box = document.getElementById('tk-sends');
      const last = [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop();
      const t = last.innerText.replace(/\s+/g, ' ').trim();
      await HP.App.setPref('sendTiming', true);
      return { 读数开关: off, 仍显示终态: /已送达/.test(t), 还带毫秒: /\d+ms/.test(t), 文字: t };
    });

    await page.waitForTimeout(300);
    out['⑨_不回归_报错'] = { 报错条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
