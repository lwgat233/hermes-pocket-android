/* R-45 验收探针：Shift+Enter 不再被 keyup 清零放行（时间戳闩），R-41 的兜底不回归。
 * 七用例（作者口径）+ 祸根形状「Shift 先松、Enter 后松」。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r45-shift.mjs
 */
export default {
  name: 'R-45 验收：Shift+Enter 0 条、普通回车 1 条、keyup13 兜底不回归',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      window.__sent = { shout: 0 };
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.shout') {
          window.__sent.shout++;
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { ok: true, ms: 11, delivered: true } }) }), 8);
          return;
        }
        if (m && m.t === 'talk.roles') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { channels: {}, scenes: [] } }) }), 8); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { sessions: [] } }) }), 8); return; }
        return window.__orig(t);
      };
      /* 通用派事件：key / keyCode / shiftKey / isComposing 都能给（真机 Shift 的 keydown 可能带 shiftKey=false） */
      window.__ev = (el, type, o) => {
        const opt = o || {};
        const k = opt.key || 'Enter';
        const e = new KeyboardEvent(type, { key: k, shiftKey: !!opt.shiftKey, isComposing: !!opt.isComposing, bubbles: true, cancelable: true });
        if (opt.kc !== undefined) Object.defineProperty(e, 'keyCode', { get: () => opt.kc });
        return el.dispatchEvent(e);
      };
      window.__bi = (el) => el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }));
    });
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 400)); });
    const inp = () => page.evaluate(() => {
      const el = document.getElementById('tk-shoutin');
      el.value = 'x';
      window.__sent.shout = 0;
      return !!el;
    });
    const sent = () => page.evaluate(() => window.__sent.shout);
    const sleep = (ms) => page.waitForTimeout(ms);

    /* ① 普通回车（三路全触发）⇒ 1 条 */
    await inp();
    await page.evaluate(() => { const el = document.getElementById('tk-shoutin'); window.__ev(el, 'keydown', { kc: 13 }); window.__bi(el); window.__ev(el, 'keyup', { kc: 13 }); });
    await sleep(120);
    out['①_普通回车'] = { 发出: await sent(), 期望: 1 };

    /* ② 祸根形状：Shift 先松、Enter 后松（Shift kd → Enter kd(shift) → Shift ku(shift=false) → Enter ku(shift=false)）⇒ 0 条 */
    await sleep(600);
    await inp();
    await page.evaluate(() => {
      const el = document.getElementById('tk-shoutin');
      window.__ev(el, 'keydown', { key: 'Shift', shiftKey: false });     /* 真机 Shift 的 keydown 可能带 shiftKey=false */
      window.__ev(el, 'keydown', { kc: 13, shiftKey: true });
      window.__bi(el);
      window.__ev(el, 'keyup', { key: 'Shift', shiftKey: false });       /* 祸根行：这一下会带 shiftKey=false */
      window.__ev(el, 'keyup', { kc: 13, shiftKey: false });             /* Enter 后松，也带 false */
    });
    await sleep(120);
    out['②_祸根形状_Shift先松'] = { 发出: await sent(), 期望: 0, 文字还在吗: await page.evaluate(() => document.getElementById('tk-shoutin').value) };

    /* ③ Shift+Enter 完整形状（Shift kd → Enter kd shift → bi → Enter ku shift → Shift ku）⇒ 0 条 */
    await sleep(600);
    await inp();
    await page.evaluate(() => {
      const el = document.getElementById('tk-shoutin');
      window.__ev(el, 'keydown', { key: 'Shift', shiftKey: true });
      window.__ev(el, 'keydown', { kc: 13, shiftKey: true });
      window.__bi(el);
      window.__ev(el, 'keyup', { kc: 13, shiftKey: true });
      window.__ev(el, 'keyup', { key: 'Shift', shiftKey: false });
    });
    await sleep(120);
    out['③_Shift回车'] = { 发出: await sent(), 期望: 0, 文字还在吗: await page.evaluate(() => document.getElementById('tk-shoutin').value) };

    /* ④ beforeinput 单路 ⇒ 1 条 */
    await sleep(600);
    await inp();
    await page.evaluate(() => { window.__bi(document.getElementById('tk-shoutin')); });
    await sleep(120);
    out['④_beforeinput兜底'] = { 发出: await sent(), 期望: 1 };

    /* ⑤ 只给 keyup13（输入法提交形状，R-41 救回来的那条）⇒ 1 条 */
    await sleep(600);
    await inp();
    await page.evaluate(() => { window.__ev(document.getElementById('tk-shoutin'), 'keyup', { kc: 13 }); });
    await sleep(120);
    out['⑤_只给keyup13'] = { 发出: await sent(), 期望: 1 };

    /* ⑥ 同一次按键三条路全触发 ⇒ 1 条（与 ① 同形，单列出来对齐作者用例） */
    await sleep(600);
    await inp();
    await page.evaluate(() => { const el = document.getElementById('tk-shoutin'); window.__ev(el, 'keydown', { kc: 13 }); window.__bi(el); window.__ev(el, 'keyup', { kc: 13 }); window.__bi(el); window.__ev(el, 'keyup', { kc: 13 }); });
    await sleep(150);
    out['⑥_三条路同触发'] = { 发出: await sent(), 期望: 1 };

    /* ⑦ 连按两次（间隔 600ms）⇒ 2 条 */
    await sleep(600);
    await inp();
    await page.evaluate(() => { const el = document.getElementById('tk-shoutin'); window.__ev(el, 'keydown', { kc: 13 }); window.__bi(el); window.__ev(el, 'keyup', { kc: 13 }); });
    await sleep(600);
    await page.evaluate(() => { const el = document.getElementById('tk-shoutin'); el.value = 'y'; window.__ev(el, 'keydown', { kc: 13 }); window.__bi(el); window.__ev(el, 'keyup', { kc: 13 }); });
    await sleep(150);
    out['⑦_连按两次'] = { 发出: await sent(), 期望: 2 };

    /* ⑧ Shift+Enter 之后紧接着普通回车（间隔 600ms，闩过期）⇒ 1 条（不粘滞） */
    await sleep(600);
    await inp();
    await page.evaluate(() => {
      const el = document.getElementById('tk-shoutin');
      window.__ev(el, 'keydown', { key: 'Shift', shiftKey: true });
      window.__ev(el, 'keydown', { kc: 13, shiftKey: true });
      window.__ev(el, 'keyup', { kc: 13, shiftKey: false });
      window.__ev(el, 'keyup', { key: 'Shift', shiftKey: false });
    });
    const afterShift = await sent();
    await sleep(600);
    await page.evaluate(() => { const el = document.getElementById('tk-shoutin'); el.value = 'z'; window.__ev(el, 'keydown', { kc: 13 }); window.__bi(el); window.__ev(el, 'keyup', { kc: 13 }); });
    await sleep(150);
    out['⑧_Shift后紧接回车'] = { Shift那下发出: afterShift, 随后回车累计: await sent(), 期望累计: 1 };

    out['⑨_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
