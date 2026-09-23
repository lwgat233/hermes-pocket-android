/* R-29 复测 · 运行 A4：同一次同步追加 vs 分帧追加 —— 定位「掉底」的触发条件
 *  同帧：push(...) 后同一任务里 paintStream()
 *  分帧：push(...) → await 60ms → paintStream()
 * 两次都从「80 条、在底部、gap 0」起步，每步立刻读数。
 */
export default {
  name: 'R29-复测-同帧与分帧-A4',
  check: async (page) => {
    const out = {};
    const setup = (base) => page.evaluate(async (b) => {
      HP.Talk.msgs = Array.from({ length: 80 }, (_, k) => ({ id: b + k, kind: 'broadcast', from: 'pipeline.author', to: null, topic: 'R29', body: 'M' + (b + k) + 'x'.repeat(40), at: 1790120000 + k }));
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 500));
      const s = document.getElementById('tk-stream');
      s.textContent = ''; s._ids = new Set(); s._sig = null; s._lastHeight = undefined; s._pinned = undefined; s._newCount = 0;
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned };
    }, base);
    const read = () => page.evaluate(() => {
      const s = document.getElementById('tk-stream');
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), scrollTop: Math.round(s.scrollTop), scrollHeight: s.scrollHeight, pinned: !!s._pinned, newCount: s._newCount || 0, chipDisplay: chip ? getComputedStyle(chip).display : null, chipText: chip ? chip.textContent : null };
    });

    out.S1_start = await setup(6000);
    out.S1_sameTask = await page.evaluate(async () => {          /* 同帧：push 后立刻画 */
      const s = document.getElementById('tk-stream');
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      HP.Talk.msgs.push({ id: maxId + 1, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: '同帧新1' + 'y'.repeat(40), at: 1790130000 });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned, newCount: s._newCount || 0, chipText: chip ? chip.textContent : null, chipDisplay: chip ? getComputedStyle(chip).display : null };
    });

    out.S2_start = await setup(7000);
    out.S2_splitFrame = await page.evaluate(async () => {        /* 分帧：push → 让事件循环转一圈 → 再画 */
      const s = document.getElementById('tk-stream');
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      HP.Talk.msgs.push({ id: maxId + 1, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: '分帧新1' + 'y'.repeat(40), at: 1790140000 });
      await new Promise((r) => setTimeout(r, 60));
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned, newCount: s._newCount || 0, chipText: chip ? chip.textContent : null, chipDisplay: chip ? getComputedStyle(chip).display : null };
    });

    out.S3_start = await setup(8000);
    out.S3_direct = await page.evaluate(async () => {            /* 对照：先手动钉到底（模拟「刚刚有人在底部」），再同帧 push */
      const s = document.getElementById('tk-stream');
      s.scrollTop = s.scrollHeight; s._pinned = true; s._newCount = 0; HP.Talk.paintBackChip(s);
      await new Promise((r) => setTimeout(r, 200));
      const maxId = Math.max.apply(null, HP.Talk.msgs.map((m) => m.id));
      for (let k = 1; k <= 3; k += 1) HP.Talk.msgs.push({ id: maxId + k, kind: 'broadcast', from: 'owner.me', to: null, topic: 'R29', body: '对照新' + k + 'y'.repeat(40), at: 1790150000 + k });
      HP.Talk.paintStream();
      await new Promise((r) => setTimeout(r, 400));
      const chip = s._chip && s._chip.isConnected ? s._chip : null;
      return { gap: s.scrollHeight - s.clientHeight - Math.round(s.scrollTop), pinned: !!s._pinned, newCount: s._newCount || 0, chipText: chip ? chip.textContent : null, chipDisplay: chip ? getComputedStyle(chip).display : null };
    });

    const ok = (o) => o.gap === 0 && o.pinned === true && o.chipDisplay === 'none';
    out.verdict = {
      'S1起点在底部': ok(out.S1_start), 'S1同帧追加后钉底': ok(out.S1_sameTask),
      'S2起点在底部': ok(out.S2_start), 'S2分帧追加后钉底': ok(out.S2_splitFrame),
      'S3起点在底部': ok(out.S3_start), 'S3手动钉底后同帧追加3条仍钉底': ok(out.S3_direct)
    };
    return out;
  }
};
