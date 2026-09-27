/* R48：终端页 #cinput 事件采集器（每次调用都重新挂到"当前"节点上，避免节点被换掉后收不到）
 * ACTION=install（重置并重新挂）| read（读全部）| count229（只数 keyCode 229） | hint（读 enterkeyhint）
 */
export default {
  name: 'r48-events',
  check: async (page) => {
    const action = process.env.ACTION || 'read';
    await page.waitForTimeout(300);
    if (action === 'hint') return page.evaluate(() => {
      const e = document.getElementById('cinput');
      const kb = [...document.querySelectorAll('#keybar button')].filter((b) => b.getBoundingClientRect().height > 0);
      const ent = kb.find((b) => b.textContent.trim() === '⏎');
      return { enterkeyhint: e ? e.getAttribute('enterkeyhint') : null, inputmode: e ? e.getAttribute('inputmode') : null, tag: e ? e.tagName : null, keybarKeys: kb.length, keybarEnterFound: !!ent };
    });
    if (action === 'install') return page.evaluate(() => {
      const ta = document.getElementById('cinput');
      if (!ta) return { ok: false, why: 'no #cinput' };
      window.__ev = [];
      const rec = (e) => window.__ev.push({ t: e.type, key: e.key ?? null, kc: e.keyCode ?? null, rep: e.repeat ?? null, isComp: e.isComposing ?? null, ih: e.inputType ?? null, val: e.target && e.target.value !== undefined ? String(e.target.value).slice(0, 24) : null, ms: Math.round(performance.now()) });
      ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionend'].forEach((t) => ta.addEventListener(t, rec, true));
      window.__hookedEl = ta;
      return { ok: true, enterkeyhint: ta.getAttribute('enterkeyhint'), mode: ta.getAttribute('inputmode') };
    });
    if (action === 'count229') return page.evaluate(() => {
      const ev = window.__ev || [];
      const c229 = ev.filter((x) => x.kc === 229).length;
      const kinds = {};
      ev.forEach((x) => { kinds[x.t] = (kinds[x.t] || 0) + 1; });
      return { n: ev.length, kc229: c229, kinds, repeats: ev.filter((x) => x.rep).length, compTrue: ev.filter((x) => x.isComp).length, last: ev.slice(-12) };
    });
    return page.evaluate(() => ({ n: (window.__ev || []).length, ev: (window.__ev || []).slice(-30), hookedInDom: !!(window.__hookedEl && document.contains(window.__hookedEl)) }));
  }
};
