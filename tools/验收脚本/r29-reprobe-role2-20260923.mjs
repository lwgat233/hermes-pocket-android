/* R-29 复测 · 运行 B2：单聊（⑤）—— 只打桩**传输层**（HP.App.rpc），渲染/钉底/上翻全走产品自己的代码
 * 为什么必须打桩传输层：单聊内容只有 talk.thread 一条来源（不接主机就没数据），
 *   而另一条 live 路径是坏的（this.live 是布尔开关，paintChat 却当 map 用 → 恒空）—— 这条缺陷单独记录。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r29-reprobe-role2-20260923.mjs
 */
export default {
  name: 'R29-复测-单聊打桩传输层-B2',
  check: async (page) => {
    const out = {};

    out.stub = await page.evaluate(() => {
      window.__thread = Array.from({ length: 40 }, (_, k) => ({
        who: k % 2 ? 'me' : 'role',
        body: '第 ' + k + ' 句 ' + 'z'.repeat(40),
        at: 1790120000 + k
      }));
      window.__rpcCalls = [];
      HP.App.rpc = async (op, args) => {
        window.__rpcCalls.push(op);
        if (op === 'talk.thread') return { items: window.__thread };
        if (op === 'talk.roles') return { roles: [{ full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running' }] };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.deliveries') return { items: [] };
        if (op === 'talk.sessions') return { sessions: [] };
        return {};
      };
      return { ok: true, thread: window.__thread.length };
    });

    const read = () => page.evaluate(() => {
      const b = document.getElementById('tk-chat');
      if (!b) return { missing: true };
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      let n = el; while (n && n !== b && !n.className) n = n.parentNode;
      while (n && n !== b && String(n.className).indexOf('tk-bub') < 0) n = n.parentNode;
      return {
        bubbles: [...b.children].filter((c) => String(c.className).indexOf('tk-bub') >= 0).length,
        gap: b.scrollHeight - b.clientHeight - Math.round(b.scrollTop), scrollTop: Math.round(b.scrollTop),
        pinned: !!b._pinned, scrollable: b.scrollHeight > b.clientHeight,
        anchorTop: n && n !== b ? Math.round(n.getBoundingClientRect().top) : null,
        rpcCalls: window.__rpcCalls.slice(-4)
      };
    });

    out.open = await page.evaluate(async () => {
      const T = HP.Talk;
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 800));
      T.tab = 'channel';
      await T.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 1200));
      return { on: (document.querySelector('.tabpage.on') || {}).id, view: T.view, box: !!document.getElementById('tk-chat') };
    });
    out.B1_first = await read();

    const rect = await page.evaluate(() => { const b = document.getElementById('tk-chat'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    if (rect) { await page.swipe(rect.x, rect.y, 400); await page.waitForTimeout(500); }
    out.B2_afterSwipe = await read();

    out.B3_afterNew = await page.evaluate(async () => {
      try {
        window.__thread.push({ who: 'role', body: '后来他又说了一句 ' + 'w'.repeat(40), at: 1790130000 });
        await HP.Talk.paintChat(HP.Talk.sel);
        await new Promise((r) => setTimeout(r, 700));
        return { ok: true };
      } catch (e) { return { ok: false, error: String(e && e.message) }; }
    });
    out.B3_state = await read();

    const b1 = out.B1_first, b2 = out.B2_afterSwipe, b3 = out.B3_state;
    out.verdict = {
      '⑤单聊首屏钉底': !!(b1 && b1.bubbles >= 20 && b1.gap === 0 && b1.pinned === true),
      '⑤上翻真起作用': !!(b2 && b2.gap > 100),
      '⑤上翻后新消息不抢回(±2px)': !!(b2 && b3 && b2.anchorTop != null && b3.anchorTop != null && Math.abs(b3.anchorTop - b2.anchorTop) <= 2),
      '⑤上翻后尊重用户位置(未钉底)': !!(b3 && b3.pinned === false)
    };
    return out;
  }
};
