/* R-31（发送消息的迟滞与反馈）界面侧定位探针：走**真发送函数** HP.Talk.send()，
 * 在原生桥那一层拦一道，量三件事：
 *   ① 桥回来一个「没投成」的收据（形状同 Bridge.kt talk.say: delivered:false）时，界面会不会显示失败；
 *   ② 桥**不给回执**时，界面会不会出现「还在发 / 发送中」；
 *   ③ 发一条消息，界面到底有没有耗时读数、有没有 per-message 状态。
 * 只读不写：不改 talk.js、不改平台数据（拦的是本页面的桥，跑完就还原）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r31-send.mjs
 */
export default {
  name: 'R-31 定位：发送后的反馈与耗时（真 HP.Talk.send + 拦桥回执）',

  check: async (page) => {
    const out = {};

    /* ① 桥回「delivered:false」（没投成）：界面该报出来吗？ */
    out.收据说没投成时 = await page.evaluate(async () => {
      const T = HP.Talk;
      T.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline' }];
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      let seen = null;
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.say') {
          seen = m;
          const receipt = { t: 'res', _rid: m._rid, ok: true, data: { to: m.role, kind: m.kind, delivered: false, raw: {} } };
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify(receipt) }), 30);
          return;
        }
        return origPost(t);
      };
      const t0 = performance.now();
      let err = '';
      await T.send('pipeline.tester', 'private', '探针：一句测试').catch((e) => { err = String((e && e.message) || e); });
      const ms = Math.round(performance.now() - t0);
      const toast = document.getElementById('toast');
      const toastText = (toast && toast.textContent) || '';
      const stateKeys = Object.keys(T).filter((k) => /state|ack|sent|pending|timing|deliver|receipt/i.test(k));
      window.HermesPocket.postMessage = origPost;
      return {
        发出去的请求: seen && { op: seen.t, role: seen.role, kind: seen.kind },
        界面这段耗时ms: ms,
        报错: err,
        toast原文: toastText,
        '页面出现送达/发送中/耗时字样': /已送达|发送中|还在发|耗时/.test(document.body.innerText || ''),
        Talk上的送达状态字段: stateKeys
      };
    });

    /* ② 桥不答（无回执）：界面会不会显示「还在发」 */
    out.桥不答时 = await page.evaluate(async () => {
      const T = HP.Talk;
      const origPost = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.say') return;          /* 装死：不回 */
        return origPost(t);
      };
      let settled = false, err = '';
      const before = (document.getElementById('toast') || {}).textContent || '';
      T.send('pipeline.tester', 'private', '探针：桥不答').then(() => { settled = true; }).catch((e) => { err = String((e && e.message) || e); settled = true; });
      await new Promise((r) => setTimeout(r, 3000));
      const toast = document.getElementById('toast');
      const res = {
        三秒后promise已结束: settled,
        报错: err,
        发送前的toast: before,
        发送后的toast: (toast && toast.textContent) || '',
        toast在闪: !!(toast && toast.classList.contains('show')),
        '页面出现还在发或发送中': /还在发|发送中/.test(document.body.innerText || '')
      };
      window.HermesPocket.postMessage = origPost;
      return res;
    });

    return out;
  }
};
