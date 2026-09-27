/* R-33 复测 · 第三段：单聊 + 频道页 —— 同款 .tk-chip 复用处的行高（+12dp）有没有把文案挤折行 / 遮挡相邻控件
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r33-reprobe-chips-20260924.mjs
 */
export default {
  name: 'R33-复测-chip与布局',
  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { roles: [{ full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running' }], scenes: [] };
        if (op === 'talk.thread') return { items: Array.from({ length: 6 }, (_, k) => ({ who: k % 2 ? 'me' : 'role', body: '第 ' + k + ' 句 ' + 'z'.repeat(30), at: 1790120000 + k })) };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.deliveries') return { items: [] };
        if (op === 'talk.shutdown') return {};
        return {};
      };
    });

    const scan = (scopeId, label) => page.evaluate((a) => {
      const scope = document.getElementById(a.scopeId) || document.body;
      const chips = [...scope.querySelectorAll('.tk-chip, .btn, .tk-act, .tk-askin')].filter((e) => e.getBoundingClientRect().height > 0);
      const info = chips.map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.2);
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return {
          cls: String(e.className).split(' ')[0], text: String(e.textContent).replace(/\s+/g, ' ').trim().slice(0, 16),
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, dp_h: +r.height.toFixed(1),
          lines: Math.max(1, Math.round(r.height / lh)), lineHeight: +lh.toFixed(1),
          hitIsSelf: !!(hit && (hit === e || e.contains(hit))), hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          clipped: e.scrollWidth > e.clientWidth + 1
        };
      });
      /* 相邻控件是否互相压（同一行内两两求交） */
      const overlaps = [];
      for (let i = 0; i < chips.length; i += 1) {
        for (let j = i + 1; j < chips.length; j += 1) {
          const a2 = chips[i].getBoundingClientRect(), b2 = chips[j].getBoundingClientRect();
          const ox = Math.min(a2.right, b2.right) - Math.max(a2.left, b2.left);
          const oy = Math.min(a2.bottom, b2.bottom) - Math.max(a2.top, b2.top);
          if (ox > 1 && oy > 1) overlaps.push({ a: String(chips[i].textContent).trim().slice(0, 8), b: String(chips[j].textContent).trim().slice(0, 8), ox: Math.round(ox), oy: Math.round(oy) });
        }
      }
      /* 竖直间距（同一列相邻控件） */
      const sorted = chips.map((e) => e.getBoundingClientRect()).sort((p, q) => p.top - q.top);
      const gaps = [];
      for (let i = 1; i < sorted.length; i += 1) { const g = Math.round(sorted[i].top - sorted[i - 1].bottom); if (g >= 0 && g < 60) gaps.push(g); }
      const vis = chips.length;
      return { scope: a.scopeId, label: a.label, count: vis, chips: info, overlaps: overlaps, verticalGaps: gaps.slice(0, 8),
        chromeOverlap: (() => { const out2 = []; ['topbar', 'keybar', 'composer'].forEach((id) => { const b = document.getElementById(id); if (!b) return; const br = b.getBoundingClientRect(); if (br.height === 0) return; chips.forEach((c) => { const r = c.getBoundingClientRect(); if (br.bottom > r.top && br.top < r.bottom) out2.push(id + '↔' + String(c.textContent).trim().slice(0, 8)); }); }); return out2; })() };
    }, { scopeId: scopeId, label: label });

    /* 频道页 */
    out.channel = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2200));
      return { on: (document.querySelector('.tabpage.on') || {}).id };
    });
    out.channelScan = await scan('tab-talk', '频道页');

    /* 单聊（角色页） */
    out.roleOpen = await page.evaluate(async () => {
      await HP.Talk.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 1500));
      return { view: HP.Talk.view, hasChat: !!document.getElementById('tk-chat'), bubbles: document.querySelectorAll('#tk-chat .tk-bub').length };
    });
    out.roleScan = await scan('tab-talk', '单聊(角色页)');
    return out;
  }
};
