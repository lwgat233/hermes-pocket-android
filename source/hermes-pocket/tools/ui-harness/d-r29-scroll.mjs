/* R-29（群聊不自动到最下面）定位探针：在本地测试台上跑**真渲染代码**（HP.Talk 自己的函数），
 * 读真 DOM 的 scrollTop / scrollHeight / clientHeight，量「进群聊 / 新消息重画 / 用户上翻后重画」三种时刻的位置。
 * 只读不写：不改 talk.js，不改数据。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r29-scroll.mjs
 */
export default {
  name: 'R-29 定位：群聊栏目渲染后的滚动位置（真 paintGroup / 真 paintStream / 真 paintChat）',

  check: async (page) => {
    const out = {};

    /* ① 切栏目进「群聊」：与 app.js:1363 → Talk.onShow → render → paintGroup 同一条路 */
    await page.evaluate(() => {
      const T = HP.Talk;
      T.msgs = Array.from({ length: 40 }, (_, i) => ({
        id: i + 1,
        from: i % 3 === 0 ? 'owner.me' : 'pipeline.tester',
        kind: 'default',
        topic: '',
        body: '第 ' + (i + 1) + ' 条：' + '内容'.repeat(12),
        at: Math.floor(Date.now() / 1000) - (40 - i) * 60
      }));
      T.live = true;
      T.tab = 'group';
      HP.App.showBoard('group');            // 真路径：切到群聊栏目
    });
    await page.waitForTimeout(350);
    out.进群聊 = await page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      if (!s) return { 容器在: false };
      return {
        容器在: true,
        scrollTop: s.scrollTop,
        scrollHeight: s.scrollHeight,
        可视高度: s.clientHeight,
        离底部还差: s.scrollHeight - s.clientHeight - s.scrollTop,
        头顶那条是不是最老的: (s.firstChild && s.firstChild.textContent || '').slice(0, 24)
      };
    });

    /* ② 新消息到达：tick 里那一句（talk.js:195）调的就是 paintStream() */
    out.新消息到达后重画 = await page.evaluate(() => {
      const T = HP.Talk;
      T.msgs.push({ id: 41, from: 'pipeline.home.maid', kind: 'default', topic: '', body: '第 41 条：刚到的消息', at: Math.floor(Date.now() / 1000) });
      T.paintStream();
      const s = document.getElementById('tk-stream');
      return {
        scrollTop: s.scrollTop,
        scrollHeight: s.scrollHeight,
        可视高度: s.clientHeight,
        离底部还差: s.scrollHeight - s.clientHeight - s.scrollTop,
        最后一条在不在可视区: (() => {
          const last = s.lastChild;
          if (!last) return null;
          const r = last.getBoundingClientRect(), b = s.getBoundingClientRect();
          return r.bottom <= b.bottom + 1 && r.top >= b.top - 1;
        })()
      };
    });

    /* ③ 用户手动上翻后再来一条：位置会不会被抢回去 / 被冲掉 */
    out.手动上翻后 = await page.evaluate(async () => {
      const T = HP.Talk;
      const s = document.getElementById('tk-stream');
      s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2);   // 用户上翻到中间
      const before = s.scrollTop;
      T.msgs.push({ id: 42, from: 'pipeline.tester', kind: 'default', topic: '', body: '第 42 条：上翻期间到的', at: Math.floor(Date.now() / 1000) });
      T.paintStream();                                  // 2.5s 轮询里会发生的那次重画
      const s2 = document.getElementById('tk-stream');
      return {
        上翻时的位置: before,
        重画后位置: s2.scrollTop,
        位置被改动: s2.scrollTop !== before,
        离底部还差: s2.scrollHeight - s2.clientHeight - s2.scrollTop
      };
    });

    /* ④ 有没有「钉底 / 回到底部」的入口或状态 */
    out.钉底相关 = await page.evaluate(() => ({
      源码里_scrollTop赋值处: (HP.Talk.paintStream.toString().match(/scrollTop/g) || []).length,
      页面上有回到底部的入口: /回到底部|⇣|钉/.test(document.getElementById('tab-group').textContent),
      有滚动监听: !!HP.Talk._scrollBound
    }));

    /* ⑤ 对照：单聊那条路（talk.js:884 唯一一处钉底）
     * 注：paintChat 末尾 talk.js:885 调的 this.pullRoleOutput(r) 在这个文件里**没有定义**（4 处调用、0 处定义），
     * 所以这里给它补一个空壳，只为量到钉底那行的效果；这条真实缺陷单独记在结论里。 */
    out.单聊对照 = await page.evaluate(async () => {
      const T = HP.Talk;
      T.pullRoleOutput = () => { };                 /* 只为绕开未定义调用，不改 talk.js */
      HP.App.showBoard('talk');                     /* 切到单聊所在的栏目，容器才有高度 */
      await new Promise((r) => setTimeout(r, 300));
      const host = document.getElementById('tab-talk');
      const box = document.createElement('div');
      box.className = 'tk-chat'; box.id = 'tk-chat';
      box.style.maxHeight = '200px'; box.style.overflowY = 'auto';
      host.appendChild(box);
      T.live = { 'pipeline.tester': [] };
      const r = { full_name: 'pipeline.tester', title: '测试者' };
      T.live[r.full_name] = Array.from({ length: 30 }, (_, i) => '他的话 ' + (i + 1) + ' ' + 'x'.repeat(40));
      await T.paintChat(r);
      const b = document.getElementById('tk-chat');
      return {
        scrollTop: b.scrollTop,
        scrollHeight: b.scrollHeight,
        可视高度: b.clientHeight,
        离底部还差: b.scrollHeight - b.clientHeight - b.scrollTop,
        最后一条在可视区: (() => {
          const last = b.lastChild;
          if (!last) return null;
          const rr = last.getBoundingClientRect(), bb = b.getBoundingClientRect();
          return rr.bottom <= bb.bottom + 1;
        })()
      };
    });

    return out;
  }
};
