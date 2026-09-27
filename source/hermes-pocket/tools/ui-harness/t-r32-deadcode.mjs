/* R-32 验收探针：死调用清理后 —— 30s 内 0 条报错、轮询照跑、气泡路径仍通、发送状态行仍出终态
 * 真页面 + 真 2.5s 轮询（talk.since 计数来自假桥的 __calls）；三段观察。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r32-deadcode.mjs
 */
export default {
  name: 'R-32 验收：删掉 pullRoleOutput 三处调用 + 死 live 分支后，30s 0 报错、轮询仍在、气泡与终态照常',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
    const out = {};

    /* ① 源码自查：三处都不再引用 pullRoleOutput；该方法本来就没有定义（**先去掉注释**，注释里写着"原来有"） */
    out['①_源码自查'] = await page.evaluate(() => {
      const strip = (s) => String(s || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      const src = (f) => strip(f ? f.toString() : '');
      return {
        poll回调里还有引用: /pullRoleOutput/.test(src(HP.Talk.startPoll)),
        发送fire里还有引用: /pullRoleOutput/.test(src(HP.Talk.paintRole)),
        paintChat里还有引用: /pullRoleOutput/.test(src(HP.Talk.paintChat)),
        方法定义存在吗: typeof HP.Talk.pullRoleOutput === 'function',
        全源码里还有活引用吗: /pullRoleOutput/.test(strip(document.documentElement.innerHTML)) ? '（HTML 里可能带注释，忽略）' : '否',
        死live分支还在吗: /this\.live\s*\|\|\s*\{\}/.test(src(HP.Talk.paintChat))
      };
    });

    /* 准备：进单聊页，开真轮询；thread 回两条消息（气泡路径） */
    await page.evaluate(() => {
      HP.Talk.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline', online: true }];
      window.__r32Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.thread') {
          const data = { role: 'pipeline.tester', count: 2, items: [
            { id: 1, who: 'him', body: '他说的第一条', at: Math.floor(Date.now() / 1000) },
            { id: 2, who: 'me', body: '我说的第二条', at: Math.floor(Date.now() / 1000) }
          ] };
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: data }) }), 20);
          return;
        }
        return window.__r32Orig(t);
      };
      HP.App.showBoard('talk');
    });
    await page.waitForTimeout(200);
    await page.evaluate(async () => { await HP.Talk.openRole('pipeline.tester'); });
    await page.waitForTimeout(600);

    out['②_气泡路径'] = await page.evaluate(() => ({
      气泡数: document.querySelectorAll('#tk-chat .tk-bub').length,
      他的气泡可点: !![...document.querySelectorAll('#tk-chat .tk-bub.him')].find((b) => b.getAttribute('data-tapwho') === '1')
    }));

    /* ③ 单聊页连续 30s（真轮询在跑）：报错必须 0，talk.since 必须还在被调 */
    const t0 = errs.length;
    await page.evaluate(() => { window.__calls = {}; });
    await page.waitForTimeout(30000);
    out['③_单聊30s'] = await page.evaluate(() => ({
      seconds: 30,
      'talk_since 次数': (window.__calls || {})['talk.since'] || 0,
      轮询间隔秒: HP.Talk.pollStats().间隔秒,
      轮询表在: !!HP.Talk.timer
    }));
    out['③_单聊30s_报错'] = { 这30s新增错误: errs.length - t0, 明细: errs.slice(0, 5) };

    /* ④ 发完消息仍出终态（R-31/R-36 状态机没被连累） */
    out['④_发送终态'] = await page.evaluate(async () => {
      const orig = window.HermesPocket.postMessage;
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.say') {
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { to: 'pipeline.tester', kind: 'private', delivered: true, raw: { delivered: true, ms: 1370 } } }) }), 20);
          return;
        }
        return orig(t);
      };
      await HP.Talk.send('pipeline.tester', 'private', '探针：清理后仍要出终态');
      await new Promise((r) => setTimeout(r, 400));
      window.HermesPocket.postMessage = orig;
      const box = document.getElementById('tk-sends');
      const last = box ? [...box.querySelectorAll('[data-testid="talk-sendrow"]')].pop() : null;
      return { 状态行: last ? last.innerText.replace(/\s+/g, ' ').trim() : null, 状态: last ? last.getAttribute('data-state') : null };
    });

    /* ⑤ 跨块：群聊页 6s（共用同一个 timer 与 tick） */
    await page.evaluate(() => { window.__calls = {}; HP.App.showBoard('group'); });
    await page.waitForTimeout(6200);
    out['⑤_群聊6s'] = await page.evaluate(() => ({
      'talk_since 次数': (window.__calls || {})['talk.since'] || 0,
      群聊流在: !!document.getElementById('tk-stream')
    }));
    out['⑤_群聊6s_报错'] = { 这一段新增错误: errs.length - t0, 明细: errs.slice(0, 5) };

    out['⑥_全程报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
