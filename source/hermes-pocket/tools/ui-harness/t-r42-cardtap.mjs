/* R-42 验收探针：卡片单击＝一步进单聊；信息窗入口改成右侧箭头热区（≥44dp）；.tk-chrow ≥44px；
 * 单聊页 R-37「点抬头开信息窗」仍好使；R-40 编号副行不受影响。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r42-cardtap.mjs
 */
export default {
  name: 'R-42 验收：卡片一步进单聊 + 箭头热区 ≥44dp + 抬头开窗不回归',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      window.__calls = { thread: 0, ask: 0 };
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.__SESS = { sessions: [
        { id: 6, kind: 'role', name: 'owner.me', role: 'owner.me', tmux: 'roles:owner-me', alive: true, last_used: 1790257930 },
        { id: 5, kind: 'role', name: 'pipeline.tester', role: 'pipeline.tester', tmux: 'roles:pipeline-tester', alive: true, last_used: 1790257938 }
      ] };
      window.__ROLES = { channels: { qqbot: ['home.maid'], roles: ['owner.me', 'pipeline.tester'] }, scenes: [
        { scene: 'owner', roles: [{ full_name: 'owner.me', name: 'me', title: '经理（管流程/派活/判报告；不是本人）', online: true, channels: ['roles'] }] },
        { scene: 'pipeline', roles: [{ full_name: 'pipeline.tester', name: 'tester', title: '测试者', online: true, channels: ['roles'] }] }
      ] };
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.roles') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: window.__ROLES }) }), 10); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: window.__SESS }) }), 10); return; }
        if (m && m.t === 'talk.thread') {
          window.__calls.thread++;
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { role: 'owner.me', count: 1, items: [{ id: 1, who: 'him', body: '在的', at: 1790257930 }] } }) }), 10);
          return;
        }
        return window.__orig(t);
      };
      HP.App.showBoard('talk');
    });
    await page.waitForTimeout(900);

    /* ① 卡片单击 = 一步进单聊（点名称那一片，不点右侧箭头） */
    out['01_点卡片进单聊'] = await page.evaluate(async () => {
      const card = document.querySelector('[data-testid="talk-role"]');
      if (!card) return { error: '没找到角色卡' };
      const name = card.querySelector('.name');
      name.click();                                   /* 真点：卡片左半边（名称） */
      await new Promise((r) => setTimeout(r, 700));
      const sayin = document.getElementById('tk-sayin');
      const sheet = document.getElementById('tk-sheet');
      return {
        进到单聊页了吗: !!sayin,
        单聊页有发送键吗: !!document.getElementById('tk-sayok'),
        信息窗开了吗: !!sheet,
        请求过会话内容: window.__calls.thread
      };
    });

    /* ② 单聊页里 R-37 的「点抬头开信息窗」仍然好使（回归） */
    out['02_抬头开窗不回归'] = await page.evaluate(async () => {
      const t = document.querySelector('.tk-title');
      if (!t) return { error: '没找到抬头' };
      t.click();
      await new Promise((r) => setTimeout(r, 300));
      const sheet = document.getElementById('tk-sheet');
      const rows = sheet ? [...sheet.querySelectorAll('.tk-sheetrow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()) : [];
      if (sheet) sheet.remove ? sheet.remove() : null;
      return { 信息窗开了吗: !!sheet, 行数: rows.length, 会话行: rows.filter((r) => r.indexOf('会话') === 0) };
    });

    /* 回频道页：量热区、点箭头 */
    await page.evaluate(async () => { HP.Talk.view = 'channel'; HP.App.showBoard('talk'); await new Promise((r) => setTimeout(r, 600)); });
    out['03_热区尺寸'] = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="talk-role"]');
      const hit = card && card.querySelector('[data-testid="talk-rolecaret"]');
      if (!hit) return { error: '没找到箭头热区' };
      hit.scrollIntoView({ block: 'center' });
      const r = hit.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      /* 四角 + 中心都该命中热区自己（R-33 的坑：elementFromPoint 只认视口内的点） */
      const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [r.left + r.width / 2, r.top + r.height / 2]];
      const hits = pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return !!(el && (el === hit || el.closest('[data-testid="talk-rolecaret"]'))); });
      return {
        热区宽: Math.round(r.width), 热区高: Math.round(r.height),
        卡片高: Math.round(cr.height),
        四角与中心都命中: hits,
        箭头符号在: !!card.querySelector('.tk-caret')
      };
    });
    out['04_频道行高度'] = await page.evaluate(async () => {
      const tg = document.getElementById('tk-channels-toggle');
      if (tg) { tg.click(); await new Promise((r) => setTimeout(r, 500)); }   /* 折着的时候行不在 DOM 里，先展开（只量高度，不改它的行为） */
      const rows = [...document.querySelectorAll('.tk-chrow')];
      if (!rows.length) return { error: '没找到 .tk-chrow（接入表为空？）' };
      return { 行数: rows.length, 高度px: rows.map((d) => Math.round(d.getBoundingClientRect().height)) };
    });

    /* ⑤ 点箭头热区 = 开信息窗（且不进单聊） */
    out['05_点箭头开窗'] = await page.evaluate(async () => {
      const card = document.querySelector('[data-testid="talk-role"]');
      const hit = card.querySelector('[data-testid="talk-rolecaret"]');
      hit.click();
      await new Promise((r) => setTimeout(r, 400));
      const sheet = document.getElementById('tk-sheet');
      const rows = sheet ? [...sheet.querySelectorAll('.tk-sheetrow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim()) : [];
      return {
        信息窗开了吗: !!sheet,
        行数: rows.length,
        会话行: rows.filter((r) => r.indexOf('会话') === 0),
        副行编号: (card.querySelector('.sub') || {}).textContent,
        还留在频道页吗: !!document.querySelector('[data-testid="talk-role"]') && !document.getElementById('tk-sayin')
      };
    });

    out['06_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
