/* R-58 验收探针：终端默认收起（容器高度 0）、点按钮展开（可见 + 离底 ≤2px）、再收起高度收回、
 * 多次开合不残留不重复建会话；同时给常驻按键数与"说明类文案"读数。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r58-term-toggle.mjs
 */
export default {
  name: 'R-58 验收：终端默认收起、按钮展开即贴底、多次开合不残留',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      window.__opens = 0;
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'session.open') window.__opens++;      /* 连接数读：不该因为开合而增加 */
        return window.__orig(t);
      };
      window.__pane = () => {
        const p = document.getElementById('panner');
        const b = document.getElementById('btn-term');
        const r = p.getBoundingClientRect();
        const vp = document.querySelector('.xterm-viewport');
        return {
          收起态: document.body.classList.contains('term-hide'),
          终端容器高: Math.round(r.height),
          按钮字: b ? b.textContent : null,
          按钮高: b ? Math.round(b.getBoundingClientRect().height) : null,
          离底: vp ? Math.round(vp.scrollHeight - vp.clientHeight - vp.scrollTop) : null,
          xterm数: document.querySelectorAll('#termhost .xterm').length
        };
      };
    });

    await page.evaluate(async () => {
      HP.App.sessionId = HP.App.sessionId || 's1';
      HP.App.state = 'connected';
      HP.App.showBoard('host');
      for (let i = 1; i <= 200; i++) HP.App.term.write('R-58 行 ' + i + '\r\n');
      await new Promise((r) => setTimeout(r, 300));
      window.__opens0 = window.__opens;
    });
    await page.waitForTimeout(400);

    /* ① 默认态：终端容器不可见/高度 0 + 常驻按键数 + 说明类文案 */
    out['01_默认收起'] = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#topbar .tb-btn')].map((b) => (b.textContent || b.getAttribute('aria-label') || '').trim());
      const stage = document.getElementById('stage');
      const tx = [...stage.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean);
      return {
        pane: window.__pane(),
        顶栏按键: btns, 顶栏按键数: btns.length,
        'stage 里的裸文字（说明文案）': tx,
        连接次数: window.__opens - window.__opens0
      };
    });

    /* ② 展开 ⇒ 可见 + 贴底；再收起 ⇒ 高度收回（前后数） */
    out['02_展开与收起'] = await page.evaluate(async () => {
      const before = window.__pane();
      document.getElementById('btn-term').click();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const 展开后 = window.__pane();
      await new Promise((r) => setTimeout(r, 300));
      const 展开后稳住 = window.__pane();
      document.getElementById('btn-term').click();
      await new Promise((r) => setTimeout(r, 200));
      const 收起后 = window.__pane();
      return { before, 展开后, 展开后稳住, 收起后 };
    });

    /* ③ 多次开合（3 次）⇒ 不残留（DOM/高度一致）、不重复建会话 */
    out['03_多次开合'] = await page.evaluate(async () => {
      const seq = [];
      for (let i = 0; i < 3; i++) {
        HP.App.toggleTerm(true);
        await new Promise((r) => setTimeout(r, 150));
        seq.push(window.__pane());
        HP.App.toggleTerm(false);
        await new Promise((r) => setTimeout(r, 150));
        seq.push(window.__pane());
      }
      const onStates = seq.filter((s) => !s.收起态);
      const offStates = seq.filter((s) => s.收起态);
      return {
        序列: seq.map((s) => (s.收起态 ? '收起(' + s.终端容器高 + ')' : '展开(' + s.终端容器高 + ')')),
        展开时高度都一致: new Set(onStates.map((s) => s.终端容器高)).size === 1,
        xterm数都一致: new Set(seq.map((s) => s.xterm数)).size === 1,
        收起时高度都为0: offStates.every((s) => s.终端容器高 === 0),
        连接次数: window.__opens - window.__opens0
      };
    });

    /* ④ 展开那一刻贴底（离底 ≤2px） */
    out['04_展开即贴底'] = await page.evaluate(async () => {
      HP.App.toggleTerm(true);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const 展开瞬间 = window.__pane();
      await new Promise((r) => setTimeout(r, 500));
      const 半秒后 = window.__pane();
      return { 展开瞬间, 半秒后 };
    });

    out['05_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
