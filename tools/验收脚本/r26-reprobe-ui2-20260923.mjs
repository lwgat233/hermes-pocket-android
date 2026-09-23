/* R-26 复测 · 口径块A：设置页(存储) + 聊天页-群聊 的坐标/键位/布局读数（SPEC §10）
 *  每项给 CSS px 与 dp（viewport=device-width → 1 CSS px = 1 dp；dpr 2.75 = 物理像素/css）
 *  键位 = elementFromPoint 命中的是不是它（会不会被顶栏/键条/浮层吃掉）+ 真触摸点一下有没有反应
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r26-reprobe-ui2-20260923.mjs
 */
export default {
  name: 'R26-复测-坐标键位布局',
  check: async (page) => {
    const out = {};

    out.env = await page.evaluate(() => ({ cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio, note: 'Android WebView: 1 CSS px = 1 dp；物理 px = css × dpr' }));

    /* ---------- 设置页（存储这一块） ---------- */
    out.settings = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1200));
      const card = [...document.querySelectorAll('#tab-settings .card')].find((c) => /本地占用/.test(c.textContent));
      if (!card) return { missing: true };
      card.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 400));
      const rows = [...card.children];
      const find = (re) => rows.find((x) => re.test(x.textContent)) || null;
      const btn = (re) => [...card.querySelectorAll('button')].find((b) => re.test(b.textContent)) || null;
      const probes = [
        { name: '本地占用行', el: find(/本地占用/) },
        { name: '原生侧行', el: find(/原生侧/) },
        { name: '明细开关行', el: [].concat(...[...card.querySelectorAll('div,label')].filter((x) => /明细/.test(x.textContent) && x.children.length <= 2)).slice(0, 1)[0] },
        { name: '看明细键', el: btn(/看明细/) },
        { name: '清理键', el: btn(/清理/) }
      ];
      const measure = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const tb = document.getElementById('topbar'), kb = document.getElementById('keybar'), cp = document.getElementById('composer');
        const cov = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        const inner = el.querySelector('b') || el;
        return {
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
          ge44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit))),
          hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByChrome: cov(tb) || cov(kb) || cov(cp),
          clipped: inner.scrollWidth > inner.clientWidth + 1,
          text: String(el.textContent).replace(/\s+/g, ' ').trim().slice(0, 70)
        };
      };
      const coords = {};
      probes.forEach((p) => { coords[p.name] = measure(p.el); });
      const vis = rows.map((x) => ({ r: x.getBoundingClientRect(), t: x.textContent.trim().slice(0, 10) })).filter((x) => x.r.height > 0).sort((a, b) => a.r.top - b.r.top);
      const gaps = [];
      for (let i = 1; i < vis.length; i += 1) gaps.push(Math.round(vis[i].r.top - vis[i - 1].r.bottom));
      /* 真触摸点「看明细」→ 卡里是否真多出各键明细行（真触发的证据） */
      const b = btn(/看明细/);
      const before = card.textContent.length;
      let tapped = false;
      if (b) { const r = b.getBoundingClientRect(); tapped = true; window.__tapTarget = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
      return { coords: coords, gapsPx: gaps, minGapPx: gaps.length ? Math.min.apply(null, gaps) : null, cardTextLenBefore: before, tapTarget: window.__tapTarget || null, visibleRows: vis.length, tapped: tapped };
    });

    /* 真触摸点一下「看明细」（用 CDP 真触摸，坐标来自上面读数） */
    if (out.settings && out.settings.tapTarget) {
      await page.tap(out.settings.tapTarget.x, out.settings.tapTarget.y);
      await page.waitForTimeout(900);
      out.settingsAfterTap = await page.evaluate(() => {
        const card = [...document.querySelectorAll('#tab-settings .card')].find((c) => /本地占用/.test(c.textContent));
        const t = card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
        return { cardTextLen: t.length, sawKeysDetail: /KB|B(?=\s|$)|个键/.test(t), head: t.slice(0, 120), detailLines: (t.match(/[a-z]+\.[a-z.-]+/g) || []).slice(0, 5) };
      });
    }

    /* ---------- 聊天页-群聊（坐标/键位/布局） ---------- */
    out.group = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 900));
      const measure = (el, label) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const tb = document.getElementById('topbar'), kb = document.getElementById('keybar'), cp = document.getElementById('composer');
        const cov = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        return {
          label: label, px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight, ge44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit))), hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByChrome: cov(tb) || cov(kb) || cov(cp), text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
        };
      };
      const page = document.getElementById('tab-group');
      const buttons = [...page.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0);
      const coords = {
        '群聊抬头': measure(page.querySelector('.tk-title'), '抬头'),
        '喊话输入框': measure(document.getElementById('tk-shoutin'), '输入框'),
        '广播键': measure(document.getElementById('tk-shoutok'), '广播键'),
        '身份键': measure(document.getElementById('tk-whosay2'), '身份键'),
        '投递台账键': measure(document.getElementById('tk-delivbtn'), '台账键'),
        '消息区': measure(document.getElementById('tk-stream'), '消息区')
      };
      /* 布局：喂 3 条 → 气泡两行制（名字行 + 正文行）+ 折行 + 空态 */
      const s = document.getElementById('tk-stream');
      const emptyText = String(s.textContent).trim().slice(0, 20);
      HP.Talk.msgs = [1, 2, 3].map((k) => ({ id: 7000 + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R26', body: '短' + k, at: 1790120000 + k }));
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const bubs = [...s.querySelectorAll('.tk-bub')];
      const bubInfo = bubs.map((b) => { const r = b.getBoundingClientRect(); const hd = b.querySelector('.tk-bubhead, .tk-bubname'); const tw = b.querySelector('.tk-bubtxt, div'); return { h: Math.round(r.height), headH: hd ? Math.round(hd.getBoundingClientRect().height) : null, overflowX: b.scrollWidth > b.clientWidth + 1 }; });
      HP.Talk.msgs = [{ id: 8001, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R26', body: '超长一行测试 ' + 'w'.repeat(300), at: 1790129999 }];
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const longBub = s.querySelector('.tk-bub');
      const longInfo = longBub ? { h: Math.round(longBub.getBoundingClientRect().height), w: Math.round(longBub.getBoundingClientRect().width), lines: Math.round(longBub.getBoundingClientRect().height / 19) } : null;
      return {
        coords: coords,
        visibleButtons: buttons.length, buttonLabels: buttons.map((b) => String(b.textContent).trim().slice(0, 8)),
        visibleChips: [...page.querySelectorAll('.tk-chip')].filter((c) => c.getBoundingClientRect().height > 0).map((c) => String(c.textContent).trim().slice(0, 10)),
        streamEmptyText: emptyText, bubbles3: bubInfo, longBubble: longInfo,
        streamGap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), scrollable: s.scrollHeight > s.clientHeight
      };
    });

    /* 真触摸点「身份键」→ 文案是否切换（真触发的证据） */
    const who = out.group && out.group.coords['身份键'];
    if (who) {
      await page.tap(who.centerPx.x, who.centerPx.y);
      await page.waitForTimeout(600);
      out.whoAfterTap = await page.evaluate(() => ({ text: String(document.getElementById('tk-whosay2').textContent).trim(), asWho: HP.Talk.asWho }));
    }
    return out;
  }
};
