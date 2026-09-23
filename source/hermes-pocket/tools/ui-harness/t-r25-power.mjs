/* R-25 验收探针：省电档下的聊天轮询 / 定时器清单 / 心跳参数 / 设置项三档
 * 走**真入口**：HP.App.applyPowerSave(true/false)（跟切后台/亮屏同一条路）、HP.Talk.startPoll/pollStats。
 * app.power 请求在原生桥那层拦下来读数（心跳参数就是从这里复算）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r25-power.mjs
 */
export default {
  name: 'R-25 验收：省电档 6s 轮询 ≤1 次、实时档 ≥2 次、最省档 0 次；定时器清单；心跳 120s/30s；设置项三档',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });

    const out = {};

    /* 准备：进群聊页让轮询跑起来；顺手拦 app.power 请求 */
    await page.evaluate(async () => {
      const T = HP.Talk;
      T.pullRoleOutput = () => { };
      T.msgs = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, from: 'owner.me', kind: 'default', topic: '', body: '第 ' + (i + 1) + ' 条', at: Math.floor(Date.now() / 1000) }));
      T.live = true; T.tab = 'group';
      window.__pwrReqs = [];
      window.__pwrOrig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'app.power') window.__pwrReqs.push({ save: m.save, keepalive: m.keepalive, keepaliveSave: m.keepaliveSave });
        return window.__pwrOrig(t);
      };
      await HP.App.setPref('talkPollSave', 'slow30');      /* 默认档（作者推荐） */
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 300));
    });

    const countSince = (ms) => page.evaluate(async (ms) => {
      if (!window.__calls) window.__calls = {};
      window.__calls['talk.since'] = 0;
      await new Promise((r) => setTimeout(r, ms));
      return window.__calls['talk.since'] || 0;
    }, ms);

    /* ① 前台（实时）：6s 内 talk.since 应 ≥2（2.5s 一次） */
    out['①_前台6s'] = { since: await countSince(6200), poll: await page.evaluate(() => HP.Talk.pollStats()) };

    /* ② 省电档 slow30：6s 内 ≤1 次（现在应是 0 次，因为周期 30s）；定时器清单 */
    out['②_省电档slow30'] = await page.evaluate(async () => {
      await HP.App.applyPowerSave(true, '探针');
      return {
        请求: window.__pwrReqs[window.__pwrReqs.length - 1],
        轮询: HP.Talk.pollStats(),
        tick定时器还在: !!HP.App._tickTimer,
        流量定时器还在: !!HP.App._trafficTimer,
        ping定时器还在: !!(HP.App.ping && HP.App.ping.timer),
        rAF看门狗还在: !!HP.App._watchRaf,
        发送状态表还在: !!HP.Talk._sendTick
      };
    });
    out['②_省电档_6s内轮询'] = await countSince(6200);

    /* ③ 实时档：省电时也 2.5s → 6s 内 ≥2 次 */
    out['③_实时档'] = await page.evaluate(async () => {
      await HP.App.setPref('talkPollSave', 'realtime');
      await HP.Talk.startPoll();
      return HP.Talk.pollStats();
    });
    out['③_实时档_6s内轮询'] = await countSince(6200);

    /* ④ 最省档：省电时轮询停（6s 内 0 次、间隔 0） */
    out['④_最省档'] = await page.evaluate(async () => {
      await HP.App.setPref('talkPollSave', 'pause');
      await HP.Talk.startPoll();
      return HP.Talk.pollStats();
    });
    out['④_最省档_6s内轮询'] = await countSince(6200);

    /* ⑤ 回前台：轮询回来 + 立刻补一次 + 心跳参数回 30s；定时器清单还原 */
    out['⑤_回前台'] = await page.evaluate(async () => {
      await HP.App.setPref('talkPollSave', 'slow30');
      HP.App.sessionId = HP.App.sessionId || 'probe-session';   /* 有会话才会走完整恢复路径（会真发回前台那条 app.power） */
      const before = (window.__calls['talk.since'] || 0);
      await HP.App.applyPowerSave(false, '探针亮屏');
      await new Promise((r) => setTimeout(r, 900));
      return {
        请求: window.__pwrReqs[window.__pwrReqs.length - 1],
        全部power请求: window.__pwrReqs,
        轮询: HP.Talk.pollStats(),
        回前台立刻补一次: (window.__calls['talk.since'] || 0) > before,
        tick定时器还在: !!HP.App._tickTimer,
        流量定时器还在: !!HP.App._trafficTimer,
        rAF看门狗还在: !!HP.App._watchRaf
      };
    });

    /* ⑥ 设置页那两行：省电读数 + 轮询读数 */
    await page.evaluate(() => HP.App.openBoard('settings'));
    await page.waitForTimeout(700);
    out['⑥_设置页读数'] = await page.evaluate(() => {
      const p = document.getElementById('pw-poll');
      const s = document.getElementById('pw-state');
      const sel = document.querySelector('[data-pref="talkPollSave"]');
      return {
        轮询那行: p ? p.textContent : null,
        状态那行: s ? s.textContent : null,
        档位选项数: sel ? sel.options.length : 0,
        当前值: sel ? sel.value : null,
        选项文案: sel ? [...sel.options].map((o) => o.textContent) : []
      };
    });

    /* ⑦ 不回归：群聊/钉底还在、报错 0 */
    out['⑦_不回归'] = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 400));
      const s = document.getElementById('tk-stream');
      return {
        群聊容器在: !!s,
        在底部: s ? (s.scrollHeight - s.clientHeight - s.scrollTop) <= 2 : null,
        发送状态区逻辑在: typeof HP.Talk.startSendTicker === 'function' && typeof HP.Talk.stopSendTicker === 'function'
      };
    });

    await page.waitForTimeout(300);
    out['⑧_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
