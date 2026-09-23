/* R-29 复测 · 运行 A3：把「在底部时新消息到达后是否还钉底」拆成最小步、每步立刻读数
 *  T1 等高追加（新=旧高）  T2 新消息更矮（被裁的旧气泡高）  T3 单条更矮（最小复现）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r29-reprobe-steps-20260923.mjs
 */
export default {
  name: 'R29-复测-最小步-A3',
  check: async (page) => {
    const out = {};
    const setup = (n, len, base) => page.evaluate(async (args) => {
      const rows = Array.from({ length: args.n }, (_, k) => ({ id: args.base + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R29', body: 'M' + (args.base + k) + 'x'.repeat(args.len), at: 1790120000 + k }));
      HP.Talk.msgs = rows;
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 500));
      const s = document.getElementById('tk-stream');
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined; s._pinned = undefined; s._newCount = 0;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned, children: s.children.length, chipDisplay: chip ? getComputedStyle(chip).display : null, chipText: chip ? chip.textContent : null, bubbleH: s.children[0] ? s.children[0].offsetHeight : null };
    }, { n: n, len: len, base: base });
    const append = (count, bodyLen, from) => page.evaluate(async (a) => {
      const s = document.getElementById('tk-stream');
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= a.count; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: a.from, to: null, topic: 'R29', body: '新' + k + 'y'.repeat(a.bodyLen), at: 1790130000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), scrollTop: Math.round(s.scrollTop), scrollHeight: s.scrollHeight, pinned: !!s._pinned, newCount: s._newCount || 0, chipDisplay: chip ? getComputedStyle(chip).display : null, chipText: chip ? chip.textContent : null, firstId: Number(s.children[0].getAttribute('data-tk-id')) };
    }, { count: count, bodyLen: bodyLen, from: from });

    out.T1_start = await setup(80, 40, 3000);
    out.T1_appendEqual = await append(5, 40, 'owner.me');
    out.T2_start = await setup(80, 40, 4000);
    out.T2_appendShorter = await append(5, 0, 'owner.me');
    out.T3_start = await setup(80, 40, 5000);
    out.T3_appendOneShorter = await append(1, 0, 'owner.me');
    out.T3_appendOneShorterAgain = await append(1, 0, 'owner.me');

    const ok = (o) => o.gap === 0 && o.pinned === true && o.chipDisplay === 'none';
    out.verdict = {
      'T1起点在底部': ok(out.T1_start),
      'T1等高追加后仍钉底': ok(out.T1_appendEqual),
      'T2变矮追加后仍钉底': ok(out.T2_appendShorter),
      'T3单条变矮追加后仍钉底': ok(out.T3_appendOneShorter),
      'T3再来一条仍钉底': ok(out.T3_appendOneShorterAgain)
    };
    return out;
  }
};
