/* R-39 验收探针（乙案）：内层滚动容器 #tk-chat 的 padding-bottom 跟着粘性条高走，末条气泡不再被压。
 * 读数：末条下沿 / 与粘性条重叠 px / 中心元素命中谁 / #tk-chat 的 padding-bottom 实际值 / --sayline-h。
 * 判据：内层滚到底后点**最后一条气泡**能开信息窗（R-37 的 tapWho）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r39-pad.mjs
 */
export default {
  name: 'R-39 验收：末条气泡不被粘性条压住（padding-bottom 跟着条高走）',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.__items = [];
      for (let i = 1; i <= 14; i++) window.__items.push({ id: i, who: (i % 2 ? 'him' : 'me'), body: '第 ' + i + ' 条（用来把内层滚出可滚高度）', at: 1790257000 + i });
      window.__items.push({ id: 15, who: 'him', body: '最后一条（他说的：压住的话就是它）', at: 1790257020 });   /* 末条＝他的，判据才成立 */
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.roles') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { channels: {}, scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.tester', name: 'tester', title: '测试者', online: true }] }] } }) }), 10); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { sessions: [] } }) }), 10); return; }
        if (m && m.t === 'talk.thread') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { role: 'pipeline.tester', count: window.__items.length, items: window.__items } }) }), 10); return; }
        return window.__orig(t);
      };
      HP.App.showBoard('talk');
    });
    await page.waitForTimeout(600);
    await page.evaluate(async () => { await HP.Talk.openRole('pipeline.tester'); });
    await page.waitForTimeout(900);

    /* 把内层滚到底，量四条读数 */
    out['01_四条读数'] = await page.evaluate(() => {
      const box = document.getElementById('tk-chat');
      const line = document.getElementById('tk-sayline');
      const bubbles = [...box.querySelectorAll('[data-bubble="1"], .tk-bub, .tk-bubble')];
      const last = bubbles[bubbles.length - 1];
      if (!box || !line || !last) return { error: '缺元素', 气泡数: bubbles.length, box: !!box, line: !!line };
      box.scrollTop = box.scrollHeight;                 /* 只滚内层到底 */
      const lb = last.getBoundingClientRect();
      const ln = line.getBoundingClientRect();
      const cx = lb.left + lb.width / 2, cy = lb.top + lb.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const bb = hit ? (hit.closest('[data-bubble="1"], .tk-bub, .tk-bubble') || hit) : null;
      return {
        气泡数: bubbles.length,
        末条下沿: Math.round(lb.bottom),
        粘性条上沿: Math.round(ln.top),
        重叠px: Math.round(Math.max(0, lb.bottom - ln.top)),
        中心命中: hit ? (hit.className || hit.tagName) : null,
        中心命中的是末条气泡吗: !!(bb && bb === last),
        内层paddingBottom: getComputedStyle(box).paddingBottom,
        sayline高: Math.round(ln.height),
        变量sayline_h: getComputedStyle(document.documentElement).getPropertyValue('--sayline-h').trim()
      };
    });

    /* 判据：点最后一条气泡 → 开信息窗（R-37 tapWho） */
    out['02_点末条开窗'] = await page.evaluate(async () => {
      const box = document.getElementById('tk-chat');
      const bubbles = [...box.querySelectorAll('[data-bubble="1"], .tk-bub, .tk-bubble')];
      const last = bubbles[bubbles.length - 1];
      if (!last) return { error: '没气泡' };
      const r = last.getBoundingClientRect();
      const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const el = (target && target.closest && target.closest('[data-bubble="1"], .tk-bub, .tk-bubble')) || last;
      el.click();
      await new Promise((x) => setTimeout(x, 350));
      const sheet = document.getElementById('tk-sheet');
      return {
        点的是: el === last ? '末条气泡本身' : '别的元素（' + (target && target.className) + '）',
        信息窗开了吗: !!sheet,
        窗里是谁: sheet ? (sheet.querySelector('.name') || {}).textContent : null
      };
    });

    /* 边角：切到群聊页量一下（共用规则同样适用；群聊流是 #tk-stream，无粘性条 ⇒ 不该有额外内边距挤压） */
    out['03_群聊不受影响'] = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((x) => setTimeout(x, 500));
      const st = document.getElementById('tk-stream');
      return { 在: !!st, paddingBottom: st ? getComputedStyle(st).paddingBottom : null, 气泡数: st ? st.querySelectorAll('[data-bubble="1"], .tk-bub, .tk-bubble').length : 0 };
    });

    out['04_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
