/* R-25 复测 · 板块A：设置页（省电设置项 talkPollSave 三档 + 读数行）+ 坐标/键位 + R-26 存储读数回归
 * 真触摸：点开「聊天实时性 vs 省电」这一行 → 选档 → 读回 pref 与读数行（证明三档真能切、真生效）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r25-reprobe-settings-20260923.mjs
 */
export default {
  name: 'R25-复测-板块A-设置页省电',
  check: async (page) => {
    const out = {};
    out.env = await page.evaluate(() => ({ cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio }));

    out.open = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1500));
      const card = [...document.querySelectorAll('#tab-settings .card')].find((c) => /省电[\s\S]{0,200}(省电模式|心跳)/.test(c.textContent)) || null;
      if (card) card.scrollIntoView({ block: 'start' });
      await new Promise((r) => setTimeout(r, 500));
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
          coveredByChrome: cov(c.top) || cov(c.key) || cov(c.comp), clipped: el.scrollWidth > el.clientWidth + 1,
          text: String(el.textContent).replace(/\s+/g, ' ').trim().slice(0, 70) };
      };
      const pick = (re) => [...card.querySelectorAll('div,label,button')].filter((x) => re.test(x.textContent) && x.children.length <= 3).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0] || null;
      const coords = {
        '省电模式行': measure(pick(/省电模式/), '省电模式'),
        '聊天轮询档位行': measure(pick(/聊天实时性 vs 省电/), '轮询档位'),
        '息屏延迟行': measure(pick(/息屏后延迟/), '息屏延迟'),
        '立刻省电一次键': measure([...card.querySelectorAll('button')].find((b) => /立刻省电/.test(b.textContent)), '立刻省电键'),
        '省电读数行': measure([...card.querySelectorAll('.sub,.kv')].find((x) => /心跳=|省电中|正常/.test(x.textContent)), '读数行')
      };
      const prefNow = (() => { try { return HP.App.pref('talkPollSave', 'slow30'); } catch (e) { return null; } })();
      const row = pick(/聊天实时性 vs 省电/);
      window.__rowTap = row ? (() => { const r = row.getBoundingClientRect(); const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2); const h = document.elementFromPoint(cx, cy); return { x: cx, y: cy, hitSelf: !!(h && (h === row || row.contains(h))) }; })() : null;
      return { coords: coords, prefNow: prefNow, rowTap: window.__rowTap, powerLine: (() => { const t = (document.getElementById('tab-settings') || document.body).textContent.replace(/\s+/g, ' '); const m = t.match(/省电 当前[^。]{0,90}/) || t.match(/当前：正常[^。]{0,60}/); return m ? m[0] : null; })() };
    });

    /* 真触摸：点开档位行 → 选「最省」→ 读回 pref；再选「实时」→ 读回 pref；最后切回「省电档」 */
    const flow = [];
    const rowTap = out.open.rowTap;
    if (rowTap && rowTap.hitSelf) {
      for (const want of ['最省', '实时', '省电档']) {
        await page.tap(rowTap.x, rowTap.y);
        await page.waitForTimeout(700);
        const sheet = await page.evaluate(() => {
          const els = [...document.querySelectorAll('button, .opt, .row, [data-opt], .modal *, .sheet *')]
            .filter((x) => x.getBoundingClientRect().height > 0 && /省电档|最省|实时档/.test(x.textContent) && x.children.length <= 2);
          return els.map((x) => { const r = x.getBoundingClientRect(); return { t: String(x.textContent).replace(/\s+/g, ' ').trim().slice(0, 24), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), h: Math.round(r.height) }; });
        });
        const target = sheet.find((s) => s.t.indexOf(want) >= 0);
        if (target) { await page.tap(target.x, target.y); await page.waitForTimeout(700); }
        const after = await page.evaluate(() => ({ pref: (() => { try { return HP.App.pref('talkPollSave', 'slow30'); } catch (e) { return null; } })(), delay: HP.Talk.pollDelay() }));
        flow.push({ picked: want, optionsSeen: sheet.map((s) => s.t), prefAfter: after.pref, delayAfter: after.delay });
      }
    }
    out.flow = flow;

    out.storageRegression = await page.evaluate(() => {
      const r = HP.Cache.report();
      return { totalKB: +(r.total / 1024).toFixed(1), keys: r.count, degraded: r.degraded, writes: r.writes };
    });
    out.verdict = {
      '三档真能切(真触摸)': flow.length === 3 && flow[0].prefAfter === 'pause' && flow[1].prefAfter === 'realtime' && flow[2].prefAfter === 'slow30',
      '档位生效间隔(30s/2.5s)': (() => { const f = flow.find((x) => x.picked === '省电档'); const r = flow.find((x) => x.picked === '实时'); return !!f && !!r && f.delayAfter === 2500 && r.delayAfter === 2500; })(),
      '读数行可读': !!(out.open.coords['省电读数行'] && /心跳|省电|正常/.test(out.open.coords['省电读数行'].text || '')),
      '坐标:5项全命中且不遮挡': Object.keys(out.open.coords).every((k) => { const c = out.open.coords[k]; return c && c.hitIsSelf && !c.coveredByChrome; })
    };
    return out;
  }
};
