/* 设备端复验（模块化：一个文件，按检查项分函数）。
 * 跑法：node dev-probe.mjs device-check.mjs     （先用 adb forward tcp:9222 指到 WebView 的 devtools socket）
 * 每一项都是"读回来的事实"，不是看界面像不像：
 *   version    版本串（证明装的是这一版）
 *   keyboard   点终端不弹键盘（焦点 + inputmode 两重判据）／按「⌨ 键盘」时键盘要能用
 *   immersive  沉浸模式保留输入框、顶栏与键条照旧藏起来、退出后都回来
 *   hamburger  退出沉浸后点 ☰ 能开抽屉（真触摸）
 *   scroll     单指下滑能翻历史（真触摸；先喂 200 行造出可滚的缓冲）
 * 真触摸走 CDP 的 Input.dispatchTouchEvent（页面坐标），不用 adb shell input tap 换算像素。
 */
import { execSync } from 'node:child_process';

const wait = (page, ms) => page.waitForTimeout(ms);
const ADB = process.env.ADB_SERIAL || 'emulator-5554';        // 设备序列号（可用环境变量换）
const BUILD_LABEL = '构建版本';      // 设置面板里那一行的标签（与界面文案一致）

const readFocus = (page) => page.evaluate(() => {
  const ta = HP.App.term.textarea;
  const ae = document.activeElement;
  return { tag: ae ? ae.tagName : null, id: ae ? ae.id : '', isHiddenTextarea: ae === ta, inputmode: ta.getAttribute('inputmode') };
});

const checkVersion = async (page) => page.evaluate(async (label) => {
  HP.App.sessionId = 's1'; HP.App.state = 'connected';
  await HP.App.openBoard('settings');
  await new Promise((r) => setTimeout(r, 700));
  const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.indexOf(label) >= 0);
  return { build: HP.BUILD, info: HP.BUILDINFO || null, settingsCard: card ? card.textContent.replace(/\s+/g, ' ').trim().slice(0, 200) : null };
}, BUILD_LABEL);

const checkKeyboard = async (page) => {
  const out = {};
  out.before = await readFocus(page);
  const center = await page.evaluate(() => {
    const r = document.getElementById('termhost').getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  await page.tap(center.x, center.y);                     // 真手指点终端
  await wait(page, 400);
  out.afterTapTerminal = await readFocus(page);
  out.afterWantedKeyboard = await page.evaluate(async () => {  // 按「⌨ 键盘」= 用户明确要键盘
    if (HP.App.toggleKeyboard) HP.App.toggleKeyboard();
    if (HP.App.wantKeyboard) HP.App.wantKeyboard(true);
    HP.App.term.textarea.focus();
    await new Promise((r) => setTimeout(r, 250));
    const ta = HP.App.term.textarea;
    return { inputmode: ta.getAttribute('inputmode'), focused: document.activeElement === ta };
  });
  out.afterRelease = await page.evaluate(async () => {
    if (HP.App.wantKeyboard) HP.App.wantKeyboard(false);
    HP.App.term.textarea.blur();
    await new Promise((r) => setTimeout(r, 200));
    return { inputmode: HP.App.term.textarea.getAttribute('inputmode') };
  });
  out.conclusions = {
    startsWithKeyboardGateOff: out.before.inputmode === 'none',
    tapTerminalDoesNotFocusHiddenTextarea: out.afterTapTerminal.isHiddenTextarea === false,
    tapTerminalKeepsKeyboardGateOff: out.afterTapTerminal.inputmode === 'none',
    keyboardButtonOpensGate: out.afterWantedKeyboard.inputmode === 'text' && out.afterWantedKeyboard.focused === true,
    releasingKeyboardClosesGate: out.afterRelease.inputmode === 'none'
  };
  return out;
};

const checkImmersive = async (page) => {
  const out = {};
  out.inOut = await page.evaluate(async () => {
    const read = () => {
      const c = document.getElementById('composer').getBoundingClientRect();
      return {
        composerDisplay: getComputedStyle(document.getElementById('composer')).display,
        composerInViewport: c.height > 0 && c.top >= 0 && c.bottom <= window.innerHeight + 1,
        topbarDisplay: getComputedStyle(document.getElementById('topbar')).display,
        keybarDisplay: getComputedStyle(document.getElementById('keybar')).display
      };
    };
    const before = read();
    HP.App.toggleImmersive();
    await new Promise((r) => setTimeout(r, 700));
    const middle = read();
    HP.App.toggleImmersive();
    await new Promise((r) => setTimeout(r, 900));
    return { before, middle, after: read() };
  });
  out.conclusions = {
    composerKeptInImmersive: out.inOut.middle.composerDisplay !== 'none' && out.inOut.middle.composerInViewport === true,
    chromeHiddenInImmersive: out.inOut.middle.topbarDisplay === 'none' && out.inOut.middle.keybarDisplay === 'none',
    chromeBackAfterExit: out.inOut.after.composerDisplay !== 'none' && out.inOut.after.topbarDisplay !== 'none'
  };
  return out;
};

const checkHamburger = async (page) => {
  const out = {};
  await page.evaluate(() => HP.App.closeDrawer && HP.App.closeDrawer());
  await wait(page, 300);
  const rect = await page.evaluate(() => {
    const b = document.getElementById('btn-panel').getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), w: Math.round(b.width), h: Math.round(b.height) };
  });
  out.buttonRect = rect;
  await page.tap(rect.x, rect.y);                          // 真手指点 ☰
  await wait(page, 600);
  out.afterTap = await page.evaluate(() => ({
    drawerOpen: document.getElementById('drawer').classList.contains('show'),
    items: document.querySelectorAll('#dw-body [data-testid^="board-"]').length
  }));
  await page.evaluate(() => HP.App.closeDrawer());
  out.conclusions = { hamburgerOpensDrawer: out.afterTap.drawerOpen === true && out.afterTap.items > 0 };
  return out;
};

