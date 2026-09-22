export default {
  name: 'debug: 焦点守卫有没有生效',
  check: async (page) => {
    const out = {};
    out.装了吗 = await page.evaluate(() => {
      const ta = HP.App.term.textarea;
      window.__focus事件 = [];
      ta.addEventListener('focus', () => window.__focus事件.push('focus @' + Date.now() % 100000));
      ta.addEventListener('blur', () => window.__focus事件.push('blur @' + Date.now() % 100000));
      return { 有textarea: !!ta, kbdWanted: HP.App._kbdWanted, 有wantKeyboard: typeof HP.App.wantKeyboard };
    });
    out.没允许时 = await page.evaluate(async () => {
      HP.App.wantKeyboard(false);
      const ta = HP.App.term.textarea;
      ta.focus();
      await new Promise((r) => setTimeout(r, 200));
      return { 焦点: document.activeElement && document.activeElement.className, 事件: window.__focus事件.slice(), kbdWanted: HP.App._kbdWanted };
    });
    out.手动blur行不行 = await page.evaluate(async () => {
      const ta = HP.App.term.textarea;
      ta.focus();
      await new Promise((r) => setTimeout(r, 50));
      ta.blur();
      await new Promise((r) => setTimeout(r, 100));
      return { 焦点: document.activeElement ? document.activeElement.tagName : null };
    });
    return out;
  }
};
