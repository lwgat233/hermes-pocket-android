/* R-32 复测 · 修正段：单聊页发送键出终态（上一版把文字填进了**重复 id 里的隐藏那个**，所以"没反应"）
 * 先查 duplicate id 分布与可见性，再对**可见的那个**输入框赋值 + 真触摸可见的发送键。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r32-reprobe3-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R32-复测-发送终态（修正版）',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);
      const base = [];
      for (let i = 0; i < 6; i++) base.push({ who: i % 2 ? 'me' : 'him', body: 'R32d-第' + i + '条', at: now - (6 - i) * 60 });
      window.__sayCalls = [];
      HP.App.rpc = async (op, args) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 9003 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: base };
        if (op === 'talk.say') { window.__sayCalls.push(args); return window.__sayReply || { delivered: true, ms: 1234 }; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author');
      await new Promise((r) => setTimeout(r, 1600));
    });
    /* 重复 id 分布 */
    out.dupIds = await page.evaluate(() => {
      const ids = ['tk-sayin', 'tk-sayok', 'tk-sends'];
      const info = {};
      ids.forEach((id) => {
        const els = [...document.querySelectorAll('#' + id)];
        info[id] = els.map((e) => { const r = e.getBoundingClientRect(); const panel = e.closest('[id^="tab-"]'); return { panel: panel ? panel.id : null, visible: !!(e.offsetParent || e.getClientRects().length) && r.height > 0, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; });
      });
      return info;
    });
    /* 对**可见的**输入框赋值 + 真触摸**可见的**发送键 */
    const vis = await page.evaluate(() => {
      const pick = (id) => { const els = [...document.querySelectorAll('#' + id)]; const v = els.find((e) => (e.offsetParent || e.getClientRects().length) && e.getBoundingClientRect().height > 0); const el = v || els[0]; const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; };
      return { inp: pick('tk-sayin'), ok: pick('tk-sayok') };
    });
    out.visible = vis;
    const runSend = async (mark, reply) => {
      await page.evaluate((mk, rep) => {
        window.__sayReply = rep;
        const els = [...document.querySelectorAll('#tk-sayin')];
        const el = els.find((e) => (e.offsetParent || e.getClientRects().length) && e.getBoundingClientRect().height > 0) || els[0];
        el.value = mk;
      }, mark, reply);
      const k = await page.evaluate(() => { const els = [...document.querySelectorAll('#tk-sayok')]; const el = els.find((e) => (e.offsetParent || e.getClientRects().length) && e.getBoundingClientRect().height > 0) || els[0]; const r = el.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      tap(k.x, k.y);
      await page.waitForTimeout(1500);
      return page.evaluate(() => { const box = [...document.querySelectorAll('#tk-sends')].find((e) => (e.offsetParent || e.getClientRects().length)) || document.querySelector('#tk-sends'); return { rows: box ? [...box.querySelectorAll('.tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent })) : [], sayCalls: window.__sayCalls.length, lastArg: window.__sayCalls.length ? window.__sayCalls[window.__sayCalls.length - 1] : null }; });
    };
    try {
      out.sendDelivered = await runSend('R32d-发送A', { delivered: true, ms: 1234 });
      out.sendUnconfirmed = await runSend('R32d-发送B', {});
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
