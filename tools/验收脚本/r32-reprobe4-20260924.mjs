/* R-32 复测 · 发送终态（第二修正）：单聊页有**重复 id**（两套 tk-sayin/tk-sayok 叠在同一坐标），
 * 发送键的点击处理器读的是**它自己那一套的输入框** ⇒ 必须找到"最上层那个键"的同胞输入框再赋值。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r32-reprobe4-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R32-复测-发送终态（第二修正）',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);
      const base = [];
      for (let i = 0; i < 6; i++) base.push({ who: i % 2 ? 'me' : 'him', body: 'R32e-第' + i + '条', at: now - (6 - i) * 60 });
      window.__sayCalls = []; window.__toasts = [];
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__toasts.push(String(m || '')); return ot.apply(this, arguments); };
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
    const runSend = async (mark, reply) => {
      const armed = await page.evaluate((mk) => {
        window.__sayReply = JSON.parse(mk);
        /* 找最上层那个"发送"键（叠着的两套里点得到的那套），再给它的同胞输入框赋值 */
        const keys = [...document.querySelectorAll('#tk-sayok')];
        const vis = keys.filter((k) => k.getBoundingClientRect().height > 0);
        const top = vis[vis.length - 1] || keys[keys.length - 1];
        const r = top.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        const siblingInp = top.parentElement.querySelector('#tk-sayin');
        if (siblingInp) siblingInp.value = 'R32e-send';
        return { keysTotal: keys.length, topIsHit: hit === top, hitWhat: hit ? hit.tagName + '#' + hit.id : null, siblingInp: siblingInp ? siblingInp.value : null, device: { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) } };
      }, JSON.stringify(reply));
      tap(armed.device.x, armed.device.y);
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll('#tk-sends')];
        const box = boxes.find((e) => e.getBoundingClientRect().height > 0) || boxes[0];
        return { rows: box ? [...box.querySelectorAll('.tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent })) : [], sayCalls: window.__sayCalls.length, toasts: window.__toasts.slice() };
      });
      return { armed, after };
    };
    try {
      out.a = await runSend('A', { delivered: true, ms: 1234 });
      out.b = await runSend('B', {});
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
