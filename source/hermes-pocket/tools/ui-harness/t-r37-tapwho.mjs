/* R-37 验收探针：单聊抬头 + 他的气泡可点开信息窗，8px 位移守卫，我的气泡不挂
 * 走真页面（HP.Talk.openRole → paintRole/paintChat 真渲染），读真 DOM 与真事件。
 * 事件构造：真机上 tap 是 touchstart + MouseEvent('click')，这里按同样的形状派发。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r37-tapwho.mjs
 */
export default {
  name: 'R-37 验收：抬头/他的气泡/live 追加都能点开信息窗、我的气泡不挂、位移 >8px 不触发',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      HP.Talk.pullRoleOutput = () => { };
      HP.Talk.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline', online: true }];
      /* 让 paintChat 拿到两条记录（1 条他说的 + 1 条我说的）+ 1 条 live 追加 */
      HP.Talk.live = { 'pipeline.tester': ['（live 追加的）他在会话里回的话'] };
      window.__r37Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.thread') {
          const data = { role: 'pipeline.tester', count: 2, items: [
            { id: 1, who: 'him', body: '他说的第一条', at: Math.floor(Date.now() / 1000) },
            { id: 2, who: 'me', body: '我说的第二条', at: Math.floor(Date.now() / 1000) }
          ] };
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: data }) }), 20);
          return;
        }
        return window.__r37Orig(t);
      };
      HP.App.showBoard('talk');
    });
    await page.waitForTimeout(200);
    await page.evaluate(async () => { await HP.Talk.openRole('pipeline.tester'); });
    await page.waitForTimeout(600);

    /* 派事件的小工具：touchstart(x,y) → MouseEvent('click', x2,y2)（真机 tap 的形状） */
    await page.evaluate(() => {
      window.__r37Tap = (el, x, y, x2, y2) => {
        const mkTouch = (type, tx, ty) => {
          const t = new Touch({ identifier: 1, target: el, clientX: tx, clientY: ty });
          return new TouchEvent(type, { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true });
        };
        el.dispatchEvent(mkTouch('touchstart', x, y));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x2, clientY: y2 }));
      };
      window.__r37Sheet = () => {
        const dlg = document.getElementById('tk-sheet');
        if (!dlg) return { 开着: false };
        const rows = [...dlg.querySelectorAll('.tk-sheetrow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim());
        return { 开着: true, 全名: (rows.find((r) => r.indexOf('全名') === 0) || ''), 行数: rows.length };
      };
    });

    /* ① 抬头点了开窗 */
    out['①_抬头'] = await page.evaluate(() => {
      const el = document.querySelector('.tk-title');
      const has = el && el.getAttribute('data-tapwho') === '1';
      window.__r37Tap(el, 100, 100, 102, 101);           /* 位移 2px＝真点 */
      const s = window.__r37Sheet();
      HP.Talk.closeSheet();
      return { 抬头挂了tap: has, 点了开窗: s.开着, 全名行: s.全名 };
    });

    /* ② 他的气泡：点开窗；③ 我的气泡：点了不开窗 */
    out['②_他的气泡'] = await page.evaluate(() => {
      const bu = [...document.querySelectorAll('#tk-chat .tk-bub.him')][0];
      const has = bu && bu.getAttribute('data-tapwho') === '1';
      const df = bu && bu.getAttribute('data-from');
      window.__r37Tap(bu, 120, 200, 121, 200);
      const s = window.__r37Sheet();
      HP.Talk.closeSheet();
      return { 挂了吗: has, dataFrom: df, 点了开窗: s.开着, 全名行: s.全名 };
    });
    out['③_我的气泡'] = await page.evaluate(() => {
      const bu = [...document.querySelectorAll('#tk-chat .tk-bub.me')][0];
      const has = bu ? bu.getAttribute('data-tapwho') === '1' : null;
      if (bu) window.__r37Tap(bu, 120, 300, 121, 300);
      const s = window.__r37Sheet();
      if (s.开着) HP.Talk.closeSheet();
      return { 我的气泡挂了tap: has, 点了开窗: s.开着, 气泡数: document.querySelectorAll('#tk-chat .tk-bub.me').length };
    });

    /* ④ live 追加那批：也该挂 */
    out['④_live追加'] = await page.evaluate(() => {
      const bus = [...document.querySelectorAll('#tk-chat .tk-bub.him')];
      const last = bus[bus.length - 1];
      const has = last && last.getAttribute('data-tapwho') === '1';
      window.__r37Tap(last, 130, 400, 131, 400);
      const s = window.__r37Sheet();
      HP.Talk.closeSheet();
      return { 挂了吗: has, 点了开窗: s.开着, him气泡数: bus.length, 那一句: last ? last.innerText.replace(/\s+/g, ' ').trim().slice(0, 24) : null };
    });

    /* ⑤ 8px 守卫：滑了 20px 不触发；只滑 3px 触发 */
    out['⑤_位移守卫'] = await page.evaluate(() => {
      const el = document.querySelector('.tk-title');
      window.__r37Tap(el, 100, 100, 120, 100);           /* 位移 20px＝滚动 */
      const swiped = window.__r37Sheet();
      if (swiped.开着) HP.Talk.closeSheet();
      window.__r37Tap(el, 100, 100, 103, 100);           /* 位移 3px＝真点 */
      const tapped = window.__r37Sheet();
      HP.Talk.closeSheet();
      return { 滑20px开窗了吗: swiped.开着, 点3px开窗了吗: tapped.开着 };
    });

    /* ⑥ 不碰滚动与 touchmove：源码里没有 touchmove / preventDefault（只读检查） */
    out['⑥_没碰滚动'] = await page.evaluate(() => {
      const src = HP.Talk.tapWho.toString();
      return {
        有touchmove: /touchmove/.test(src), 有preventDefault: /preventDefault/.test(src),
        只挂click: /addEventListener\('click'/.test(src),
        有touchstart只记坐标: /addEventListener\('touchstart'/.test(src) && /passive:\s*true/.test(src)
      };
    });

    /* ⑦ 群聊那套没动（原样保留） */
    out['⑦_群聊未动'] = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 400));
      const s = document.getElementById('tk-stream');
      const bu = s && s.querySelector('.tk-bub');
      return { 群聊流在: !!s, 群聊气泡仍在: !!bu, 群聊气泡没错挂tapwho: !(bu && bu.getAttribute('data-tapwho') === '1') };
    });

    await page.waitForTimeout(200);
    out['⑧_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
