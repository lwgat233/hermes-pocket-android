/* R29-4（满 80 裁旧后钉底失效）定位+验证探针：跑真 paintStream，读真 DOM。
 * 量：未满 80 追加 1 条 / 满 80 裁旧后追加 1、3、5 条的「离底 px」「pinned」「入口计数」；
 *     以及上翻后追加 3 条的可见锚点位移（不许被抢回）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r29-4-trim.mjs
 */
const seed = (n, from) => Array.from({ length: n }, (_, i) => ({
  id: from + i,
  from: (from + i) % 3 === 0 ? 'owner.me' : 'pipeline.tester',
  kind: 'default',
  topic: '',
  body: '第 ' + (from + i) + ' 条：' + '内容'.repeat(10),
  at: 1790100000 + (from + i) * 60
}));

export default {
  name: 'R29-4：满 80 裁旧后的离底 px / pinned / 上翻锚点',

  check: async (page) => {
    const out = {};

    const setup = async () => page.evaluate(() => {
      HP.App.showBoard('group');
      const s = document.getElementById('tk-stream');
      if (s) { s.textContent = ''; s._ids = new Set(); s._lastHeight = undefined; s._pinned = true; s._newCount = 0; }
      HP.Talk.msgs = [];
      HP.Talk.withPrivate = true;
      HP.Talk.live = true;
    });

    const push = async (n, from) => page.evaluate(({ n, from }) => {
      for (let i = 0; i < n; i += 1) {
        HP.Talk.msgs.push({
          id: from + i,
          from: 'pipeline.tester',
          kind: 'default',
          topic: '',
          body: '第 ' + (from + i) + ' 条：' + '内容'.repeat(10),
          at: 1790100000 + (from + i) * 60
        });
      }
      HP.Talk.paintStream();
    }, { n, from });

    const read = async () => page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const chip = document.getElementById('tk-backchip-tk-stream');
      return {
        离底px: s.scrollHeight - s.clientHeight - s.scrollTop,
        scrollTop: s.scrollTop,
        scrollHeight: s.scrollHeight,
        可视高: s.clientHeight,
        pinned: s._pinned,
        气泡数: s.children.length,
        第一条id: (s.children[0] || {}).getAttribute ? s.children[0].getAttribute('data-tk-id') : null,
        入口: chip ? { 显示: chip.style.display !== 'none', 文案: chip.textContent, 计数: chip.getAttribute('data-count') } : null
      };
    });

    /* A. 未满 80（10 条）追加 1 条 —— 复测说这条是绿的，别弄坏 */
    await setup();
    await push(10, 1000);
    await page.waitForTimeout(150);
    out.A_未满80_基线 = await read();
    await push(1, 2000);
    await page.waitForTimeout(150);
    out.A_未满80_追加1条 = await read();

    /* B. 满 80 裁旧后追加 1 / 3 / 5 条 —— 复测报红的地方 */
    await setup();
    await push(80, 3000);
    await page.waitForTimeout(200);
    out.B_满80_基线 = await read();
    await push(1, 4000);
    await page.waitForTimeout(150);
    out.B_满80_追加1条 = await read();
    /* 老节点不许整块重建：追加前后必须是同一批 DOM 节点（同一对象、仍在文档里） */
    await page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const i = Math.max(0, s.children.length - 5);   // 靠后的节点：裁头裁不到它
      window.__probeNode = s.children[i];
      window.__probeNodeId = s.children[i].getAttribute('data-tk-id');
    });
    await push(3, 4100);
    await page.waitForTimeout(150);
    out.B_满80_再追加3条 = await read();
    out.B_老节点是否同一批 = await page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const n = window.__probeNode;
      return {
        同一对象还在容器里: !!n && [...s.children].includes(n),
        仍在文档里: !!(n && n.isConnected),
        id: window.__probeNodeId,
        容器节点数: s.children.length
      };
    });
    await push(5, 4200);
    await page.waitForTimeout(150);
    out.B_满80_再追加5条 = await read();

    /* C. 上翻后追加 3 条：可见锚点不许动（复测说这条现在是绿的） */
    await setup();
    await push(80, 5000);
    await page.waitForTimeout(200);
    out.C_上翻前 = await page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      s.scrollTop = Math.round((s.scrollHeight - s.clientHeight) / 2);   // 用户上翻到中间
      s._pinned = HP.Talk.isNearBottom(s);
      HP.Talk.paintBackChip(s);
      const vis = [...s.children].find((c) => c.getBoundingClientRect().top >= s.getBoundingClientRect().top);
      return { 离底px: s.scrollHeight - s.clientHeight - s.scrollTop, 锚点id: vis && vis.getAttribute('data-tk-id'), 锚点top: vis ? Math.round(vis.getBoundingClientRect().top) : null, pinned: s._pinned };
    });
    await push(3, 6000);
    await page.waitForTimeout(150);
    out.C_上翻后追加3条 = await page.evaluate((pre) => {
      const s = document.getElementById('tk-stream');
      const vis = [...s.children].find((c) => c.getAttribute('data-tk-id') === pre.锚点id);
      const chip = document.getElementById('tk-backchip-tk-stream');
      return {
        离底px: s.scrollHeight - s.clientHeight - s.scrollTop,
        锚点id: pre.锚点id,
        锚点top: vis ? Math.round(vis.getBoundingClientRect().top) : null,
        锚点位移px: vis ? Math.round(vis.getBoundingClientRect().top) - pre.锚点top : null,
        pinned: s._pinned,
        入口计数: chip ? chip.getAttribute('data-count') : null,
        气泡数: s.children.length
      };
    }, out.C_上翻前);

    return out;
  }
};
