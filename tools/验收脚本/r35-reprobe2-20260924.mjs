/* R-35 复测 · 第二部分：真删（非零）—— 用真实 fixture（3 个 30 天没用的键 + 1 个今天的）走真触摸
 * fixture 只动"数据"，判定与删除全走产品代码（plan/cleanup + 界面确认框）。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r35-reprobe2-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R35-复测-真删',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      window.__toasts = [];
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__toasts.push(String(m || '')); return ot.apply(this, arguments); };
      /* fixture：3 个 30 天没用的键（每个 40KB 量级）+ 1 个今天的 */
      HP.Cache.clearAll();
      const big = new Array(20480).join('x');           /* ≈20K 字符 */
      HP.Cache.set('probe.old1', big); HP.Cache.set('probe.old2', big); HP.Cache.set('probe.old3', big);
      HP.Cache.set('probe.today', big);
      const META = 'HP_TALK_CACHE.__meta';
      const m = JSON.parse(localStorage.getItem(META) || '{}');
      const old = Math.floor(Date.now() / 1000) - 30 * 86400;
      ['probe.old1', 'probe.old2', 'probe.old3'].forEach((k) => { if (m[k]) m[k].at = old; });
      localStorage.setItem(META, JSON.stringify(m));
    });
    await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1400));
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      const sc = card.closest('.panel-body');
      sc.scrollTop = card.getBoundingClientRect().top + sc.scrollTop - 200;
      await new Promise((r) => setTimeout(r, 500));
    });
    const snap = () => page.evaluate(() => {
      const r = HP.Cache.report();
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      return { keys: r.count, kb: +(r.total / 1024).toFixed(1), cardText: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 40), dialog: !!document.querySelector('.hp-dialog') };
    });
    out.before = await snap();
    out.planPreview = await page.evaluate(() => { const p = HP.Cache.plan(); return { count: p.count, freedKB: +(p.freed / 1024).toFixed(1), doomed: p.items.map((i) => i.k) }; });

    const dev = (el) => page.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; }, el);
    const dClean = await dev('[data-store="clean"]');
    tap(dClean.x, dClean.y);
    await page.waitForTimeout(900);
    out.dialog = await page.evaluate(() => {
      const d = document.querySelector('.hp-dialog');
      if (!d) return { open: false };
      const y = d.querySelector('[data-y]'), n = d.querySelector('[data-n]');
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { w: Math.round(r.width), h: Math.round(r.height) } }; };
      return { open: true, text: d.textContent.replace(/\s+/g, ' ').trim(), yesLabel: String(y.textContent).trim(), noLabel: String(n.textContent).trim(), yesDevice: rect(y), noDevice: rect(n) };
    });
    if (out.dialog.open) { tap(out.dialog.yesDevice.x, out.dialog.yesDevice.y); await page.waitForTimeout(1200); }
    out.afterConfirm = await snap();
    out.toasts = await page.evaluate(() => window.__toasts.slice());
    out.leftKeys = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('HP_TALK_CACHE.__meta') || '{}'); return Object.keys(m); });
    return out;
  }
};
