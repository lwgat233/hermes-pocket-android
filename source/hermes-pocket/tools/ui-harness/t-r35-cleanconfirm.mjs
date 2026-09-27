/* R-35 验收探针：清理键的二次确认（真弹出 / 取消什么都不做 / 确定才执行）
 * 走真页面：进设置页点 [data-store="clean"]，读真 DOM 里的确认框（HP.App.confirm 的 .hp-dialog + [data-y]/[data-n]）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r35-cleanconfirm.mjs
 */
export default {
  name: 'R-35 验收：点「清理」先弹确认（含键数/KB）、取消不动、确定才清 + 原 toast 照旧',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    /* 造一批可清的缓存：3 个 30 天没用过的键 + 1 个今天的（预期确认框写「3 个键」） */
    await page.evaluate(() => {
      HP.Talk.pullRoleOutput = () => { };
      HP.Cache.clearAll();
      HP.Cache.set('thread.old1', { items: [{ id: 1, body: 'x'.repeat(400) }] }, { now: true });
      HP.Cache.set('thread.old2', { items: [{ id: 1, body: 'y'.repeat(400) }] }, { now: true });
      HP.Cache.set('deliveries', { items: [{ a: 'z'.repeat(400) }] }, { now: true });
      HP.Cache.set('roles', { scenes: [] }, { now: true });
      const m = HP.Cache._meta();
      ['thread.old1', 'thread.old2', 'deliveries'].forEach((k) => { m[k].at = Math.floor(Date.now() / 1000) - 30 * 86400; });
      HP.Cache._metaSave(m);
      HP.App.openBoard('settings');
    });
    await page.waitForTimeout(700);
    out['①_点清理前'] = await page.evaluate(() => {
      const plan = HP.Cache.plan({ days: 7, budgetBytes: 2 * 1024 * 1024 });
      return { 键数: HP.Cache.report().count, 预计会清: plan.count, 预计释放KB: Math.round(plan.freed / 1024) };
    });

    /* ② 点「清理」→ 必须真弹出确认框，且文案里有键数/KB */
    out['②_弹出确认'] = await page.evaluate(async () => {
      document.querySelector('[data-store="clean"]').click();
      await new Promise((r) => setTimeout(r, 300));
      const dlg = document.querySelector('.hp-dialog');
      const y = dlg && dlg.querySelector('[data-y]');
      const n = dlg && dlg.querySelector('[data-n]');
      const btnTip = document.querySelector('#toast');
      return {
        确认框出现: !!dlg,
        有确定键: !!y, 有取消键: !!n,
        确定键文案: y ? y.textContent.trim() : null,
        取消键文案: n ? n.textContent.trim() : null,
        提示原文: dlg ? dlg.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : null,
        提示里有键数: !!(dlg && /将清掉 3 个键/.test(dlg.innerText)),
        提示里有KB: !!(dlg && /KB/.test(dlg.innerText)),
        此刻还没执行: !/清掉 \d+ 个键/.test((btnTip && btnTip.textContent) || '')
      };
    });

    /* ③ 点「取消」→ 什么都不做（键数不变、没有清掉的 toast） */
    out['③_取消'] = await page.evaluate(async () => {
      const before = HP.Cache.report().count;
      document.querySelector('.hp-dialog [data-n]').click();
      await new Promise((r) => setTimeout(r, 300));
      const t = document.querySelector('#toast');
      return {
        确认框已关: !document.querySelector('.hp-dialog'),
        键数前: before, 键数后: HP.Cache.report().count,
        键数没变: before === HP.Cache.report().count,
        没有执行toast: !/清掉 \d+ 个键/.test((t && t.textContent) || '')
      };
    });

    /* ④ 再点「清理」→ 点「确定」→ 真清 + 原 toast 照旧 */
    out['④_确定'] = await page.evaluate(async () => {
      const before = HP.Cache.report().count;
      document.querySelector('[data-store="clean"]').click();
      await new Promise((r) => setTimeout(r, 300));
      const had = !!document.querySelector('.hp-dialog');
      document.querySelector('.hp-dialog [data-y]').click();
      await new Promise((r) => setTimeout(r, 400));
      const t = document.querySelector('#toast');
      const after = HP.Cache.report().count;
      return {
        又弹了一次: had,
        键数前: before, 键数后: after, 真清了: after < before,
        原toast: (t && t.textContent) || '',
        toast照旧: /清掉 \d+ 个键，释放 /.test((t && t.textContent) || '')
      };
    });

    /* ⑤ 干净态（预计 0 个键）也要照写「0 个键」 */
    out['⑤_零个键'] = await page.evaluate(async () => {
      HP.Cache.clearAll();                       /* 清空后没有可清的 → 文案该写 0 */
      HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 600));
      document.querySelector('[data-store="clean"]').click();
      await new Promise((r) => setTimeout(r, 300));
      const dlg = document.querySelector('.hp-dialog');
      const txt = dlg ? dlg.innerText.replace(/\s+/g, ' ').trim() : '';
      const res = { 确认框出现: !!dlg, 文案: txt.slice(0, 80), 写了0个键: /将清掉 0 个键/.test(txt) };
      const n = dlg && dlg.querySelector('[data-n]');
      if (n) n.click();
      await new Promise((r) => setTimeout(r, 200));
      return res;
    });

    /* ⑥ 别的行为没动：看明细仍工作、报错 0 */
    out['⑥_不回归'] = await page.evaluate(async () => {
      document.querySelector('[data-store="detail"]').click();   /* 看明细：直接算，不该弹确认 */
      await new Promise((r) => setTimeout(r, 250));
      return {
        看明细没弹确认: !document.querySelector('.hp-dialog'),
        明细那行有内容: (document.getElementById('st-store-detail') || {}).textContent !== '',
        占用那行还在: !!(document.getElementById('st-store') || {}).textContent
      };
    });
    await page.waitForTimeout(200);
    out['⑦_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
