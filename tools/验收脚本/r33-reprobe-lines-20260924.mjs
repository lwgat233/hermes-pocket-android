/* R-33 复测 · 第四段：文案折行数（Range 逐行框）+ 遮挡到底是谁盖的（频道页那个「去群聊 →」命中落在 DIV）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r33-reprobe-lines-20260924.mjs
 */
export default {
  name: 'R33-复测-折行与遮挡',
  check: async (page) => {
    const out = {};
    const probe = (scopeId, label) => page.evaluate((a) => {
      const scope = document.getElementById(a.scopeId) || document.body;
      const els = [...scope.querySelectorAll('.tk-chip, .btn, .tk-act, .tk-askin')].filter((e) => e.getBoundingClientRect().height > 0);
      const rows = els.map((e) => {
        const r = e.getBoundingClientRect();
        /* 文案折行：对元素里的文本节点做 Range 取值 → 客户端矩形个数 = 行框数 */
        let lines = 0;
        try {
          const range = document.createRange();
          range.selectNodeContents(e);
          const rects = [...range.getClientRects()].filter((x) => x.height > 1);
          lines = rects.length || 0;
        } catch (err) { lines = -1; }
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const self = !!(hit && (hit === e || e.contains(hit)));
        let cover = null;
        if (!self && hit) {
          let n = hit, chain = [];
          while (n && n !== document.body) { chain.push(n.tagName + (n.id ? '#' + n.id : '') + '.' + String(n.className || '').split(' ')[0] + '(z=' + (getComputedStyle(n).zIndex) + ',pos=' + getComputedStyle(n).position + ')'); n = n.parentElement; }
          cover = chain.slice(0, 4);
        }
        return { cls: String(e.className).split(' ')[0], text: String(e.textContent).replace(/\s+/g, ' ').trim().slice(0, 16),
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, dp_h: +r.height.toFixed(1),
          lines: lines, hitIsSelf: self, hitWhat: hit ? hit.tagName + '.' + String(hit.className || '').split(' ')[0] : null, coverChain: cover };
      });
      return { label: a.label, rows: rows, scrollTop: (() => { const sc = scope.closest('.panel-body'); return sc ? Math.round(sc.scrollTop) : null; })() };
    }, { scopeId: scopeId, label: label });

    await page.evaluate(async () => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { roles: [{ full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running' }], scenes: [] };
        if (op === 'talk.thread') return { items: [] };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2000));
    });
    out.channel = await probe('tab-talk', '频道页(滚动归位后)');
    await page.evaluate(async () => { await HP.Talk.openRole('pipeline.tester'); await new Promise((r) => setTimeout(r, 1200)); });
    out.role = await probe('tab-talk', '单聊(角色页)');
    out.verdict = {
      '频道页全部命中自己': out.channel.rows.every((r) => r.hitIsSelf),
      '频道页文案都是 1 行': out.channel.rows.every((r) => r.lines === 1),
      '单聊全部命中自己': out.role.rows.every((r) => r.hitIsSelf),
      '单聊文案都是 1 行': out.role.rows.every((r) => r.lines === 1)
    };
    return out;
  }
};
