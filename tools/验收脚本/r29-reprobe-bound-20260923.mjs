/* R-29 复测 · 运行 A5：① 不裁旧（未满 80）时追加是否钉底（界定缺陷触发条件）② 单聊不退化（⑤）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r29-reprobe-bound-20260923.mjs
 */
export default {
  name: 'R29-复测-触发边界与单聊-A5',
  check: async (page) => {
    const out = {};
    const setupGroup = (n, base) => page.evaluate(async (a) => {
      HP.Talk.msgs = Array.from({ length: a.n }, (_, k) => ({ id: a.base + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R29', body: 'M' + (a.base + k) + 'x'.repeat(40), at: 1790120000 + k }));
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 500));
      const s = document.getElementById('tk-stream');
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined; s._pinned = undefined; s._newCount = 0;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned, children: s.children.length, chipDisplay: chip ? getComputedStyle(chip).display : null };
    }, { n: n, base: base });
    const appendGroup = (count) => page.evaluate(async (c) => {
      const s = document.getElementById('tk-stream');
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= c; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: '新' + k + 'y'.repeat(40), at: 1790130000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned, newCount: s._newCount || 0, children: s.children.length, chipDisplay: chip ? getComputedStyle(chip).display : null, chipText: chip ? chip.textContent : null };
    }, count);

    /* ① 未满 80：不裁旧 → 追加是否钉底 */
    out.A_under80_start = await setupGroup(10, 9000);
    out.A_under80_append = await appendGroup(1);

    /* ② 满 80：裁旧 → 已知会掉底，记录一次作对照 */
    out.B_at80_start = await setupGroup(80, 9500);
    out.B_at80_append = await appendGroup(1);

    /* ⑤ 单聊：喂形状数据 + 开角色页（RPC 会失败，但钉底/上翻是产品自己的代码在跑） */
    out.C_openRole = await page.evaluate(async () => {
      const T = HP.Talk;
      HP.App.showBoard('talk');                       /* 角色页挂在频道页那个 board 上 */
      await new Promise((r) => setTimeout(r, 800));
      T.tab = 'channel';
      T.roles = [{ full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running' }];
      T.live = T.live || {};
      T.live['pipeline.tester'] = Array.from({ length: 40 }, (_, k) => '他说第 ' + k + ' 句 ' + 'z'.repeat(40));
      await T.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 1200));
      const box = document.getElementById('tk-chat');
      if (!box) return { missing: true, on: (document.querySelector('.tabpage.on') || {}).id, view: T.view };
      return { exists: true, children: box.children.length, gap: box.scrollHeight - box.clientHeight - Math.round(box.scrollTop), pinned: !!box._pinned, scrollable: box.scrollHeight > box.clientHeight };
    });

    /* ⑤ 上翻（真手势）→ 再触发一次重画（新消息到达）→ 可见锚点不动、不被抢回 */
    const rect = await page.evaluate(() => { const b = document.getElementById('tk-chat'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    if (rect) { await page.swipe(rect.x, rect.y, 400); await page.waitForTimeout(500); }
    out.C_anchor = rect ? await page.evaluate(() => {
      const b = document.getElementById('tk-chat');
      const r = b.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      let n = el; while (n && n !== b && !n.className) n = n.parentNode;
      while (n && n !== b && String(n.className).indexOf('tk-bub') < 0) n = n.parentNode;
      return n && n !== b ? { found: true, top: Math.round(n.getBoundingClientRect().top), scrollTop: Math.round(b.scrollTop), gap: b.scrollHeight - b.clientHeight - Math.round(b.scrollTop) } : { found: false, scrollTop: Math.round(b.scrollTop), gap: b.scrollHeight - b.clientHeight - Math.round(b.scrollTop) };
    }) : { found: false, why: 'no #tk-chat' };
    out.C_afterNew = rect ? await page.evaluate(async () => {
      try {
        const T = HP.Talk; const b = document.getElementById('tk-chat');
        T.live = T.live || {};
        T.live['pipeline.tester'] = T.live['pipeline.tester'] || ['（补一个）' + 'w'.repeat(40)];
        T.live['pipeline.tester'].push('后来他又说了一句 ' + 'w'.repeat(40));
        await T.paintChat(T.sel);
        await new Promise((r) => setTimeout(r, 600));
        const r = b.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        let n = el; while (n && n !== b && !n.className) n = n.parentNode;
        while (n && n !== b && String(n.className).indexOf('tk-bub') < 0) n = n.parentNode;
        return { found: !!(n && n !== b), top: n && n !== b ? Math.round(n.getBoundingClientRect().top) : null, scrollTop: Math.round(b.scrollTop), gap: b.scrollHeight - b.clientHeight - Math.round(b.scrollTop), pinned: !!b._pinned };
      } catch (e) { return { found: false, error: String(e && e.message) }; }
    }) : { found: false, why: 'no #tk-chat' };

    const a = out.A_under80_append, b = out.B_at80_append, c1 = out.C_openRole, c2 = out.C_afterNew, ca = out.C_anchor;
    out.verdict = {
      '未满80追加后钉底(不裁旧)': a.gap === 0 && a.pinned === true && a.chipDisplay === 'none',
      '满80追加后掉底(裁旧)': b.gap > 0 && b.pinned === false,
      '单聊首屏钉底': !!(c1 && c1.exists && c1.gap === 0 && c1.pinned === true),
      '单聊上翻后不被抢回(±2px)': !!(ca && ca.found && c2 && c2.found && Math.abs(c2.top - ca.top) <= 2)
    };
    return out;
  }
};