const checkScroll = async (page) => {
  /* 先关掉任何还开着的面板/抽屉/小窗 —— 否则拖动起点落在面板上，面板是 touch-action:pan-y，
   * 浏览器会接管手势（实测事件流 = pointerdown → 1 个 pointermove → pointercancel，应用收不到拖动）。 */
  await page.evaluate(async () => {
    HP.App.closePanel && HP.App.closePanel();
    HP.App.closeDrawer && HP.App.closeDrawer();
    for (const el of [...document.getElementById('stage').children]) {
      if (!['panner', 'termhost', 'overlay', 'ctxmenu', 'toast', 'topbar', 'keybar', 'composer'].includes(el.id)) el.remove();
    }
    await new Promise((r) => setTimeout(r, 200));
    const lines = [];
    for (let i = 1; i <= 200; i += 1) lines.push('device-check line ' + i);
    HP.App.onData({ data: HP.b64encode(HP.enc.encode(lines.join('\r\n') + '\r\n')), seq: 900 });
  });
  await wait(page, 700);

  const geom = await page.evaluate(() => {
    const th = document.getElementById('termhost').getBoundingClientRect();
    const x = Math.round(th.x + th.width / 2), y = Math.round(th.y + th.height * 0.35);
    const hit = document.elementFromPoint(x, y);
    return {
      x, y,
      before: HP.App.term.buffer.active.viewportY,
      base: HP.App.term.buffer.active.baseY,
      landedOn: hit ? (hit.id || hit.className || hit.tagName).toString().slice(0, 30) : null,
      landedInTerminal: !!(hit && hit.closest && hit.closest('#termhost'))
    };
  });

  // 真触摸分步拖动（起点已证明在终端里；终端 touch-action:none，事件流不会被浏览器掐断）
  await page.drag(geom.x, geom.y, geom.x, geom.y + 200, 8);
  await wait(page, 700);
  const after = await page.evaluate(() => ({ viewportY: HP.App.term.buffer.active.viewportY }));

  const out = { geom, after, scrolled: after.viewportY < geom.before, swipedBy: 'cdp-drag' };
  out.conclusions = {
    dragStartLandsInTerminal: geom.landedInTerminal === true,
    singleFingerDragScrolls: out.scrolled === true
  };
  return out;
};

export default {
  name: '设备端复验（版本 / 键盘 / 沉浸 / ☰ / 滚动）',
  check: async (page) => {
    const out = {};
    const steps = {
      version: () => checkVersion(page),
      keyboard: () => checkKeyboard(page),
      immersive: () => checkImmersive(page),
      hamburger: () => checkHamburger(page),
      scroll: () => checkScroll(page)
    };
    for (const [name, fn] of Object.entries(steps)) {
      try { out[name] = await fn(); } catch (e) { out[name] = { error: String((e && e.stack) || e).slice(0, 400) }; }
    }
    return out;
  }
};
