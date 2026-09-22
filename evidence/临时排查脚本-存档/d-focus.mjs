export default {
  name: 'debug: 终端能否 focus',
  check: async (page) => {
    await page.evaluate(() => { HP.App.sessionId = 's1'; HP.App.state = 'connected'; HP.App.onState('connected', {}); });
    await page.waitForTimeout(800);
    const 焦点 = () => page.evaluate(() => {
      const ae = document.activeElement;
      return { tag: ae && ae.tagName, cls: (ae && ae.className) || '' };
    });
    const out = {};
    out.初始 = await 焦点();
    out.直接focus = await page.evaluate(() => { HP.App.term.focus(); return true; });
    await page.waitForTimeout(200);
    out.直接focus后 = await 焦点();
    out.textarea属性 = await page.evaluate(() => {
      const ta = HP.App.term.textarea;
      return {
        tabIndex: ta.tabIndex, disabled: ta.disabled, readOnly: ta.readOnly,
        pointerEvents: getComputedStyle(ta).pointerEvents,
        display: getComputedStyle(ta).display, visibility: getComputedStyle(ta).visibility,
        rect: ta.getBoundingClientRect().width + '×' + ta.getBoundingClientRect().height
      };
    });
    out.原生focus = await page.evaluate(() => { HP.App.term.textarea.focus(); return document.activeElement === HP.App.term.textarea; });
    out.去掉pointerEvents再focus = await page.evaluate(() => {
      HP.App.term.textarea.style.pointerEvents = 'auto';
      HP.App.term.textarea.focus();
      const r = document.activeElement === HP.App.term.textarea;
      HP.App.term.textarea.style.pointerEvents = '';
      return r;
    });
    return out;
  }
};
