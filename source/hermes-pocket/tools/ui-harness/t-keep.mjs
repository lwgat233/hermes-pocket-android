/* 「对话框一直攒着」这条现状的判据（用户问的那句：实时 + 暂存都攒着吧？）：
 *  ① 切到别的栏目再切回来：终端内容还在（不被重建/清空）
 *  ② 断线再连：终端内容还在（App 从不 term.reset）
 *  ③ 后台（熄屏那种）收到的数据先攒着，回前台按顺序补渲染，不丢不跳序（_flushBuf）
 *  ④ 输入框里打了一半的字：切栏目、点终端、重连都不丢
 */
const lineCount = (page) => page.evaluate(() => HP.App.term.buffer.active.length);
/** 取末尾 n 行里的**非空行**（光标在底部，尾部常是空行；读"最后几行"很容易读成一片空白） */
const tailText = (page, n) => page.evaluate((k) => {
  const b = HP.App.term.buffer.active; const lines = [];
  for (let i = Math.max(0, b.length - k); i < b.length; i++) { const l = b.getLine(i); if (l) lines.push(l.translateToString(true)); }
  return lines.filter((x) => x.trim()).join('\n');
}, n);
/** 整个缓冲区里有没有某段文字（最保险的一条判据） */
const contains = (page, s) => page.evaluate((needle) => {
  const b = HP.App.term.buffer.active;
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l && l.translateToString(true).indexOf(needle) >= 0) return true; }
  return false;
}, s);
/** 探针用的那几段文案，与页面里写进终端的文案一致（两边要一起改） */
const tickLine = (i) => '攒着第 ' + i + ' 行';
const bgMessage = (i) => '后台第 ' + i + ' 条';
const reopenLine = '重连后再来一行';
/** 与 harness 假桥里那两段文案一致（落盘缓存的一段、重复的老消息） */
const resumeMark = '落盘缓存里的一段';
const repeatMark = '这条是重复的';

export default {
  name: '对话框一直攒着（切栏目 / 断线重连 / 后台补发 / 输入框草稿）',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.onState('connected', {});
      HP.App.term.write('\x1b[2J\x1b[H');      // 先清一次，从干净状态开始数
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      for (let i = 1; i <= 12; i++) HP.App.term.write('攒着第 ' + i + ' 行\r\n');
    });
    await page.waitForTimeout(400);
    out.initial = { lineCount: await lineCount(page), tail: (await tailText(page, 20)).split('\n').slice(-2).join(' | ') };

    /* ① 切栏目来回（去设置页再回来） */
    await page.evaluate(() => { HP.App.openBoard('settings'); });
    await page.waitForTimeout(600);
    await page.evaluate(() => { HP.App.closePanel(); });
    await page.waitForTimeout(600);
    out.afterBoardRoundTrip = { lineCount: await lineCount(page), tail: (await tailText(page, 20)).split('\n').slice(-2).join(' | '),
      hasLine12: await contains(page, tickLine(12)) };

    /* ② 断线 → 重连（不真连，只走状态与缓冲；验的是「不清屏」） */
    await page.evaluate(() => { HP.App.onState('disconnected', {}); });
    await page.waitForTimeout(300);
    await page.evaluate((line) => { HP.App.onState('connected', {}); HP.App.term.write(line + '\r\n'); }, reopenLine);
    await page.waitForTimeout(400);
    out.afterReconnect = { lineCount: await lineCount(page), tail: (await tailText(page, 20)).split('\n').slice(-3).join(' | '),
      hasLine1: await contains(page, tickLine(1)), hasReopenLine: await contains(page, reopenLine) };

    /* ③ 后台补发：按真实时序 —— 恢复过程进行中到达的事件先入队，等缓存那段渲染完再按序放行 */
    out.backgroundFlush = await page.evaluate(async () => {
      const encode = (s) => { const u = HP.enc.encode(s); return HP.b64encode(u); };
      const offLabel = '熄屏';                                  // 省电开关两边的文案（与页面里一致）
      const onLabel = '亮屏';
      await HP.App.applyPowerSave(true, offLabel);              // 进省电（熄屏那种）
      window.__spillDelayMs = 400;                             // 让"拉落盘缓存"慢一点，腾出真实的暂存窗口
      const before = HP.App.term.buffer.active.length;

      const resume = HP.App.applyPowerSave(false, onLabel);     // 真恢复：内部就是 resumeFromPowerSave
      await new Promise((r) => setTimeout(r, 120));             // 等它跑到 await（拉缓存，桩要 400ms）—— 这期间开关已挂上
      const flushBufferArmed = Array.isArray(HP.App._flushBuf);
      HP.App.onData({ data: encode('后台第 1 条\r\n'), seq: 101 });
      HP.App.onData({ data: encode('后台第 2 条\r\n'), seq: 102 });
      HP.App.onData({ data: encode('后台第 3 条\r\n'), seq: 103 });
      HP.App.onData({ data: encode('这条是重复的（seq 太老）\r\n'), seq: 50 });
      const pausedLineCount = HP.App.term.buffer.active.length;
      const queuedCount = (HP.App._flushBuf || []).length;
      await resume;
      await new Promise((r) => setTimeout(r, 600));

      const b = HP.App.term.buffer.active; const lines = [];
      for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) lines.push(l.translateToString(true)); }
      return { flushBufferArmed, noGrowthWhilePaused: pausedLineCount === before, queuedCount,
        last10NonEmpty: lines.filter((x) => x.trim()).slice(-10) };
    });

    /* ④ 输入框草稿 */
    await page.evaluate(() => { const c = document.getElementById('cinput'); c.value = '草稿不许丢'; c.focus(); });
    await page.evaluate(() => { HP.App.openBoard('hermes'); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { HP.App.closePanel(); });
    await page.waitForTimeout(300);
    out.draftAfterBoard = await page.evaluate(() => document.getElementById('cinput').value);
    await page.evaluate(() => { HP.App.onState('disconnected', {}); HP.App.onState('connected', {}); });
    await page.waitForTimeout(300);
    out.draftAfterReconnect = await page.evaluate(() => document.getElementById('cinput').value);

    out.conclusion = {
      boardRoundTripKeepsContent: out.afterBoardRoundTrip.lineCount >= out.initial.lineCount && out.afterBoardRoundTrip.hasLine12 === true,
      reconnectDoesNotClearScreen: out.afterReconnect.lineCount >= out.initial.lineCount && out.afterReconnect.hasLine1 === true &&
        out.afterReconnect.hasReopenLine === true,
      backgroundQueuesBeforePainting: out.backgroundFlush.flushBufferArmed === true && out.backgroundFlush.noGrowthWhilePaused === true &&
        out.backgroundFlush.queuedCount === 4,
      flushedInOrderAfterResume: (() => {
        const text = out.backgroundFlush.last10NonEmpty.join('\n');
        const i1 = text.indexOf(bgMessage(1)), i2 = text.indexOf(bgMessage(2)), i3 = text.indexOf(bgMessage(3));
        return i1 >= 0 && i2 > i1 && i3 > i2;
      })(),
      diskCacheSegmentRendersFirst: out.backgroundFlush.last10NonEmpty.join('\n').includes(resumeMark),
      duplicateStaleMessageDropped: !out.backgroundFlush.last10NonEmpty.join('\n').includes(repeatMark),
      draftSurvivesBoardSwitch: out.draftAfterBoard === '草稿不许丢',
      draftSurvivesReconnect: out.draftAfterReconnect === '草稿不许丢'
    };
    return out;
  }
};
