/* R-26 复测 · 口径块A：设置页(存储) 的坐标/键位/布局读数（新验收口径 SPEC §10）
 *  每项给 CSS px 与 dp（本页 viewport=device-width，1 CSS px = 1 dp；dpr 另记）
 *  键位：命中区（elementFromPoint 命中的是不是它）+ 是否被顶栏/键条/浮层吃掉
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r26-reprobe-ui-20260923.mjs
 */
const METRICS = (sel, label) => ({ sel, label });

export default {
  name: 'R26-复测-设置页存储-坐标键位布局',
  check: async (page) => {
    const out = {};

    out.env = await page.evaluate(() => ({
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      dpr: window.devicePixelRatio, screenPx: { w: screen.width, h: screen.height },
      cssEqualsDp: Math.abs(window.innerWidth - Math.round(screen.width / window.devicePixelRatio)) <= 2
    }));

    /* 设置页（存储那一块） */
    out.settings = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1200));
      const rows = [...document.querySelectorAll('#tab-settings .card')];
      const card = rows.find((c) => /本地占用/.test(c.textContent)) || null;
      const onlyCard = card ? (card.closest('.card') || card) : null;
      const pick = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const top = document.getElementById('topbar'), keybar = document.getElementById('keybar'), comp = document.getElementById('composer');
        const covers = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        const inner = el.querySelector('b, .v, .val') || el;
        return {
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
          okSize44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))),
          hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByTopbarOrKeybar: covers(top) || covers(keybar) || covers(comp),
          textClipped: inner ? (inner.scrollWidth > inner.clientWidth + 1) : null,
          text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
        };
      };
      const btns = onlyCard ? [...onlyCard.querySelectorAll('button, .row, .kv')] : [];
      const named = {
        '存储卡(整块)': onlyCard,
        '看明细键': btns.find((b) => /看明细/.test(b.textContent)),
        '清理键': btns.find((b) => /清理/.test(b.textContent)),
        '明细开关行': btns.find((b) => /明细/.test(b.textContent) && /开|关/.test(b.textContent))
      };
      const coords = {};
      Object.keys(named).forEach((k) => { coords[k] = pick(named[k]); });
      /* 相邻间距：把卡里可见控件按 y 排序，算相邻竖直间隙 */
      const gaps = [];
      const vis = btns.map((b) => ({ b: b, r: b.getBoundingClientRect() })).filter((x) => x.r.height > 0).sort((a, b2) => a.r.top - b2.r.top);
      for (let i = 1; i < vis.length; i += 1) gaps.push(Math.round(vis[i].r.top - vis[i - 1].r.bottom));
      const txt = (document.getElementById('tab-settings') || document.body).textContent.replace(/\s+/g, ' ');
      return {
        coords: coords,
        gapsPx: gaps, minGapPx: gaps.length ? Math.min.apply(null, gaps) : null,
        occupancyLine: (txt.match(/合计[^。]{0,80}/) || [null])[0],
        nativeLine: (txt.match(/原生侧[^看]{0,60}/) || [null])[0],
        toggleLine: (txt.match(/本地占用」明细[^触]{0,60}/) || [null])[0]
      };
    });

    /* ① 容量上限（干净重测：先删键 → 喂 200 条 → 过完节流窗口再读） */
    out.C1 = await page.evaluate(async () => {
      HP.Cache.del('thread.pipeline.tester');
      HP.App.rpc = async (op) => {
        if (op === 'talk.thread') return { items: Array.from({ length: 200 }, (_, k) => ({ who: 'role', body: '第 ' + k + ' 条 ' + 'z'.repeat(30), at: 1790120000 + k })) };
        if (op === 'talk.roles') return { roles: [] };
        if (op === 'talk.since') return { messages: [], last: 0 };
        return {};
      };
      HP.Talk.sel = { full_name: 'pipeline.tester', title: '测试者' };
      await HP.Talk.paintChat(HP.Talk.sel);
      await new Promise((r) => setTimeout(r, 1600));               /* 过完 1000ms 节流窗口 */
      HP.Cache.flush();
      const raw = localStorage.getItem('HP_TALK_CACHE.thread.pipeline.tester');
      let n = null;
      try { const v = JSON.parse(raw); n = v && Array.isArray(v.items) ? v.items.length : null; } catch (e) {}
      return { fed: 200, storedItems: n, maxItemsPref: HP.App.pref('cacheMaxItems', 50), bytes: (raw || '').length };
    });

    /* 群聊页（回归点 + 坐标/布局） */
    out.group = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 900));
      const inp = document.getElementById('tk-shoutin');
      const btn = document.getElementById('tk-shoutok');
      const chipWho = document.getElementById('tk-whosay2');
      const stream = document.getElementById('tk-stream');
      const rows = [...document.querySelectorAll('#tab-group [data-testid="talk-sendrow"]')];
      const measure = (el, label) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        return { label: label, px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight, okSize44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit))),
          hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null };
      };
      const header = [...document.querySelectorAll('#tab-group .tk-title')].map((x) => x.textContent.trim()).slice(0, 3);
      const sr = stream ? stream.getBoundingClientRect() : null;
      return {
        coords: {
          '群聊抬头': measure(document.querySelector('#tab-group .tk-title'), '抬头'),
          '喊话输入框': measure(inp, '输入框'),
          '广播键': measure(btn, '广播键'),
          '身份键(本人说/经理说)': measure(chipWho, '身份键')
        },
        stream: sr ? { px: { x: Math.round(sr.x), y: Math.round(sr.y), w: Math.round(sr.width), h: Math.round(sr.height) }, gap: stream.scrollHeight - stream.clientHeight - Math.round(stream.scrollTop) } : null,
        emptyOrContent: stream ? String(stream.textContent).replace(/\s+/g, ' ').trim().slice(0, 60) : null,
        header: header,
        sendRows: rows.length,
        sendRowHeights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
        groupTabSelected: (document.querySelector('.tabpage.on') || {}).id || null,
        twoLineRowCheck: rows.map((r) => ({ lines: [...r.children].map((c) => Math.round(c.getBoundingClientRect().height)), justify: getComputedStyle(r).alignItems }))
      };
    });

    return out;
  }
};
