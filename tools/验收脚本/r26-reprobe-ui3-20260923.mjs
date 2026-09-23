/* R-26 复测 · 口径块A（第二版）：坐标要**量完立刻点**（同一拍），否则内容一变坐标就失效（上一版就吃了这个亏）
 * 设置页(存储)：本地占用行 / 原生侧行 / 看明细键 / 清理键 —— px/dp、可视区、命中、遮挡、间距、截断、真触摸
 * 聊天页-群聊：抬头 / 喊话输入框 / 广播键 / 身份键 / 台账键 / 消息区 —— 同上 + 常驻按键数 + 气泡两行制/折行/空态/滚到底
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r26-reprobe-ui3-20260923.mjs
 */

export default {
  name: 'R26-复测-坐标键位布局v2',
  check: async (page) => {
    const out = {};
    out.env = await page.evaluate(() => ({ cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio }));

    /* ---------- 设置页(存储)：量完立刻点「看明细」 ---------- */
    out.settings = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1500));
      const cards = [...document.querySelectorAll('#tab-settings .card')];
      const card = cards.filter((c) => /本地占用：/.test(c.textContent)).pop() || [...cards].pop();
      card.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 500));
      const rows = [...card.children];
      const rowOf = (re) => rows.find((x) => re.test(x.textContent)) || null;
      const btnOf = (re) => [...card.querySelectorAll('button')].find((b) => re.test(b.textContent)) || null;
      const chrome = () => ({ top: document.getElementById('topbar'), key: document.getElementById('keybar'), comp: document.getElementById('composer') });
      const measure = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const c = chrome();
        const cov = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        return {
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight, ge44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit))), hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByChrome: cov(c.top) || cov(c.key) || cov(c.comp), clipped: el.scrollWidth > el.clientWidth + 1,
          text: String(el.textContent).replace(/\s+/g, ' ').trim().slice(0, 64)
        };
      };
      const targets = { '本地占用行': rowOf(/本地占用：/), '原生侧行': rowOf(/原生侧/), '看明细键': btnOf(/看明细/), '清理键': btnOf(/清理/) };
      const coords = {}; Object.keys(targets).forEach((k) => { coords[k] = measure(targets[k]); });
      const vis = rows.map((x) => ({ r: x.getBoundingClientRect(), t: x.textContent.trim().slice(0, 12) })).filter((x) => x.r.height > 0).sort((a, b) => a.r.top - b.r.top);
      const gaps = []; for (let i = 1; i < vis.length; i += 1) gaps.push(Math.round(vis[i].r.top - vis[i - 1].r.bottom));
      /* 量完立刻在同一拍里点（返回坐标，CDP 紧接着点） */
      const b = btnOf(/看明细/);
      const cardTextBefore = card.textContent.replace(/\s+/g, ' ').trim().length;
      window.__tap = b ? (() => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), tag: b.tagName, hitSelf: (() => { const h = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return !!(h && (h === b || b.contains(h))); })() }; })() : null;
      return { coords: coords, gapsPx: gaps, minGapPx: gaps.length ? Math.min.apply(null, gaps) : null, cardTextBefore: cardTextBefore, tap: window.__tap, cardY: Math.round(card.getBoundingClientRect().y) };
    });

    if (out.settings.tap && out.settings.tap.hitSelf) {
      await page.tap(out.settings.tap.x, out.settings.tap.y);
      await page.waitForTimeout(1000);
      out.afterTap = await page.evaluate(() => {
        const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用/.test(c.textContent)).pop();
        const t = card ? card.textContent.replace(/\s+/g, ' ').trim() : '';
        return { cardTextAfter: t.length, grew: t.length > 0, detailKeys: (t.match(/[a-z]+[.][a-z0-9._-]+/gi) || []).slice(0, 6), head: t.slice(0, 100) };
      });
    } else { out.afterTap = { skipped: '看明细键不可命中或不在可视区', tap: out.settings.tap }; }

    /* ---------- 聊天页-群聊：量完立刻点「身份键」 ---------- */
    out.group = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 900));
      HP.Talk.msgs = [1, 2, 3].map((k) => ({ id: 7000 + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R26', body: '短' + k, at: 1790120000 + k }));
      const s = document.getElementById('tk-stream');
      const emptyText = String(s.textContent).trim().slice(0, 20);
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const page = document.getElementById('tab-group');
      const chrome = () => ({ top: document.getElementById('topbar'), key: document.getElementById('keybar'), comp: document.getElementById('composer') });
      const measure = (el, label) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const c = chrome();
        const cov = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        return { label: label, px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight, ge44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit))), hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByChrome: cov(c.top) || cov(c.key) || cov(c.comp) };
      };
      const coords = {
        '群聊抬头': measure(page.querySelector('.tk-title'), '抬头'),
        '喊话输入框': measure(document.getElementById('tk-shoutin'), '输入框'),
        '广播键': measure(document.getElementById('tk-shoutok'), '广播键'),
        '身份键': measure(document.getElementById('tk-whosay2'), '身份键'),
        '投递台账键': measure(document.getElementById('tk-delivbtn'), '台账键'),
        '消息区': measure(document.getElementById('tk-stream'), '消息区')
      };
      const bubs = [...s.querySelectorAll('.tk-bub')];
      const bubInfo = bubs.map((b) => { const r = b.getBoundingClientRect(); const kids = [...b.children].map((k) => Math.round(k.getBoundingClientRect().height)); return { h: Math.round(r.height), w: Math.round(r.width), childHeights: kids, overflowX: b.scrollWidth > b.clientWidth + 1 }; });
      const buttons = [...page.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0);
      const who = document.getElementById('tk-whosay2');
      const wr = who.getBoundingClientRect();
      window.__tapWho = { x: Math.round(wr.x + wr.width / 2), y: Math.round(wr.y + wr.height / 2), before: String(who.textContent).trim(), hitSelf: (() => { const h = document.elementFromPoint(Math.round(wr.x + wr.width / 2), Math.round(wr.y + wr.height / 2)); return !!(h && (h === who || who.contains(h))); })() };
      return { coords: coords, visibleButtons: buttons.length, buttonLabels: buttons.map((b) => String(b.textContent).trim().slice(0, 8)), streamEmptyText: emptyText, bubbles3: bubInfo, streamGap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), tapWho: window.__tapWho };
    });

    if (out.group.tapWho && out.group.tapWho.hitSelf) {
      await page.tap(out.group.tapWho.x, out.group.tapWho.y);
      await page.waitForTimeout(800);
      out.afterTapWho = await page.evaluate(() => ({ text: String(document.getElementById('tk-whosay2').textContent).trim(), asWho: HP.Talk.asWho }));
    } else { out.afterTapWho = { skipped: '身份键不可命中' }; }
    return out;
  }
};
