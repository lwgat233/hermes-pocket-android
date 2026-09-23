/* R-31 复测 · 设备真触摸/真计时驱动（8 条判据）
 * 打桩的只有**传输层**（HP.App.rpc）——发送状态机、计时器、DOM 渲染、重试按钮全是产品自己的代码在真设备上跑。
 * 每个场景：设桩 → 调产品自己的 HP.Talk.send()（界面按钮点下去走的同一条路）→ 轮询 DOM 读数。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r31-reprobe-20260923.mjs
 */
export default {
  name: 'R31-复测-发送反馈',
  check: async (page) => {
    const out = {};

    out.stub = await page.evaluate(() => {
      window.__ms = 1411;               /* ⑥ 用平台台账真值：talk.py deliveries 最新一条 ms=1411（msg 985 → pipeline.author） */
      window.__mode = 'ok';
      window.__late = null;
      HP.App.rpc = async (op) => {
        if (op === 'talk.say' || op === 'talk.shout') {
          const m = window.__mode;
          if (m === 'ok') return { delivered: true, ms: window.__ms };
          if (m === 'okNoMs') return { delivered: true };
          if (m === 'fail') return { delivered: false, error: '阶段没放行，不投递：pipeline.author（他名下全部阶段都还没放行）' };
          if (m === 'hang') return new Promise((res) => { window.__late = res; });
          if (m === 'broadcast') return { raw: { results: [ { role: 'pipeline.author', delivered: true, ms: 120 }, { role: 'home.maid', delivered: false, error: '已暂停（role），不投递' } ] } };
        }
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.roles') return { roles: [] };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      HP.App.showBoard('group');
      return { ok: true, timing: HP.Talk.timing() };
    });

    /* 通用：发起一条发送（n 用来区分行），返回行读数 */
    const sendAndPoll = (n, target, kind, mode, budgetMs) => page.evaluate(async (a) => {
      window.__mode = a.mode;
      const T = HP.Talk;
      const t0 = performance.now();
      T.send(a.target, a.kind, 'R31 测试 ' + a.n);
      const read = () => {
        const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')];
        const r = rows[rows.length - 1];
        if (!r) return null;
        return {
          state: r.getAttribute('data-state'),
          text: (r.querySelector('.tk-sendtext') || {}).textContent || '',
          subs: [...r.querySelectorAll('.tk-sendsub')].map((x) => x.textContent),
          retry: !!r.querySelector('[data-testid="talk-retry"]')
        };
      };
      let seen = [];
      while (performance.now() - t0 < a.budgetMs) {
        const cur = read();
        if (cur) seen.push({ at: Math.round(performance.now() - t0), state: cur.state, text: cur.text });
        await new Promise((r) => setTimeout(r, 100));
      }
      return { elapsed: Math.round(performance.now() - t0), final: read(), seenCount: seen.length, firstWaitingAt: (seen.find((x) => x.state === 'waiting') || {}).at || null, firstWaitingText: (seen.find((x) => x.state === 'waiting') || {}).text || '', firstTimeoutAt: (seen.find((x) => x.state === 'timeout') || {}).at || null, firstSentAt: (seen.find((x) => x.state === 'sent' || x.state === 'partial' || x.state === 'failed') || {}).at || null };
    }, { n: n, target: target, kind: kind, mode: mode, budgetMs: budgetMs });

    /* ① 正常回执：2s 内出现终态「已送达 ◯◯ms」 */
    out.C1 = await sendAndPoll(1, 'pipeline.tester', 'private', 'ok', 2000);
    /* ② 桥回失败：5s 内报出原因 */
    out.C2 = await sendAndPoll(2, 'pipeline.tester', 'private', 'fail', 5000);
    /* ③④ 无回执：3s 转「还在发」、8s 超时 + 重试（一次跑满 8.5s，看两个时刻） */
    out.C34 = await sendAndPoll(3, 'pipeline.tester', 'private', 'hang', 8500);
    /* ⑤ 迟到回执覆盖终态：把上一条挂起的 promise 回执补上 */
    out.C5 = await page.evaluate(async () => {
      const T = HP.Talk;
      const t0 = performance.now();
      if (window.__late) window.__late({ delivered: true, ms: 1500 });
      let cur = null;
      while (performance.now() - t0 < 2000) {
        const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')];
        const r = rows[rows.length - 1];
        if (r) cur = { state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent || '' };
        if (cur && (cur.state === 'sent')) break;
        await new Promise((x) => setTimeout(x, 100));
      }
      return { elapsed: Math.round(performance.now() - t0), final: cur };
    });
    /* ⑥ 界面耗时 vs 平台台账 delivery.ms（桩把台账真值 1411 当回执 ms 给回来；另加对照：回执不带 ms） */
    out.C6 = await sendAndPoll(6, 'pipeline.tester', 'private', 'ok', 2000);
    out.C6_control = await sendAndPoll(61, 'pipeline.tester', 'private', 'okNoMs', 2000);
    /* ⑦ 广播逐条状态 */
    out.C7 = await sendAndPoll(7, '全体', 'broadcast', 'broadcast', 2500);
    /* ⑧ 省电档（sendTiming=false）：只留终态，不显示毫秒 */
    out.C8 = await page.evaluate(async () => {
      try { HP.App.setPref('sendTiming', false); } catch (e) { return { err: String(e && e.message) }; }
      await new Promise((r) => setTimeout(r, 300));
      return { timingNow: HP.Talk.timing() };
    });
    out.C8_send = await sendAndPoll(8, 'pipeline.tester', 'private', 'ok', 2000);
    out.C8_restore = await page.evaluate(async () => { try { HP.App.setPref('sendTiming', true); } catch (e) {} await new Promise((r) => setTimeout(r, 200)); return { timingNow: HP.Talk.timing() }; });

    const t = (o) => (o && o.final ? o.final.text : '');
    out.verdict = {
      '①2s内终态已送达+ms': !!(out.C1.final && out.C1.final.state === 'sent' && out.C1.firstSentAt <= 2000 && /已送达\s+1411ms/.test(t(out.C1))),
      '②5s内报出原因': !!(out.C2.final && out.C2.final.state === 'failed' && out.C2.firstSentAt <= 5000 && /没送达.*阶段没放行/.test(t(out.C2))),
      '③3s转还在发': out.C34.firstWaitingAt !== null && out.C34.firstWaitingAt <= 3300 && /还在发/.test(out.C34.firstWaitingText || ''),
      '④8s超时+有重试': !!(out.C34.final && out.C34.final.state === 'timeout' && out.C34.firstTimeoutAt !== null && out.C34.firstTimeoutAt <= 8300 && out.C34.final.retry === true),
      '⑤迟到回执覆盖终态': !!(out.C5.final && out.C5.final.state === 'sent' && /已送达\s+1500ms/.test(out.C5.final.text)),
      '⑥界面耗时=台账ms(1411)': /已送达\s+1411ms/.test(t(out.C6)),
      '⑥对照:回执无ms时显示≈': /≈\d+ms/.test(t(out.C6_control)),
      '⑦广播逐条状态': !!(out.C7.final && out.C7.final.state === 'partial' && /1\/2 已送达/.test(t(out.C7)) && out.C7.final.subs.some((x) => /pipeline.author ✓/.test(x)) && out.C7.final.subs.some((x) => /home.maid ✗.*已暂停/.test(x))),
      '⑧省电档只留终态': !!(out.C8_send.final && out.C8_send.final.state === 'sent' && /已送达$/.test(t(out.C8_send).trim()) && !/ms/.test(t(out.C8_send)))
    };
    return out;
  }
};
