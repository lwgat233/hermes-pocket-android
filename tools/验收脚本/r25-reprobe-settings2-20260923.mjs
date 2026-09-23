/* R-25 复测 · 板块A：设置页省电块 —— 坐标/键位（按实际 DOM 找）+ 三档生效读数
 * 设置项是原生 <select>，页面级 CDP 点不开系统选择器：
 *   · 「真实触摸能否命中/唤起」由坐标命中测试 + adb dumpsys window 另证；
 *   · 「三档是否真生效」用 App 自己的 setPref 切档后读 HP.Talk.pollDelay()（写明是设置通道）。
 */
export default {
  name: 'R25-复测-板块A-设置页省电',
  check: async (page) => {
    const out = {};
    out.env = await page.evaluate(() => ({ cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio }));

    out.block = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1500));
      const statusCard = [...document.querySelectorAll('#tab-settings .card')].find((c) => c.textContent.trim().startsWith('省电')) || null;
      const selAll = [...document.querySelectorAll('#tab-settings select')];
      const pollSel = selAll.find((s) => /省电档|最省：|实时档/.test(s.textContent)) || null;
      const modeSel = selAll.find((s) => /息屏时省电/.test(s.textContent)) || null;
      const fieldsCard = pollSel ? pollSel.closest('.card') : null;
      const scroller = (fieldsCard || document.body).closest('.panel-body') || document.scrollingElement;
      if (pollSel && scroller) {
        const top = pollSel.getBoundingClientRect().top + scroller.scrollTop - 140;
        scroller.scrollTop = Math.max(0, top);
        await new Promise((r) => setTimeout(r, 500));
      }
      const chromeOf = () => ({ top: document.getElementById('topbar'), key: document.getElementById('keybar'), comp: document.getElementById('composer') });
      const measure = (el, label) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const c = chromeOf();
        const cov = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        return { label: label, px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, centerPx: { x: cx, y: cy },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight, ge44: r.height >= 44,
          hitIsSelf: !!(hit && (hit === el || el.contains(hit))),
          hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByChrome: cov(c.top) || cov(c.key) || cov(c.comp), clipped: el.scrollWidth > el.clientWidth + 1,
          text: String(el.textContent).replace(/\s+/g, ' ').trim().slice(0, 56) };
      };
      const subOf = (re) => (statusCard ? [...statusCard.querySelectorAll('.sub')].find((x) => re.test(x.textContent)) : null);
      const coords = {
        '省电模式(select)': measure(modeSel, '省电模式'),
        '聊天轮询档位(select)': measure(pollSel, '轮询档位'),
        '省电读数行': measure(subOf(/当前：/), '读数行'),
        '聊天轮询读数行': measure(subOf(/聊天轮询：/), '轮询读数行')
      };
      let selTap = null;
      if (pollSel) { const r = pollSel.getBoundingClientRect(); const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2); const h = document.elementFromPoint(cx, cy); selTap = { x: cx, y: cy, tag: pollSel.tagName, hitSelf: !!(h && (h === pollSel || pollSel.contains(h))) }; }
      return { coords: coords, selTap: selTap, selects: selAll.length, statusText: String(statusCard ? statusCard.textContent : '').replace(/\s+/g, ' ').trim().slice(0, 110), scrollTop: scroller ? Math.round(scroller.scrollTop) : null };
    });

    out.modes = await page.evaluate(async () => {
      const res = [];
      for (const m of ['slow30', 'pause', 'realtime']) {
        try { HP.App.setPref('talkPollSave', m); } catch (e) {}
        await new Promise((r) => setTimeout(r, 250));
        let pref = null; try { pref = HP.App.pref('talkPollSave', 'slow30'); } catch (e) {}
        HP.Talk._powerSave = true;
        res.push({ mode: m, prefNow: pref, delayMsInSave: HP.Talk.pollDelay(), stats: HP.Talk.pollStats() });
        HP.Talk._powerSave = false;
      }
      try { HP.App.setPref('talkPollSave', 'slow30'); } catch (e) {}
      await new Promise((r) => setTimeout(r, 200));
      return { rows: res, restored: (() => { try { return HP.App.pref('talkPollSave', 'slow30'); } catch (e) { return null; } })() };
    });

    out.storageRegression = await page.evaluate(() => { const r = HP.Cache.report(); return { totalKB: +(r.total / 1024).toFixed(1), keys: r.count, degraded: r.degraded }; });
    const c = out.block.coords;
    out.verdict = {
      '坐标:4项全命中且不遮挡': ['省电模式(select)', '聊天轮询档位(select)', '省电读数行', '聊天轮询读数行'].every((k) => c[k] && c[k].hitIsSelf && !c[k].coveredByChrome),
      '三档生效(省电时 30s/停/2.5s)': (() => { const r = out.modes.rows; return r[0].delayMsInSave === 30000 && r[1].delayMsInSave === 0 && r[2].delayMsInSave === 2500; })(),
      '读数行可读': /聊天轮询：每/.test(String((c['聊天轮询读数行'] || {}).text || '')),
      '选择器命中自己(真触摸预备)': !!(out.block.selTap && out.block.selTap.hitSelf)
    };
    return out;
  }
};
