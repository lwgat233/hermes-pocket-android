/* R-48 / R-47 探针：事件序列采集 + 几何（固定密度比，键盘弹出不影响）
 * ACTION=install 装事件采集器（#cinput 上 keydown/keyup/beforeinput/input/composition*）
 * ACTION=events  读事件序列
 * ACTION=geom    读几何（含键盘弹出时）
 * ACTION=hint    读 enterkeyhint 对照（终端页 #cinput vs 聊天页 #tk-sayin）
 */
export default {
  name: 'r47-r48-probe',
  check: async (page) => {
    const action = process.env.ACTION || 'geom';
    await page.waitForTimeout(400);
    if (action === 'install') return page.evaluate(() => {
      const ta = document.getElementById('cinput');
      if (!ta) return { ok: false, why: 'no #cinput' };
      if (window.__ev) return { ok: true, already: true, n: window.__ev.length };
      window.__ev = [];
      const rec = (e) => window.__ev.push({
        t: e.type, key: e.key ?? null, code: e.code ?? null, kc: e.keyCode ?? null,
        isComp: e.isComposing ?? null, ih: e.inputType ?? null, data: e.data ?? null,
        val: e.target && e.target.value !== undefined ? String(e.target.value).slice(0, 30) : null,
        ms: Math.round(performance.now())
      });
      ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionend'].forEach((t) => ta.addEventListener(t, rec, true));
      return { ok: true, installed: true, hint: ta.getAttribute('enterkeyhint'), inputmode: ta.getAttribute('inputmode') };
    });
    if (action === 'events') return page.evaluate(() => ({ n: (window.__ev || []).length, ev: (window.__ev || []).slice(-20) }));
    if (action === 'hint') return page.evaluate(() => ({
      termInput: (() => { const e = document.getElementById('cinput'); return e ? { enterkeyhint: e.getAttribute('enterkeyhint'), inputmode: e.getAttribute('inputmode'), tag: e.tagName } : null; })(),
      chatInput: (() => { const e = document.querySelector('#tk-sayin'); return e ? { enterkeyhint: e.getAttribute('enterkeyhint'), inputmode: e.getAttribute('inputmode'), tag: e.tagName } : null; })(),
      chatInputsInDom: document.querySelectorAll('#tk-sayin').length
    }));
    /* geom：固定密度比 device = css * (1080/innerWidth_full) + (0,136)；键盘弹出只改可视区高度 */
    return page.evaluate(() => {
      const SX = 1080 / 393, SY = 2138 / 778;              // 与 393x778 的 css 布局对应（固定）
      const vv = window.visualViewport;
      const dev = (el, fx = 0.5, fy = 0.5) => { const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width * fx) * SX), y: Math.round(136 + (r.y + r.height * fy) * SY) }; };
      const hitAt = (d) => { const e = document.elementFromPoint((d.x) / SX, (d.y - 136) / SY); return e ? e.tagName + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ')[0] : '') : null; };
      const one = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const d = dev(el);
        return {
          tag: el.tagName + (el.id ? '#' + el.id : ''), label: (el.textContent || '').trim().slice(0, 8),
          css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          dp: { w: Math.round(r.width), h: Math.round(r.height) },     // 1 css px = 1 dp（density 2.748）
          devCenter: d, hitAtDevCenter: hitAt(d),
          inViewport: r.top >= -0.5 && r.bottom <= (vv ? vv.height : window.innerHeight) + 0.5,
          belowVisualViewport: r.bottom > (vv ? vv.height : window.innerHeight) + 0.5,
          partlyBelowVv: r.top < (vv ? vv.height : window.innerHeight) && r.bottom > (vv ? vv.height : window.innerHeight)
        };
      };
      const kbKeys = [...document.querySelectorAll('#keybar button')].filter((b) => b.getBoundingClientRect().height > 0);
      const enter = kbKeys.find((b) => b.textContent.trim() === '⏎');
      return {
        layout: { innerW: window.innerWidth, innerH: window.innerHeight, screen: { w: window.screen.width, h: window.screen.height } },
        visualViewport: vv ? { h: Math.round(vv.height), top: Math.round(vv.offsetTop), scale: vv.scale } : null,
        keyboardUp: !!(vv && vv.height < window.innerHeight + 0.5),
        input: (() => { const e = document.getElementById('cinput'); const g = one(e); return g ? Object.assign(g, { value: e.value, focused: document.activeElement === e, enterkeyhint: e.getAttribute('enterkeyhint') }) : null; })(),
        csend: one(document.getElementById('csend')),
        cmode: one(document.getElementById('cmode')),
        keybarEnter: one(enter),
        keybarVisibleKeys: kbKeys.length,
        composerVisible: !document.getElementById('composer').classList.contains('hidden'),
        mode: (document.getElementById('csend') || {}).textContent
      };
    });
  }
};
