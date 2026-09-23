/* R-29 复测 · 设备真触摸驱动（群聊钉底）—— 运行 A：群聊页 ①②③④⑥⑦⑧
 * 口径要说清的两件事：
 *   1) 消息数据是在设备页面里**按后端真实形状喂进去**的（HP.Talk.msgs），因为本轮不接主机；
 *      喂的是数据，钉底/追加/裁旧/上翻/回到底部这些**是产品自己的真代码 + 真触摸**在跑。
 *   2) 每步都读回页面的真实数值（scrollTop/scrollHeight/clientHeight/子节点 id/入口文案与 data-count）。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r29-reprobe-group-20260923.mjs
 */
const feedMsg = (i, kind, body) => ({ id: i, kind: kind || 'broadcast', from: 'pipeline.author', to: null, topic: 'R29', body: body || ('第 ' + i + ' 条 ' + 'x'.repeat(40)), at: 1790120000 + i });
const feedExpr = (n, from) => 'Array.from({length:' + n + '},(_,k)=>(' + feedMsg.toString() + ')(' + from + '+k))';

export default {
  name: 'R29-复测-群聊钉底-A',
  check: async (page) => {
    const out = {};
    const T = 'HP.Talk';
    const measure = () => page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      if (!s) return { missing: true };
      const chip = s._chip && s._chip.isConnected ? s._chip : document.getElementById('tk-backchip-tk-stream');
      const cs = chip ? getComputedStyle(chip) : null;
      return {
        scrollTop: Math.round(s.scrollTop), scrollHeight: s.scrollHeight, clientHeight: s.clientHeight,
        gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop),
        children: s.children.length,
        firstId: s.children[0] ? Number(s.children[0].getAttribute('data-tk-id')) : null,
        lastId: s.children[s.children.length - 1] ? Number(s.children[s.children.length - 1].getAttribute('data-tk-id')) : null,
        pinned: !!s._pinned, newCount: s._newCount || 0,
        chipText: chip ? chip.textContent : null, chipCount: chip ? chip.getAttribute('data-count') : null,
        chipDisplay: cs ? cs.display : null, chipRect: chip ? (() => { const r = chip.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; })() : null
      };
    });
    const streamRect = () => page.evaluate(() => { const s = document.getElementById('tk-stream'); if (!s) return null; const r = s.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });

    /* 进群聊页 */
    out.open = await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 900)); return { on: (document.querySelector('.tabpage.on') || {}).id, stream: !!document.getElementById('tk-stream') }; });

    /* ① 120 条喂进去 → 是否钉到底（离底部 0px）+ ⑦ 裁到 80 */
    out.seed120 = await page.evaluate(async (n) => {
      HP.Talk.msgs = Array.from({ length: n }, (_, k) => ({ id: 1000 + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R29', body: '第 ' + (1000 + k) + ' 条 ' + 'x'.repeat(40), at: 1790120000 + k }));
      const s = document.getElementById('tk-stream'); s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      return true;
    }, 120);
    out.A1_after120 = await measure();

    /* ② 追加 5 条：仍钉底 + 老节点还在（在被裁掉之前，标记过的节点必须原样活着 = 没整块重建） */
    out.mark = await page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const mid = s.children[Math.floor(s.children.length / 2)];
      mid.__probe = 'keep';
      return { markedId: Number(mid.getAttribute('data-tk-id')), atIndex: Math.floor(s.children.length / 2) };
    });
    out.A2_afterAppend = await page.evaluate(async () => {
      const s = document.getElementById('tk-stream');
      const before = s.children.length;
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= 5; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: '新 ' + k, at: 1790130000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 350));
      const marked = [...s.children].find((c) => c.__probe === 'keep');
      return { childrenBefore: before, childrenAfter: s.children.length, markedStillAlive: !!marked, markedIdNow: marked ? Number(marked.getAttribute('data-tk-id')) : null };
    });
    out.A2_state = await measure();

    /* ③ 真手指上翻 → 再追加新消息：位置不被抢回（±2px），并出现「⇣ 回到底部（新 N 条）」 */
    const sr = await streamRect();
    out.swipe = { at: sr };
    await page.swipe(sr.x, sr.y, 600);                       /* 真手势：往下拖 = 看更早的内容 */
    await page.waitForTimeout(500);
    out.A3_afterSwipe = await measure();
    out.A3_scrollTopBeforeAppend = out.A3_afterSwipe.scrollTop;
    out.A3_afterNewMsg = await page.evaluate(async (before) => {
      const s = document.getElementById('tk-stream');
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= 3; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'pipeline.tester', to: null, topic: 'R29', body: '上翻后的新 ' + k, at: 1790140000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      return { scrollTopBefore: before, scrollTopAfter: Math.round(s.scrollTop), delta: Math.round(s.scrollTop) - before };
    }, out.A3_scrollTopBeforeAppend);
    out.A3_state = await measure();

    /* ④ 真手指点「⇣ 回到底部」→ 回到底部、入口消失、计数清零 */
    const chip = out.A3_state.chipRect;
    out.tapChip = { at: chip };
    if (chip && chip.w > 0) { await page.tap(chip.x, chip.y); await page.waitForTimeout(500); }
    out.A4_afterTapChip = await measure();

    /* ⑥ 不足一屏（3 条）不报错、仍钉底 */
    out.A6_three = await page.evaluate(async () => {
      HP.Talk.msgs = [1, 2, 3].map((k) => ({ id: 9000 + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R29', body: '只有三条 ' + k, at: 1790150000 + k }));
      const s = document.getElementById('tk-stream'); s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 350));
      const cs = s._chip ? getComputedStyle(s._chip) : null;
      return { children: s.children.length, gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), scrollable: s.scrollHeight > s.clientHeight, chipDisplay: cs ? cs.display : null };
    });

    /* ⑧ 频道页行为不变（不接主机时应仍是老样子：渲染出来 + 如实降级） */
    out.A8_channel = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 2000));
      const pg = document.getElementById('tab-talk');
      return { on: (document.querySelector('.tabpage.on') || {}).id, roleRows: pg ? pg.querySelectorAll('[data-testid="talk-role"]').length : -1, hasDegrade: !!(pg && /连不上|还没拉到角色/.test(pg.textContent)) };
    });

    const a1 = out.A1_after120, a2 = out.A2_state, a3 = out.A3_state, a4 = out.A4_afterTapChip, a6 = out.A6_three;
    out.verdict = {
      '①钉到底0px': a1.gap === 0,
      '②追加后仍钉底': a2.gap === 0,
      '②老节点活着(未整块重建)': out.A2_afterAppend.markedStillAlive === true,
      '③上翻读数确实动了': Math.abs(out.A3_scrollTopBeforeAppend - a2.scrollTop) > 50,
      '③新消息后不被抢回(±2px)': Math.abs(out.A3_afterNewMsg.delta) <= 2,
      '③入口文案带新N条': /回到底部（新 3 条）/.test(String(a3.chipText)) && a3.chipCount === '3' && a3.chipDisplay !== 'none',
      '④点入口后回到底部': a4.gap === 0,
      '④入口消失且计数清零': a4.chipDisplay === 'none' && a4.chipCount === '0',
      '⑥3条不报错且钉底': a6.children === 3 && a6.gap === 0 && a6.scrollable === false,
      '⑦120条裁到80': a1.children === 80,
      '⑧频道页行为不变': out.A8_channel.on === 'tab-talk' && out.A8_channel.roleRows === 0 && out.A8_channel.hasDegrade === true
    };
    return out;
  }
};
