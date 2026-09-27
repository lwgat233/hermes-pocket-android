/* hermes-pocket-终端回车 第 1 步 · 终端页输入框/键条读数探针（只读）
 * 跑法： node tools/ui-harness/dev-probe.mjs <本文件>
 * 给出：① enterkeyhint/输入模式 ② 输入框与「⏎」键位几何（px/dp/可视区/命中谁）③ 键事件采集器安装开关
 *   env: ACTION=install|read|events|clear  （默认 read）
 */
export default {
  name: 'r47-term-probe',
  check: async (page) => {
    const action = process.env.ACTION || 'read';
    await page.waitForTimeout(500);
    if (action === 'install') {
      return page.evaluate(() => {
        const ta = document.getElementById('cinput');
        if (!ta) return { ok: false, why: 'no #cinput' };
        window.__ev = [];
        const rec = (e) => {
          window.__ev.push({
            t: e.type, key: e.key ?? null, code: e.code ?? null, kc: e.keyCode ?? null,
            which: e.which ?? null, isComp: e.isComposing ?? null, data: e.data ?? null,
            ih: (e.inputType ?? null), ts: Math.round(performance.now()),
            val: (e.target && e.target.value !== undefined) ? String(e.target.value).slice(0, 40) : null,
            tgt: e.target ? (e.target.id || e.target.tagName) : null
          });
        };
        ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionend'].forEach((t) =>
          ta.addEventListener(t, rec, true));
        ta.__r47hook = rec;
        return { ok: true, installed: window.__ev.length, hint: ta.getAttribute('enterkeyhint'), mode: ta.getAttribute('inputmode') };
      });
    }
    if (action === 'events') {
      return page.evaluate(() => ({ n: (window.__ev || []).length, ev: (window.__ev || []).slice(-24) }));
    }
    if (action === 'clear') {
      return page.evaluate(() => { window.__ev = []; return { ok: true }; });
    }
    return page.evaluate(() => {
      const dp = (px) => Math.round((px / (window.innerWidth / (window.screen.width || window.innerWidth))) * 10) / 10;
      const scale = window.innerWidth / 1080;              // css 宽 / 设备宽 ⇒ 设备px = css*scaleX？
      const sx = 1080 / window.innerWidth, sy = 2138 / window.innerHeight;
      const m = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), dp: Math.round(r.height / 2.75 * 10) / 10, dev: { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy) } }; };
      const hit = (el) => { const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? (e.tagName + (e.id ? '#' + e.id : '') + (e.className ? '.' + String(e.className).split(' ')[0] : '')) : null; };
      const ta = document.getElementById('cinput'), cs = document.getElementById('csend'), cm = document.getElementById('cmode');
      const kb = [...document.querySelectorAll('#keybar button')].filter((b) => b.getBoundingClientRect().height > 0);
      const kbEnter = kb.find((b) => b.textContent.trim() === '⏎') || kb[kb.length - 1];
      const vv = window.visualViewport;
      const inView = (el) => { const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inViewport: r.top >= 0 && r.bottom <= (vv ? vv.height : window.innerHeight) + 0.5, belowViewport: r.bottom > (vv ? vv.height : window.innerHeight), coveredByVv: r.bottom > (vv ? vv.offsetTop + vv.height : window.innerHeight) }; };
      return {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        screen: { w: window.screen.width, h: window.screen.height },
        visualViewport: vv ? { height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop), offsetLeft: Math.round(vv.offsetLeft), scale: vv.scale } : null,
        dpr: window.devicePixelRatio, sx: Math.round(sx * 1000) / 1000, sy: Math.round(sy * 1000) / 1000,
        composerVisible: !document.getElementById('composer').classList.contains('hidden'),
        input: ta ? Object.assign({ enterkeyhint: ta.getAttribute('enterkeyhint'), inputmode: ta.getAttribute('inputmode'), value: ta.value, focused: document.activeElement === ta, type: ta.tagName }, m(ta), inView(ta), { hitCenter: hit(ta) }) : null,
        csendBtn: cs ? Object.assign({ label: cs.textContent.trim() }, m(cs), inView(cs), { hitCenter: hit(cs) }) : null,
        cmodeBtn: cm ? Object.assign({ label: cm.textContent.trim() }, m(cm), inView(cm), { hitCenter: hit(cm) }) : null,
        keybar: { visibleKeys: kb.length, text: kb.map((b) => b.textContent.trim()).join(''), enter: kbEnter ? Object.assign({ label: kbEnter.textContent.trim() }, m(kbEnter), inView(kbEnter), { hitCenter: hit(kbEnter) }) : null },
        chatInputForCompare: (() => { const i = document.querySelector('#tk-sayin'); return i ? { enterkeyhint: i.getAttribute('enterkeyhint'), inputmode: i.getAttribute('inputmode') } : null; })()
      };
    });
  }
};
