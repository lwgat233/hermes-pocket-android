/* R-43 第 3 步复测 · 平台新回执形状 → App 显示（甲案）
 * 主块①单聊 + 主块②群聊；把**平台 say() 的真形状**（含经理真跑那串）喂给 rpc 层，读 #tk-sends 的状态行。
 * 对照：台账 delivery(msg 1370) = ok=1 ms=3368 attempts=1 confirmed=1
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r43-reprobe-20260925.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const key = (c) => sh(`input keyevent ${c}`);

export default {
  name: 'R43-复测-平台新回执形状',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      window.__reply = { delivered: true, ms: 3329 };
      window.__delay = 0;
      HP.App.rpc = async (op, a) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: [] }, { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] }] }], channels: {} };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: [{ who: 'him', body: 'R43-他说的', at: 1790260000 }] };
        if (op === 'talk.say') { const r = window.__reply; if (window.__delay) await new Promise((res) => setTimeout(res, window.__delay)); return r; }
        if (op === 'talk.shout') { const r = window.__reply; if (window.__delay) await new Promise((res) => setTimeout(res, window.__delay)); return r; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    });
    const rows = () => page.evaluate(() => [...document.querySelectorAll('#tk-sends .tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), cls: r.className.replace('tk-sendrow ', ''), text: (r.querySelector('.tk-sendtext') || {}).textContent, subs: [...r.querySelectorAll('.tk-sendsub')].map((s) => s.textContent), retry: !!r.querySelector('[data-testid="talk-retry"]') })));
    const runSingle = async (reply, mark) => {
      await page.evaluate(async (rep, mk) => {
        HP.Talk.sends.length = 0;
        window.__reply = rep; window.__delay = 0;
        HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author');
        await new Promise((r) => setTimeout(r, 1200));
        const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0);
        el.value = mk;
        const r = el.getBoundingClientRect();
        window.__pt = { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) };
      }, reply, mark);
      const pt = await page.evaluate(() => window.__pt);
      tap(pt.x, pt.y); await page.waitForTimeout(800); key(66); await page.waitForTimeout(1400);
      return rows();
    };
    const runGroup = async (reply, mark) => {
      await page.evaluate(async (rep, mk) => {
        HP.Talk.sends.length = 0;
        window.__reply = rep; window.__delay = 0;
        HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 1300));
        document.getElementById('tk-shoutin').value = mk;
        const r = document.getElementById('tk-shoutin').getBoundingClientRect();
        window.__pt = { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) };
      }, reply, mark);
      const pt = await page.evaluate(() => window.__pt);
      tap(pt.x, pt.y); await page.waitForTimeout(800); key(66); await page.waitForTimeout(1500);
      return rows();
    };
    try {
      /* 1) 单聊：平台真回执（经理真跑那串）→ 应显示「已送达 3329ms」 */
      out.A_single_true = await runSingle({ id: 1370, to: 'pipeline.author', ok: 1, delivered: true, ms: 3329, attempts: 1, confirmed: 1 }, 'R43-A');
      /* 2a) 中性态：delivered=null, confirmed=0 */
      out.B_single_null = await runSingle({ id: 1371, to: 'pipeline.author', ok: 1, delivered: null, ms: 3000, attempts: 1, confirmed: 0 }, 'R43-B');
      /* 2b) 失败态：delivered=false + error */
      out.C_single_false = await runSingle({ id: 1372, to: 'pipeline.author', ok: 0, delivered: false, ms: 0, attempts: 1, confirmed: null, error: '阶段没放行' }, 'R43-C');
      /* 3) 广播：results 每条带 confirmed/ms + 顶层 delivered */
      out.D_group_partial = await runGroup({ id: 1373, broadcast: true, count: 2, delivered: false, results: [{ role: 'pipeline.author', delivered: true, confirmed: 1, ms: 3368, attempts: 1 }, { role: 'pipeline.renderer', delivered: false, confirmed: null, ms: 0, attempts: 1, error: '阶段没放行' }] }, 'R43-D');
      out.E_group_all = await runGroup({ id: 1374, broadcast: true, count: 2, delivered: true, results: [{ role: 'pipeline.author', delivered: true, confirmed: 1, ms: 3368, attempts: 1 }, { role: 'pipeline.renderer', delivered: true, confirmed: 1, ms: 3402, attempts: 1 }] }, 'R43-E');
      /* 4) 回归：慢回执 → 3s「还在发」、8s 超时（不判红，只报读数） */
      await page.evaluate(async () => {
        HP.Talk.sends.length = 0; window.__reply = { delivered: true, ms: 9000 }; window.__delay = 12000;
        HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 1200));
        document.getElementById('tk-shoutin').value = 'R43-F-slow';
        const r = document.getElementById('tk-shoutin').getBoundingClientRect();
        window.__pt = { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) };
      });
      const pt = await page.evaluate(() => window.__pt);
      tap(pt.x, pt.y); await page.waitForTimeout(700); key(66);
      await page.waitForTimeout(1000); out.F_slow_1s = await rows();
      await page.waitForTimeout(2400); out.F_slow_3_4s = await rows();
      await page.waitForTimeout(2600); out.F_slow_6s = await rows();
      await page.waitForTimeout(2600); out.F_slow_8_6s = await rows();
      out.chrome = await page.evaluate(() => { const v = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: v('keybar'), composer: v('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
