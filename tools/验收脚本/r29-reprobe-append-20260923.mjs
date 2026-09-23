/* R-29 复测 · 运行 A2：把 ②③ 的判据钉死到「可观测事实」上
 *  A2-1 等高追加（在底部，旧气泡与新增气泡一样高）→ 应当继续钉底
 *  A2-2 变矮追加（在底部，被裁掉的旧气泡比新增的高）→ 记录真实读数（这是本轮最值得报的一段）
 *  A2-3 上翻后用**可见锚点**（视口里那个气泡的 rect.top）判「不被抢回」——
 *       scrollTop 绝对值会因为「顶部裁旧 + 补偿」而变化，那不叫被抢回；可见内容不动才算。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r29-reprobe-append-20260923.mjs
 */
const seed = (n, len, base) => 'Array.from({length:' + n + '},(_,k)=>({id:' + base + '+k,kind:"broadcast",from:"pipeline.author",to:null,topic:"R29",body:"M"+(' + base + '+k)+"x".repeat(' + len + '),at:1790120000+k}))';

export default {
  name: 'R29-复测-追加与锚点-A2',
  check: async (page) => {
    const out = {};
    const reset = (n, len, base) => page.evaluate(async (expr) => {
      const rows = Function('return ' + expr)();
      HP.Talk.msgs = rows;
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 500));
      const s = document.getElementById('tk-stream');
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined; s._pinned = undefined; s._newCount = 0;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      return true;
    }, seed(n, len, base));
    const read = () => page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return {
        gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop),
        scrollTop: Math.round(s.scrollTop), scrollHeight: s.scrollHeight, clientHeight: s.clientHeight,
        children: s.children.length, pinned: !!s._pinned, newCount: s._newCount || 0,
        chipDisplay: chip ? getComputedStyle(chip).display : null, chipText: chip ? chip.textContent : null
      };
    });

    /* A2-1 等高追加 */
    await reset(80, 40, 1000);
    out.T1_before = await read();
    out.T1_after = await page.evaluate(async () => {
      const s = document.getElementById('tk-stream');
      const kids = [...s.children]; const h = kids[kids.length - 1].offsetHeight;
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      const len = (HP.Talk.msgs[0].body.length);
      for (let k = 1; k <= 5; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: 'N' + k + 'y'.repeat(len), at: 1790130000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      return { newBubbleHeight: h };
    });

    /* A2-2 变矮追加：先回到真实底部，再喂 5 条短的新消息 */
    out.T2_after = await page.evaluate(async () => {
      const s = document.getElementById('tk-stream');
      s.scrollTop = s.scrollHeight; s._pinned = true; s._newCount = 0; HP.Talk.paintBackChip(s);
      await new Promise((r) => setTimeout(r, 200));
      const before = { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop) };
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= 5; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: '短' + k, at: 1790140000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gapBefore: before.gap, chipText: chip ? chip.textContent : null, chipDisplay: chip ? getComputedStyle(chip).display : null };
    });

    /* A2-3 上翻后用可见锚点判「不被抢回」 */
    await reset(80, 40, 2000);
    const sr = await page.evaluate(() => { const s = document.getElementById('tk-stream'); const r = s.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    await page.swipe(sr.x, sr.y, 500);
    await page.waitForTimeout(500);
    const anchor = await page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const r = s.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      let n = el; while (n && n !== s && !n.getAttribute('data-tk-id')) n = n.parentNode;
      return n && n !== s ? { id: Number(n.getAttribute('data-tk-id')), top: Math.round(n.getBoundingClientRect().top), scrollTop: Math.round(s.scrollTop) } : { id: null, top: null, scrollTop: Math.round(s.scrollTop) };
    });
    out.T3_anchorBefore = anchor;
    out.T3_after = await page.evaluate(async (aid) => {
      const s = document.getElementById('tk-stream');
      const el = [...s.children].find((c) => Number(c.getAttribute('data-tk-id')) === aid) || null;
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= 3; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'pipeline.tester', to: null, topic: 'R29', body: 'Q' + k + 'z'.repeat(40), at: 1790150000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const el2 = [...s.children].find((c) => Number(c.getAttribute('data-tk-id')) === aid) || null;
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return {
        anchorStillAlive: !!el2, anchorTopBefore: el ? Math.round(el.getBoundingClientRect().top) : null,
        anchorTopAfter: el2 ? Math.round(el2.getBoundingClientRect().top) : null,
        scrollTopAfter: Math.round(s.scrollTop), chipText: chip ? chip.textContent : null, newCount: s._newCount || 0
      };
    }, anchor.id);

    const t1 = out.T1_after, t2 = out.T2_after, t3 = out.T3_after;
    const t1s = await read();
    out.T1_state = t1s;
    out.verdict = {
      'A2-1等高追加仍钉底': t1s.gap === 0 && t1s.pinned === true && t1s.newCount === 0,
      'A2-2变矮追加后仍在底部': t2.gapBefore === 0 && t2.chipDisplay === 'none',
      'A2-3老气泡还在': t3.anchorStillAlive === true,
      'A2-3可见锚点不动(±2px)': t3.anchorTopBefore != null && t3.anchorTopAfter != null && Math.abs(t3.anchorTopAfter - t3.anchorTopBefore) <= 2,
      'A2-3入口文案': /回到底部（新 3 条）/.test(String(t3.chipText)) && t3.newCount === 3
    };
    return out;
  }
};
