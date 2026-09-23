/* R-29 验收探针：群里/单聊的钉底与「⇣ 回到底部（新 N 条）」
 * 跑**真渲染代码**（HP.Talk 自己的 pinBottom / paintStream / paintGroup / paintChat），读真 DOM 尺寸。
 * 与作者定位探针 d-r29-scroll.mjs 的区别：这份量的是「改完之后应该怎样」（7 条判据逐条给读数）。
 *
 * 说明：本地测试台没有触摸输入，「用户上翻」用设置 scrollTop + 派发 scroll 事件替代
 *      （真代码就是靠这个 scroll 监听维护 box._pinned）；设备上的真触摸读数由 tester 做。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r29-pinbottom.mjs
 */
export default {
  name: 'R-29 验收：切群聊/新消息钉底、上翻不被抢回、⇣ 回到底部入口、单聊不退化',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });

    const out = {};
    const gap = (id) => page.evaluate((boxId) => {
      const s = document.getElementById(boxId);
      if (!s) return { 容器在: false };
      const last = s.lastChild;
      const inside = (() => {
        if (!last || last.nodeType !== 1) return null;
        const r = last.getBoundingClientRect(), b = s.getBoundingClientRect();
        return r.bottom <= b.bottom + 1 && r.top >= b.top - 1;
      })();
      return {
        容器在: true,
        scrollTop: Math.round(s.scrollTop),
        scrollHeight: s.scrollHeight,
        可视高度: s.clientHeight,
        离底部还差: Math.round(s.scrollHeight - s.clientHeight - s.scrollTop),
        在底部: (s.scrollHeight - s.clientHeight - s.scrollTop) <= 2,
        最后一条在可视区: inside
      };
    }, id);
    const chip = (boxId) => page.evaluate((id) => {
      const b = document.getElementById('tk-backchip-' + id);
      if (!b) return { 入口在: false };
      return { 入口在: true, 显示: b.style.display !== 'none', 文字: b.textContent, 新条数: Number(b.getAttribute('data-count') || 0) };
    }, boxId);

    /* ① 切到群聊栏目（与 app.js → Talk.onShow → render → paintGroup 同一条路） */
    await page.evaluate(() => {
      const T = HP.Talk;
      T.msgs = Array.from({ length: 40 }, (_, i) => ({
        id: i + 1,
        from: i % 3 === 0 ? 'owner.me' : 'pipeline.tester',
        kind: 'default', topic: '',
        body: '第 ' + (i + 1) + ' 条：' + '内容'.repeat(12),
        at: Math.floor(Date.now() / 1000) - (40 - i) * 60
      }));
      T.live = true;
      T.tab = 'group';
      HP.App.showBoard('group');
    });
    await page.waitForTimeout(350);
    out['①_切群聊后'] = await gap('tk-stream');

    /* ② 新消息到达（tick 里那条路调的就是 paintStream）——顺便看老节点有没有被重建 */
    out['②_新消息后'] = await page.evaluate(async () => {
      const T = HP.Talk;
      const s = document.getElementById('tk-stream');
      const firstBefore = s.firstChild;
      T.msgs.push({ id: 41, from: 'pipeline.tester', kind: 'default', topic: '', body: '第 41 条：刚到的消息', at: Math.floor(Date.now() / 1000) });
      T.paintStream();
      const s2 = document.getElementById('tk-stream');
      return {
        老节点还在: s2.firstChild === firstBefore,
        条数: s2.children.length
      };
    });
    out['②_新消息后_位置'] = await gap('tk-stream');

    /* ③ 手动上翻（真代码靠 scroll 监听知道用户走了）→ 再来一条：位置不许被抢回，且要给回程入口 */
    out['③_上翻后'] = await page.evaluate(async () => {
      const T = HP.Talk;
      const s = document.getElementById('tk-stream');
      s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2);
      s.dispatchEvent(new Event('scroll'));                    /* 本地没有触摸，用 scroll 事件代替手指 */
      await new Promise((r) => setTimeout(r, 80));
      const before = Math.round(s.scrollTop);
      T.msgs.push({ id: 42, from: 'pipeline.tester', kind: 'default', topic: '', body: '第 42 条：上翻期间到的', at: Math.floor(Date.now() / 1000) });
      T.paintStream();
      const s2 = document.getElementById('tk-stream');
      const b = document.getElementById('tk-backchip-tk-stream');
      return {
        上翻时的位置: before,
        重画后位置: Math.round(s2.scrollTop),
        位置被改动: Math.abs(s2.scrollTop - before) > 2,
        入口显示: !!b && b.style.display !== 'none',
        入口文字: b ? b.textContent : '',
        新条数: b ? Number(b.getAttribute('data-count') || 0) : null
      };
    });

    /* ④ 点那个入口：真代码里是 click 处理器（设备上的真触摸由 tester 点） */
    out['④_点回到底部'] = await page.evaluate(async () => {
      const b = document.getElementById('tk-backchip-tk-stream');
      b.click();
      await new Promise((r) => setTimeout(r, 250));
      const s = document.getElementById('tk-stream');
      const b2 = document.getElementById('tk-backchip-tk-stream');
      return {
        离底部还差: Math.round(s.scrollHeight - s.clientHeight - s.scrollTop),
        入口显示: b2.style.display !== 'none',
        新条数: Number(b2.getAttribute('data-count') || 0)
      };
    });

    /* ⑤ 单聊对照：仍钉底（不因这次改动退化）；上翻后也不被抢回 */
    out['⑤_单聊'] = await page.evaluate(async () => {
      const T = HP.Talk;
      T.pullRoleOutput = () => { };                             /* talk.js 里这个函数缺定义（作者已单列缺陷），这里补空壳只为量滚动 */
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 320));
      const host = document.getElementById('tab-talk');
      const box = document.createElement('div');
      box.className = 'tk-chat'; box.id = 'tk-chat';
      box.style.maxHeight = '200px'; box.style.overflowY = 'auto';
      host.appendChild(box);
      const r = { full_name: 'pipeline.tester', title: '测试者' };
      T.live = { 'pipeline.tester': Array.from({ length: 30 }, (_, i) => '他的话 ' + (i + 1) + ' ' + 'x'.repeat(40)) };
      await T.paintChat(r);
      const b1 = document.getElementById('tk-chat');
      const okBottom = (b1.scrollHeight - b1.clientHeight - b1.scrollTop) <= 2;
      /* 上翻后重画：位置不该被抢回 */
      b1.scrollTop = Math.round((b1.scrollHeight - b1.clientHeight) / 2);
      b1.dispatchEvent(new Event('scroll'));
      await new Promise((r2) => setTimeout(r2, 80));
      const before = Math.round(b1.scrollTop);
      await T.paintChat(r);
      const b2 = document.getElementById('tk-chat');
      const chip2 = document.getElementById('tk-backchip-tk-chat');
      return {
        初次渲染在底部: okBottom,
        上翻后位置被改动: Math.abs(b2.scrollTop - before) > 2,
        上翻后入口显示: !!chip2 && chip2.style.display !== 'none'
      };
    });

    /* ⑥ 消息不足一屏（3 条）：滚不动也不报错 */
    out['⑥_不足一屏'] = await page.evaluate(async () => {
      const T = HP.Talk;
      T.msgs = Array.from({ length: 3 }, (_, i) => ({ id: 900 + i, from: 'owner.me', kind: 'default', topic: '', body: '短消息 ' + (i + 1), at: Math.floor(Date.now() / 1000) }));
      T.tab = 'group';
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 300));
      const s = document.getElementById('tk-stream');
      return { 容器在: !!s, 条数: s ? s.children.length : -1, 可滚动: s ? s.scrollHeight > s.clientHeight : null, scrollTop: s ? s.scrollTop : null };
    });

    /* ⑦ 上限裁旧：120 条只留 80 */
    out['⑦_上限裁旧'] = await page.evaluate(async () => {
      const T = HP.Talk;
      T.msgs = Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, from: 'pipeline.tester', kind: 'default', topic: '', body: '第 ' + (i + 1) + ' 条 ' + 'y'.repeat(30), at: Math.floor(Date.now() / 1000) }));
      T.paintStream();
      const s = document.getElementById('tk-stream');
      return { 条数: s.children.length, 在底部: (s.scrollHeight - s.clientHeight - s.scrollTop) <= 2 };
    });

    /* ⑧ 频道页（talk 栏目，没有 #tk-stream）行为不变：能画出来、不炸 */
    out['⑧_频道页'] = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 400));
      const t = document.getElementById('tab-talk');
      return { 有内容: !!t && t.children.length > 0, 文本片段: (t ? t.textContent : '').slice(0, 40) };
    });

    await page.waitForTimeout(300);
    out['⑨_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
