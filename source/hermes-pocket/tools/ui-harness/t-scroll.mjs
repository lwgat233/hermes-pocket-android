/* F-UI-1 判据：长文本能往上翻 / 能一键到底 / 缓存上限可调
 * 三种情形分别读回来：
 *   ① 普通缓冲（shell 输出）：手势下滑翻开历史 → 点 chip 回到最新
 *   ② 备用屏（TUI/tmux）+ 远端鼠标模式：手势下滑 → 发给远端的滚轮序列 + 「回到最新」入口
 *   ③ 备用屏但远端没开鼠标：不能假滚，得给出路（一次会话只问一次）
 * 注：与界面文案比较的正则用 \u 转义写（运行时判据就是中文原文，写法只为源码里不留中文标识符）。
 */
const feed = (page, text) => page.evaluate((t) => window.__feed(t), text);

const swipeDown = (page) => page.evaluate(() => {
  const stage = document.getElementById('stage');
  const ev = (type, y) => stage.dispatchEvent(new PointerEvent(type, {
    pointerId: 7, clientX: 200, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: true
  }));
  ev('pointerdown', 260);
  for (let y = 272; y <= 660; y += 18) ev('pointermove', y);
  ev('pointerup', 660);
});

const peek = (page) => page.evaluate(() => {
  const b = HP.App.term.buffer.active;
  const chip = document.getElementById('sb-chip');
  return {
    bufType: b.type, baseY: b.baseY, viewportY: b.viewportY, linesBehind: b.baseY - b.viewportY,
    chipVisible: !!(chip && !chip.classList.contains('hidden')),
    chipText: chip ? chip.textContent : null,
    alt: !!HP.App.watcher.alt, mouseMode: HP.App.watcher.mouseMode,
    'sentWriteCount': (window.__sentWrites = window.__sentWrites || []).length
  };
});

export default {
  name: 'F-UI-1 长文本滚动 / 一键到底 / 缓存上限',

  check: async (page) => {
    const out = {};
    /* --- ① 普通缓冲：300 行长文本 --- */
    await page.evaluate(() => { if (HP.App.closePanel) HP.App.closePanel(); });
    await feed(page, Array.from({ length: 300 }, (_, i) => 'row-' + i + ' 这是一条比较长的输出，用来把回滚缓冲填满\r\n').join(''));
    await page.waitForTimeout(800);
    out.normalInitial = await peek(page);
    await swipeDown(page);
    await page.waitForTimeout(600);
    out.normalAfterSwipe = await peek(page);
    const chipClicked = await page.evaluate(() => {
      const c = document.getElementById('sb-chip');
      if (!c || c.classList.contains('hidden')) return false;
      c.click(); return true;
    });
    await page.waitForTimeout(600);
    out.normalAfterChipClick = await peek(page);
    out.normalVerdict = {
      'scrolledUp': out.normalAfterSwipe.viewportY < out.normalInitial.viewportY,
      'backToBottomEntryShown': chipClicked,
      'backToLatestAfterTap': out.normalAfterChipClick.linesBehind === 0,
      'entryGone': out.normalAfterChipClick.chipVisible === false
    };

    /* --- ② 备用屏 + 远端鼠标模式（要有会话才发得出去：send 在没 sessionId 时会拦） --- */
    await page.evaluate(() => {
      HP.App.sessionId = 's1';
      HP.App.state = 'connected';
      window.__sentWrites = [];
      const t = HP.App.transport;
      if (!window.__hooked) {
        window.__hooked = true;
        const osend = t.send.bind(t);
        t.send = (o) => { if (o && o.t === 'session.write') window.__sentWrites.push(o.data); return osend(o); };
      }
    });
    await feed(page, '\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000h\x1b[?1006h');
    await feed(page, Array.from({ length: 40 }, (_, i) => 'TUI 行 ' + i + '\r\n').join(''));
    await page.waitForTimeout(700);
    out.altInitial = await peek(page);
    const sentBeforeWheelUp = out.altInitial.sentWriteCount;
    await swipeDown(page);
    await page.waitForTimeout(700);
    out.altAfterSwipe = await peek(page);
    const wheelUp = await page.evaluate(() => (window.__sentWrites || []).filter((d) => d).length);
    const chipClick2 = await page.evaluate(() => {
      const c = document.getElementById('sb-chip');
      if (!c || c.classList.contains('hidden')) return false;
      c.click(); return true;
    });
    await page.waitForTimeout(600);
    const wheelTotal = await page.evaluate(() => (window.__sentWrites || []).length);
    out.altAfterBackToLatest = await peek(page);
    out.altVerdict = {
      'altScreenDetected': out.altAfterSwipe.alt === true,
      'remoteMouseDetected': out.altAfterSwipe.mouseMode > 0,
      'gestureBecomesRemoteWheel': out.altAfterSwipe.sentWriteCount > sentBeforeWheelUp,
      'backToLatestEntryShown': chipClick2,
      'entryTextMatches': /\u56de\u5230\u6700\u65b0/.test(out.altAfterSwipe.chipText || ''),
      'wheelSentOnBackToLatest': wheelTotal > wheelUp,
      'entryGoneAfterReturn': out.altAfterBackToLatest.chipVisible === false,
      'entryTextNotLinesAbove': !(out.altAfterSwipe.chipVisible && /\u4e0a\u9762\u8fd8\u6709/.test(out.altAfterSwipe.chipText || '')),
      'oldEntryHiddenOnTuiEnter': out.altInitial.chipVisible === false
    };
    /* --- ③ 备用屏但远端没开鼠标：不能假滚，要给出路（一次会话只问一次） --- */
    await feed(page, '\x1b[?1049l');          // 回普通缓冲，重置一次会话里的"问过没有"
    await page.evaluate(() => { HP.App._tuiScrollAsked = false; const c = document.getElementById('sb-chip'); if (c) c.remove(); });
    await feed(page, '\x1b[?1049h\x1b[2J\x1b[H\x1b[?1000l\x1b[?1006l');   // 再来一次备用屏，但**不开**鼠标
    await page.waitForTimeout(500);
    await swipeDown(page);
    await page.waitForTimeout(800);
    out.noMouseAfterSwipe = await peek(page);
    out.noMouseVerdict = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('#stage > div')].filter((e) => /tmux \u9f20\u6807|\u9f20\u6807/.test(e.textContent || '')).length;
      const btns = [...document.querySelectorAll('#stage button')].map((b) => b.textContent.trim());
      return { mouseMode: HP.App.watcher.mouseMode, dialog: dlg > 0, buttonLabels: btns.slice(-4) };
    });
    return out;
  }
};
