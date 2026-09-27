/* R-41 第 4 步修正 验收探针：Gboard 形状（只 compositionstart 不给 compositionend）必须能发；
 * 只拦 keyCode===229；组字态 1.5s 兜底复位；同一次回车只 1 条、600ms 连按 2 条；Shift+Enter 不发。
 * 事件形状照真机复测 evidence/R41-复测-20260925/结论-R41-复测.txt。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r41-enter.mjs
 */
export default {
  name: 'R-41 修正验收：Gboard 组字态也能回车发送 + 229 拦 + 组字态兜底复位',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      window.__sent = { shout: 0, say: 0, answer: 0 };
      window.__asks = { asks: [{ id: 123, from: 'owner.me', topic: '【授权】测试授权', body: '请批准' }] };
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && (m.t === 'talk.shout' || m.t === 'talk.say' || m.t === 'talk.answer')) {
          const k = m.t.split('.')[1];
          window.__sent[k] = (window.__sent[k] || 0) + 1;
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { ok: true, ms: 12, delivered: true } }) }), 10);
          return;
        }
        if (m && m.t === 'talk.asks') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: window.__asks }) }), 10); return; }
        if (m && m.t === 'talk.roles') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { channels: {}, scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.tester', name: 'tester', title: '测试者', online: true }] }] } }) }), 10); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { sessions: [] } }) }), 10); return; }
        return window.__orig(t);
      };
      /* 派事件：keyCode / isComposing 都能给（真机读数里 keyCode=13 而 isComposing=true 是常态） */
      window.__ev = (el, kind, opt) => {
        const o = Object.assign({ bubbles: true, cancelable: true }, opt || {});
        const kc = o.kc, comp = o.isComposing;
        if (kind === 'kd' || kind === 'ku') {
          const e = new KeyboardEvent(kind === 'kd' ? 'keydown' : 'keyup',
            { key: 'Enter', shiftKey: !!o.shiftKey, isComposing: !!comp, bubbles: o.bubbles, cancelable: o.cancelable });
          if (kc !== undefined) Object.defineProperty(e, 'keyCode', { get: () => kc });
          return el.dispatchEvent(e);
        }
        if (kind === 'bi') return el.dispatchEvent(new InputEvent('beforeinput', Object.assign({ inputType: 'insertLineBreak' }, { bubbles: o.bubbles, cancelable: o.cancelable })));
        if (kind === 'cs') return el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        if (kind === 'ce') return el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
        return false;
      };
      window.__full = (el, text, shift) => { el.value = text; window.__ev(el, 'kd', { kc: 13, shiftKey: !!shift }); window.__ev(el, 'bi', {}); window.__ev(el, 'ku', { kc: 13, shiftKey: !!shift }); };
      /* 真机 Gboard 形状：先 compositionstart，回车是 isComposing=true + keyCode=13，**全程没有 compositionend** */
      window.__gboard = (el, text) => {
        el.value = text;
        window.__ev(el, 'cs', {});
        window.__ev(el, 'kd', { kc: 13, isComposing: true });
        window.__ev(el, 'bi', {});
        window.__ev(el, 'ku', { kc: 13, isComposing: true });
      };
    });

    /* 进群聊页，拿到真输入框 */
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 400)); });
    out['00_群聊输入框'] = await page.evaluate(() => {
      const el = document.getElementById('tk-shoutin');
      return { 在: !!el, enterkeyhint: el && el.getAttribute('enterkeyhint') };
    });

    /* ① Gboard 形状（组字态 + isComposing 的 Enter，无 compositionend）—— 必须发 1 条 */
    out['01_Gboard形状'] = await page.evaluate(() => {
      window.__sent.shout = 0;
      const el = document.getElementById('tk-shoutin');
      window.__gboard(el, 'Gboard 确认并发送');
      return { shout: window.__sent.shout, 发完清空了吗: el.value === '', 文字还在吗: el.value, 组字态: el.__enterState ? el.__enterState() : null };
    });
    await page.waitForTimeout(150);

    /* ② 组字态 1.5s 兜底复位（读数：复位前 / 复位后） */
    out['02_组字态兜底复位'] = await page.evaluate(async () => {
      const el = document.getElementById('tk-shoutin');
      window.__ev(el, 'cs', {});
      const before = el.__enterState();
      await new Promise((r) => setTimeout(r, 1800));
      const after = el.__enterState();
      return { 复位前: before, 复位后: after };
    });

    /* ③ 只拦 keyCode===229：229 的 Enter 不发；同框随后正常 Enter 仍能发 */
    out['03_229拦与正常能发'] = await page.evaluate(() => {
      window.__sent.shout = 0;
      const el = document.getElementById('tk-shoutin');
      el.value = '合成中间态';
      window.__ev(el, 'kd', { kc: 229, isComposing: true });
      window.__ev(el, 'ku', { kc: 229, isComposing: true });
      const after229 = window.__sent.shout;
      el.value = '正常回车';
      window.__full(el, '正常回车', false);
      return { '229发了': after229, '随后正常回车发了': window.__sent.shout };
    });
    await page.waitForTimeout(150);

    /* ④ 同一次回车只 1 条 ＋ 600ms 连按 2 条 ＋ Shift+Enter 0 条（文字留着） */
    out['04_闸与Shift'] = await page.evaluate(async () => {
      const el = document.getElementById('tk-shoutin');
      window.__sent.shout = 0;
      window.__full(el, '一次回车', false);
      const once = window.__sent.shout;
      await new Promise((r) => setTimeout(r, 600));
      window.__full(el, '第一下', false);
      await new Promise((r) => setTimeout(r, 600));
      window.__full(el, '第二下', false);
      const twice = window.__sent.shout - once;
      el.value = 'Shift 不该发';
      window.__ev(el, 'kd', { kc: 13, shiftKey: true });
      window.__ev(el, 'bi', {});
      window.__ev(el, 'ku', { kc: 13, shiftKey: true });
      return { 一次回车: once, 连按两次: twice, Shift后新增: window.__sent.shout - once - twice, Shift文字還在: el.value };
    });
    await page.waitForTimeout(150);

    /* ⑤ 单聊页（修复对着的那页）＋ 授权框：Gboard 形状也要能发 */
    out['05_单聊'] = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await HP.Talk.openRole('pipeline.tester');
      await new Promise((r) => setTimeout(r, 600));
      const el = document.getElementById('tk-sayin');
      if (!el) return { error: '没找到 #tk-sayin' };
      window.__sent.say = 0;
      window.__gboard(el, '单聊 Gboard 回车');
      const g = window.__sent.say;
      await new Promise((r) => setTimeout(r, 600));      /* 等上一条落终态（R-31 防连点会挡没落定的下一条） */
      window.__sent.say = 0;
      window.__full(el, '单聊正常回车', false);
      return { enterkeyhint: el.getAttribute('enterkeyhint'), Gboard形状: g, 正常回车: window.__sent.say };
    });
    out['06_授权框'] = await page.evaluate(async () => {
      HP.Talk.asks = window.__asks.asks;
      HP.Talk.view = 'channel';
      HP.App.showBoard('talk');
      await new Promise((r) => setTimeout(r, 600));
      const a = document.querySelector('#tk-asks .tk-askin');
      if (!a) return { error: '没找到授权框' };
      window.__sent.answer = 0;
      window.__gboard(a, '授权框 Gboard 回车');
      return { enterkeyhint: a.getAttribute('enterkeyhint'), answer: window.__sent.answer };
    });

    out['07_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
