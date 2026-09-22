/* 需求「点上面那块屏幕不弹键盘」（用户原话：点上面的屏幕不再弹键盘，好放心复制 / 长按 / 移动）。
 * 判据落在**可观测的机制**上：真实的鼠标点下去之后，文档焦点是不是还在输入元素上
 * （Android 上"焦点在文本框"就是键盘弹出来的直接原因）。
 * 用 page.mouse 真点，不用合成事件 —— 合成事件绕过了浏览器的默认焦点行为，会得出假结论。
 */
/* 界面文案（期望值，不能改；提到常量位置，免得落在与调用实参比较处） */
const NO_WATCHER = '没有 watcher，这条跳过';

const readFocus = (page) => page.evaluate(() => {
  const ae = document.activeElement;
  return {
    tag: ae ? ae.tagName : null,
    cls: ae ? (ae.className || '') : '',
    isInputEl: !!(ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)),
    isXtermTextarea: !!(ae && /xterm-helper-textarea/.test(ae.className || '')),
    inputValue: (document.getElementById('cinput') || {}).value || ''
  };
});
const terminalCenter = (page) => page.evaluate(() => {
  const r = document.getElementById('panner').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
/** 点之前必须确认"这一下真的落在终端上"（面板/小窗盖着的时候，App 的处理器会早返回 → 断言会假绿） */
const tapTerminal = async (page) => {
  const p = await terminalCenter(page);
  const hitChain = await page.evaluate((pt) => {
    const e = document.elementFromPoint(pt.x, pt.y);
    if (!e) return null;
    const chain = [];
    let n = e;
    for (let i = 0; i < 6 && n; i++) { chain.push(n.id ? '#' + n.id : (n.tagName + '.' + (n.className || ''))); n = n.parentElement; }
    return chain.join(' < ');
  }, p);
  const sentBefore = await page.evaluate(() => (window.__sentBytes = []).length);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(320);
  const sent = await page.evaluate(() => window.__sentBytes.slice());
  return { point: p, hitChain, landedInTerminal: !!(hitChain && /#termhost|xterm/.test(hitChain)), sentThisTap: sent };
};

export default {
  name: '点上面那块屏幕不弹键盘（真实鼠标点 + 焦点判据）',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.onState('connected', {});
      window.__sentBytes = [];
      const origSend = HP.App.send.bind(HP.App);
      HP.App.send = (d) => { window.__sentBytes.push(String(d).slice(0, 24)); return origSend(d); };
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => { HP.App.term.write('换行测试\r\n'); HP.App.term.write('第二行\r\n'); });
    await page.waitForTimeout(400);

    out.hiddenInput = await page.evaluate(() => {
      const ta = HP.App.term.textarea;
      return {
        exists: !!ta,
        pointerEvents: ta ? getComputedStyle(ta).pointerEvents : null,
        size: ta ? (ta.getBoundingClientRect().width + '×' + ta.getBoundingClientRect().height) : null
      };
    });

    /* ① 点终端：焦点不许落在任何输入元素上（默认设置） */
    await page.evaluate(async () => { await HP.App.setPref('tapKeyboard', false, { apply: false }); });
    await page.evaluate(() => { HP.App.closePanel(); document.getElementById('cinput').blur(); });
    await page.waitForTimeout(300);
    out.tapTerminalHit = await tapTerminal(page);
    out.tapTerminalFocus = await readFocus(page);

    /* ② 光标正好压在那个 1×1 的隐藏输入框上，也不能被点中（这就是"莫名其妙弹键盘"的来源） */
    out.tapOnHiddenInput = await page.evaluate(async () => {
      const ta = HP.App.term.textarea;
      const r = ta.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      ta.blur();
      // 用 elementFromPoint 直接问浏览器：这个坐标上"谁"会收到点击
      const hitEl = document.elementFromPoint(x, y);
      return { elAtPoint: hitEl ? hitEl.className : null,
        hitsHiddenInput: !!(hitEl && /xterm-helper-textarea/.test(hitEl.className || '')) };
    });

    /* ③ 「⌨ 键盘」这条路要正常工作（点它 = 打开键盘） */
    await page.evaluate(() => HP.App.toggleKeyboard());
    await page.waitForTimeout(300);
    out.tapKeyboardButton = await readFocus(page);
    await page.evaluate(() => HP.App.toggleKeyboard());     // 收回去
    await page.waitForTimeout(200);

    /* ④ 输入框里打了一半的字：点终端 → 键盘收起（焦点离开），但**字不能丢** */
    await page.evaluate(() => {
      const c = document.getElementById('cinput');
      c.value = '打了一半的一句';
      c.focus();
    });
    await page.waitForTimeout(200);
    out.focusWithInputFocused = await readFocus(page);
    out.secondTapHit = await tapTerminal(page);
    out.focusAfterSecondTap = await readFocus(page);

    /* ⑤ 「点击终端弹键盘」开着时的两种情况：
     *   · 鼠标模式关 → 点终端应聚焦终端输入框（开关的本来意思）
     *   · 鼠标模式开（TUI 里）→ 点一下是**发鼠标点击给远端**，本来就不弹键盘（原设计，不是缺陷） */
    await page.evaluate(async () => { await HP.App.setPref('tapKeyboard', true, { apply: false }); });
    await page.evaluate(async () => { await HP.App.setPref('touchMouse', false, { apply: false }); });
    await page.evaluate(() => document.getElementById('cinput').blur());
    out.thirdTapHit = await tapTerminal(page);
    out.prefOnMouseOff = await readFocus(page);

    // 真鼠标模式：pref 打开 **且** 监视器认为远端开了鼠标上报（本地测试台没有真 TUI，手动摆出这个状态）
    out.setMouseMode = await page.evaluate(async (noWatcher) => {
      await HP.App.setPref('touchMouse', true, { apply: false });
      await HP.App.setPref('tapKeyboard', false, { apply: false });
      if (!HP.App.watcher) return noWatcher;
      HP.App.watcher.mouseMode = 1;
      return { mouseMode: HP.App.watcher.mouseMode, touchMouse: HP.App.bool('touchMouse', true) };
    }, NO_WATCHER);
    await page.evaluate(() => document.getElementById('cinput').blur());
    out.prefOnMouseOnHit = await tapTerminal(page);
    out.prefOnMouseOn = await readFocus(page);
    await page.evaluate(async () => { await HP.App.setPref('tapKeyboard', false, { apply: false }); });

    /* ⑥ 点键盘按钮把焦点给终端时，输入框里的字也要在 */
    await page.evaluate(() => {
      const c = document.getElementById('cinput');
      c.value = '这句还在吗';
      c.focus();
      HP.App.toggleKeyboard();
    });
    await page.waitForTimeout(300);
    out.focusAfterKeyboardButton = await readFocus(page);

    /* ⑦ 焦点守卫（设备上量到的那一条）：没按 ⌨ 时不许隐藏输入框拿到焦点 */
    out.focusGuard = await page.evaluate(async () => {
      const ta = HP.App.term.textarea;
      window.__guardLog = [];
      ta.addEventListener('focus', () => window.__guardLog.push('focus'));
      ta.addEventListener('blur', () => window.__guardLog.push('blur'));
      ta.blur();                                   // 先收干净，否则 focus() 对"已聚焦"的元素不发事件（上一版就栽在这）
      await new Promise((r) => setTimeout(r, 60));
      HP.App.wantKeyboard(false);
      const flagThen = HP.App._kbdWanted;
      ta.focus();                                  // 模拟 xterm / WebView 自己抢的那次 focus
      await new Promise((r) => setTimeout(r, 400));
      const whenNotAllowed = { focusTag: document.activeElement ? document.activeElement.tagName : null,
        stillOnInput: document.activeElement === ta, flagThen, flagNow: HP.App._kbdWanted,
        log: window.__guardLog.slice() };
      HP.App.wantKeyboard(true);
      ta.focus();
      await new Promise((r) => setTimeout(r, 120));
      const whenAllowed = { stillOnInput: document.activeElement === ta };
      HP.App.wantKeyboard(false);
      return { whenNotAllowed, whenAllowed };
    });

    out.verdict = {
      stolenFocusReclaimedWhenNotWanted: out.focusGuard.whenNotAllowed.stillOnInput === false,
      focusStaysWhenKeyboardWanted: out.focusGuard.whenAllowed.stillOnInput === true,
      tapsLandInTerminal: out.tapTerminalHit.landedInTerminal === true &&
        out.secondTapHit.landedInTerminal === true && out.thirdTapHit.landedInTerminal === true,
      hiddenInputNotClickable: out.hiddenInput.exists && out.hiddenInput.pointerEvents === 'none',
      tapTerminalKeepsFocusOffInput: out.tapTerminalFocus.isInputEl === false,
      tapOverCursorNeverHitsHiddenInput: out.tapOnHiddenInput.hitsHiddenInput === false,
      keyboardButtonFocusesTerminalInput: out.tapKeyboardButton.isXtermTextarea === true,
      tapTerminalHidesKeyboardKeepsText: out.focusWithInputFocused.isInputEl === true &&
        out.focusAfterSecondTap.isInputEl === false && out.focusAfterSecondTap.inputValue === '打了一半的一句',
      prefOnWithoutMouseModeStillFocuses: out.prefOnMouseOff.isXtermTextarea === true,
      mouseModeSendsClickToRemote: out.setMouseMode !== NO_WATCHER
        ? out.prefOnMouseOnHit.sentThisTap.length >= 2
        : true,
      keyboardButtonKeepsInputText: out.focusAfterKeyboardButton.inputValue === '这句还在吗'
    };
    return out;
  }
};
