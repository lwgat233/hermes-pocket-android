/* F-SESS-12 判据：聊天输出状态机（运行中 / 压缩中 / 已结束）
 * 喂的是**真实 TUI 文案**（取自本机 ui-tui/dist），读回来的是状态、命中的规则、迁移序列、顶栏那行字。
 */
const realText = {
  'thinking': '✻ Thinking…  ~1.2k tokens\r\n',
  'interruptible': 'Ctrl+C to interrupt…\r\n',
  'compacting': 'compacting\r\n',
  'compressions': 'Compressions: 3\r\n',
  'compacted': 'compacted\r\n',
  'interrupted': '  [interrupted]\r\n',
  'plainOutput': 'assistant: 好了，做完了。\r\n'
};

export default {
  name: 'F-SESS-12 聊天输出状态机',

  check: async (page) => {
    const out = {};

    /* ① 规则表自检：每条规则都要说清依据（不许有"说不出凭什么"的规则） */
    out.ruleTable = await page.evaluate(() => HP.ChatState.RULES.map((r) => ({ id: r.id, state: r.state, hasNote: !!r.note, note: r.note })));

    /* ② 逐条真实文案 → 判出的状态与命中规则（用假时间，可复现） */
    out.perInput = await page.evaluate((wx) => {
      const res = [];
      for (const [name, text] of Object.entries(wx)) {
        HP.ChatState.reset();
        HP.ChatState.feed(text, 1000);
        const i = HP.ChatState.info();
        res.push({ fed: name, text: text.replace(/\r?\n$/, ''), verdict: i.state, matchedRule: i.rule, matchedSample: i.sample });
      }
      return res;
    }, realText);

    /* ③ 迁移序列：运行中 → 压缩中 → 运行中 → 已结束（静默） */
    out.transitions = await page.evaluate((wx) => {
      HP.ChatState.reset();
      let t = 1000;
      HP.ChatState.feed(wx.interruptible, t += 1000);       // 运行中
      HP.ChatState.feed(wx.compacting, t += 1000);       // 压缩中
      HP.ChatState.feed(wx.thinking, t += 1000);         // 回运行中
      HP.ChatState.tick(t += 1000);                  // 还没静默够 → 仍运行中
      const midway = HP.ChatState.state;
      HP.ChatState.tick(t += 3000);                  // 静默 ≥3s → 已结束
      return {
        'midway': midway,
        'sequence': HP.ChatState.transitions.map((x) => x.to),
        'rules': HP.ChatState.transitions.map((x) => x.rule),
        'finalState': HP.ChatState.state
      };
    }, realText);

    /* ④ explain()：误判时要能打印"凭什么" */
    out.explain = await page.evaluate(() => {
      HP.ChatState.reset();
      HP.ChatState.feed('compacting', 5000);
      return HP.ChatState.explain();
    });

    /* ⑤ 真实链路：从传输层推一段输出 → 状态机 → 顶栏那一行字（读 DOM） */
    await page.evaluate(() => { HP.ChatState.reset(); if (HP.App.closePanel) HP.App.closePanel(); });
    await page.evaluate(() => window.__feed('Ctrl+C to interrupt…\r\n'));
    await page.waitForTimeout(500);
    out.livePath = await page.evaluate(() => ({
      'state': HP.ChatState.state,
      'matchedRule': HP.ChatState.rule,
      'badgeText': document.getElementById('tb-badge').textContent,
      'badgeTitle': document.getElementById('tb-badge').title
    }));

    /* ⑥ 静默 → 已结束，顶栏跟着变（用假时间推进，避免真的等 3 秒） */
    out.quietToEnd = await page.evaluate(() => {
      const now = Date.now();
      HP.ChatState.lastActivity = now - 5000;      // 假装 5 秒没有输出
      HP.App.tickChatState();
      return { state: HP.ChatState.state, matchedRule: HP.ChatState.rule, badgeText: document.getElementById('tb-badge').textContent };
    });

    /* ⑦ 规则覆盖率：7 条规则里有没有一条从来没被这组断言喂到 */
    out.coverage = await page.evaluate((wx) => {
      const seen = {};
      for (const text of Object.values(wx)) {
        for (const r of HP.ChatState.RULES) if (r.re.test(HP.ChatState.tail(text))) seen[r.id] = true;
      }
      seen['quiet'] = true;
      return { covered: Object.keys(seen), missing: HP.ChatState.RULES.filter((r) => !seen[r.id]).map((r) => r.id) };
    }, realText);

    /* 判据 */
    const byInput = Object.fromEntries(out.perInput.map((x) => [x.fed, x.verdict]));
    const matched = Object.fromEntries(out.perInput.map((x) => [x.fed, x.matchedRule]));
    /* 期望文案提成常量：includes() 里直接写中文字面量会被对象键扫描误判成中文键 */
    const noteExpect = '规则 compacting';
    const sampleExpect = '命中';
    const runningExpect = '运行中';
    const ruleExpect = '规则';
    const endedExpect = '已结束';
    out.verdict = {
      'everyRuleHasNote': out.ruleTable.every((r) => r.hasNote),
      'thinkingCountsRunning': byInput['thinking'] === '运行中' && matched['thinking'] === 'thinking',
      'interruptHintCountsRunning': byInput['interruptible'] === '运行中' && matched['interruptible'] === 'interrupt_hint',
      'compactingCountsCompressing': byInput['compacting'] === '压缩中' && matched['compacting'] === 'compacting',
      'compressionsCountCompressing': byInput['compressions'] === '压缩中' && matched['compressions'] === 'compressions',
      'compactedCountsCompressing': byInput['compacted'] === '压缩中' && matched['compacted'] === 'compacted',
      'interruptedCountsEnded': byInput['interrupted'] === '已结束' && matched['interrupted'] === 'interrupted',
      'plainOutputLeavesStateUnknown': byInput['plainOutput'] === '未知',
      'transitionSequenceOk': out.transitions.sequence.join('→') === '运行中→压缩中→运行中→已结束',
      'notEndedBeforeQuietThreshold': out.transitions.midway === '运行中',
      'explainHasNoteAndSample': String(out.explain).includes(noteExpect) && String(out.explain).includes(sampleExpect),
      'livePathWorks': out.livePath.state === '运行中' && String(out.livePath.badgeText).includes(runningExpect),
      'badgeHasTitle': String(out.livePath.badgeTitle || '').includes(ruleExpect),
      'badgeShowsEndedAfterQuiet': out.quietToEnd.state === '已结束' && String(out.quietToEnd.badgeText).includes(endedExpect),
      'allRulesCovered': out.coverage.missing.length === 0
    };
    return out;
  }
};
