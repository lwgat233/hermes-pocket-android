/* R-25 复测 · 板块B：聊天页-群聊 —— 轮询档位（省电30s/最省停/实时2.5s）+ 回前台立刻补一次 + 心跳 120↔30
 * 只打桩传输层（HP.App.rpc）来**数** talk.since 调用；轮询表/档位/进出省电全是产品自己的代码（HP.Talk.pollDelay/startPoll/onPowerSave）。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r25-reprobe-group-20260923.mjs
 */
export default {
  name: 'R25-复测-板块B-群聊轮询',
  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      window.__calls = [];
      window.__powerArgs = [];
      HP.App.rpc = async (op, args) => {
        const t = performance.now();
        if (op === 'talk.since') window.__calls.push(Math.round(t));
        if (op === 'app.power') window.__powerArgs.push({ save: !!(args && args.save), keepalive: args && args.keepalive, at: Math.round(t) });
        if (op === 'talk.roles') return { roles: [], scenes: [] };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
    });
    const phase = async (label, setup) => page.evaluate(async (a) => {
      window.__calls = [];
      const T = HP.Talk;
      if (a.setup.pref) { try { HP.App.setPref('talkPollSave', a.setup.pref); } catch (e) { HP.App.prefsCache && (HP.App.prefsCache.talkPollSave = a.setup.pref); } }
      if (a.setup.power === true) await HP.App.applyPowerSave(true, 'test');
      if (a.setup.power === false) await HP.App.applyPowerSave(false, 'test');
      if (a.setup.poll !== false) { T.startPoll(); }
      await new Promise((r) => setTimeout(r, a.waitMs));
      const sinceCalls = window.__calls.length;
      const stats = T.pollStats ? T.pollStats() : null;
      return { label: a.label, sinceCalls: sinceCalls, stats: stats, prefNow: (() => { try { return HP.App.pref('talkPollSave', 'slow30'); } catch (e) { return null; } })(), powerSaveFlag: !!T._powerSave, pollOff: !!T._pollOff, timerOn: !!T.timer };
    }, { label: label, setup: setup, waitMs: (setup && setup.waitMs) || 6000 });

    out.open = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 900));
      return { on: (document.querySelector('.tabpage.on') || {}).id, live: HP.Talk.live, timerOn: !!HP.Talk.timer, delay: HP.Talk.pollDelay() };
    });

    /* 前台（非省电）：2.5s → 6s 里应有 2~3 次 */
    out.foreground = await phase('前台实时(非省电)', { pref: 'slow30', power: false, waitMs: 6000 });
    /* 省电档 slow30：6s 里 0 次 */
    out.saveSlow30 = await phase('省电档slow30', { pref: 'slow30', power: true, waitMs: 6000 });
    /* 回前台：立即补一次（1.5s 内应 ≥1） */
    out.backForeground = await page.evaluate(async () => {
      window.__calls = [];
      await HP.App.applyPowerSave(false, 'test');
      await new Promise((r) => setTimeout(r, 1500));
      return { sinceCallsWithin1_5s: window.__calls.length, stats: HP.Talk.pollStats(), delay: HP.Talk.pollDelay() };
    });
    /* 最省档 pause：省电期间 0 次；回前台立刻补一次 */
    out.savePause = await phase('最省档pause', { pref: 'pause', power: true, waitMs: 6000 });
    out.pauseBack = await page.evaluate(async () => {
      window.__calls = [];
      await HP.App.applyPowerSave(false, 'test');
      await new Promise((r) => setTimeout(r, 1500));
      return { sinceCallsWithin1_5s: window.__calls.length, stats: HP.Talk.pollStats(), delay: HP.Talk.pollDelay() };
    });
    /* 实时档 realtime：省电期间也 2.5s → 6s 里 2~3 次 */
    out.saveRealtime = await phase('实时档realtime(省电中)', { pref: 'realtime', power: true, waitMs: 6000 });
    out.powerArgs = await page.evaluate(() => window.__powerArgs.slice(-4));
    /* 复位：回前台 + 默认档 */
    out.restore = await page.evaluate(async () => {
      await HP.App.applyPowerSave(false, 'test');
      try { HP.App.setPref('talkPollSave', 'slow30'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 300));
      return { prefNow: (() => { try { return HP.App.pref('talkPollSave', 'slow30'); } catch (e) { return null; } })(), powerSave: !!HP.Talk._powerSave, delay: HP.Talk.pollDelay() };
    });

    const f = out.foreground, ss = out.saveSlow30, sp = out.savePause, sr = out.saveRealtime;
    const keep = (out.powerArgs || []).filter((x) => x.save);
    const back = (out.powerArgs || []).filter((x) => !x.save);
    out.verdict = {
      '①省电档(30s)6s内0次': ss.sinceCalls === 0,
      '①前台6s内2~3次': f.sinceCalls >= 2 && f.sinceCalls <= 4,
      '②回前台立刻补一次': out.backForeground.sinceCallsWithin1_5s >= 1,
      '②最省档回前台也立刻补一次': out.pauseBack.sinceCallsWithin1_5s >= 1,
      '①最省档6s内0次': sp.sinceCalls === 0,
      '①实时档省电中仍2~3次': sr.sinceCalls >= 2,
      '③心跳省电120/回前台30': keep.some((x) => Number(x.keepalive) === 120) && back.some((x) => Number(x.keepalive) === 30),
      '档位读数(间隔秒)': (ss.stats && ss.stats['间隔秒']) + '/' + (sr.stats && sr.stats['间隔秒']) + '/' + (sp.stats && sp.stats['间隔秒'])
    };
    return out;
  }
};
