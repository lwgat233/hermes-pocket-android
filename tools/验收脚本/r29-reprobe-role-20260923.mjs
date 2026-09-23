/* R-29 复测 · 运行 B：单聊（⑤）—— 先有内容再判钉底/上翻不被抢回
 * 说明：角色页的聊天记录走 RPC（talk.thread），本轮不接主机 → 用**后端真实形状**的 live 文本喂进去，
 *       钉底/上翻/重画都是产品自己的代码（paintChat + pinBottom）在真设备上跑、真手势翻。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r29-reprobe-role-20260923.mjs
 */
export default {
  name: 'R29-复测-单聊-B',
  check: async (page) => {
    const out = {};
    const read = () => page.evaluate(() => {
      const b = document.getElementById('tk-chat');
      if (!b) return { missing: true };
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      let n = el; while (n && n !== b && !n.className) n = n.parentNode;
      while (n && n !== b && String(n.className).indexOf('tk-bub') < 0) n = n.parentNode;
      return {
        children: b.children.length, gap: b.scrollHeight - b.clientHeight - Math.round(b.scrollTop),
        scrollTop: Math.round(b.scrollTop), pinned: !!b._pinned, scrollable: b.scrollHeight > b.clientHeight,
        anchorTop: n && n !== b ? Math.round(n.getBoundingClientRect().top) : null
      };
    });

    /* 开角色页（单聊界面） */
    out.open = await page.evaluate(async () => {
      const T = HP.Talk;
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 800));
      T.tab = 'channel';
      T.roles = [{ full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running' }];
      await T.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 900));
      return { on: (document.querySelector('.tabpage.on') || {}).id, view: T.view, box: !!document.getElementById('tk-chat') };
    });

    /* 喂 40 句（后端 live 文本的真实形状：字符串数组）→ 重画 → 首屏是否钉底 */
    out.seed = await page.evaluate(async () => {
      const T = HP.Talk;
      T.live = T.live || {};
      T.live['pipeline.tester'] = Array.from({ length: 40 }, (_, k) => '他说第 ' + k + ' 句 ' + 'z'.repeat(40));
      await T.paintChat(T.sel);
      await new Promise((r) => setTimeout(r, 600));
      return true;
    });
    out.B1_first = await read();

    /* 真手势上翻 */
    const rect = await page.evaluate(() => { const b = document.getElementById('tk-chat'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    if (rect) { await page.swipe(rect.x, rect.y, 400); await page.waitForTimeout(500); }
    out.B2_afterSwipe = await read();

    /* 又来一条 → 重画：可见锚点不动（不抢回） */
    out.B3_afterNew = await page.evaluate(async () => {
      try {
        const T = HP.Talk;
        T.live = T.live || {};
        T.live['pipeline.tester'] = T.live['pipeline.tester'] || [];
        T.live['pipeline.tester'].push('后来他又说了一句 ' + 'w'.repeat(40));
        await T.paintChat(T.sel);
        await new Promise((r) => setTimeout(r, 600));
        return { ok: true };
      } catch (e) { return { ok: false, error: String(e && e.message) }; }
    });
    out.B3_state = await read();

    const b1 = out.B1_first, b2 = out.B2_afterSwipe, b3 = out.B3_state;
    out.verdict = {
      '⑤单聊首屏钉底': !!(b1 && b1.children >= 5 && b1.gap === 0 && b1.pinned === true),
      '⑤上翻真起作用': !!(b2 && b2.gap > 100),
      '⑤上翻后新消息不抢回(±2px)': !!(b2 && b3 && b2.anchorTop != null && b3.anchorTop != null && Math.abs(b3.anchorTop - b2.anchorTop) <= 2),
      '⑤上翻后仍未钉底(尊重用户位置)': !!(b3 && b3.pinned === false)
    };
    return out;
  }
};
