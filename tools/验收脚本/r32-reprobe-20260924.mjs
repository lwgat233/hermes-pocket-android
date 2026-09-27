/* R-32 复测 · 主块①聊天页-单聊（30s 挂机 0 报错 + 轮询次数 + 回归 + R-37 C 那条）
 *              ＋ 跨块②聊天页-群聊（共用 this.timer/tick()）6s 挂机
 * 真触摸：adb shell input tap（系统触摸链路）。挂机段只等、不点、不做手势（只允许后端侧数据变化）。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r32-reprobe-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R32-复测-死调用清理',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      const base = [];
      for (let i = 0; i < 6; i++) base.push({ who: i % 2 ? 'me' : 'him', body: 'R32-旧' + i, at: now - (6 - i) * 60 });
      window.__thread = base;
      window.__sinceCount = 0;
      window.__errs = [];
      const oe = console.error.bind(console);
      console.error = function () { try { window.__errs.push('console.error: ' + String(arguments[0]).slice(0, 140)); } catch (e) {} return oe.apply(null, arguments); };
      window.addEventListener('error', (e) => { try { window.__errs.push('window.error: ' + String(e.message).slice(0, 140)); } catch (x) {} });
      window.addEventListener('unhandledrejection', (e) => { try { window.__errs.push('unhandledrejection: ' + String((e.reason && e.reason.message) || e.reason).slice(0, 140)); } catch (x) {} });
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') { window.__sinceCount++; return { messages: window.__newMsg ? [window.__newMsg] : [], last: 9003 }; }
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: window.__thread };
        if (op === 'talk.say') return { delivered: true, ms: 1234 };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    });

    const snap = () => page.evaluate(() => ({
      since: window.__sinceCount, errs: window.__errs.slice(0, 8), errCount: window.__errs.length,
      bubs: document.querySelectorAll('#tk-chat .tk-bub').length,
      hims: document.querySelectorAll('#tk-chat .tk-bub.him').length,
      himWithTapWho: document.querySelectorAll('#tk-chat .tk-bub.him[data-tapwho="1"]').length,
      sheet: !!document.querySelector('.tk-sheetcard'),
      sends: [...document.querySelectorAll('#tk-sends .tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent }))
    }));
    const dev = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; }, sel);
    const visibleHim = () => page.evaluate(() => {
      const bs = [...document.querySelectorAll('#tk-chat .tk-bub.him')].filter((b) => { const r = b.getBoundingClientRect(); return r.top > 40 && r.bottom < window.innerHeight - 120; });
      const el = bs.length ? bs[bs.length - 1] : null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: (el.textContent || '').slice(0, 20), tapwho: el.getAttribute('data-tapwho'), x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    });

    try {
      /* 打开单聊页（轮询跑起来） */
      await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author'); await new Promise((r) => setTimeout(r, 1500)); });
      out.baseline = await snap();

      /* ① 连续 30s 挂着不动（只等，不点）—— 分两段，中间让后端"来一条新消息" */
      await page.waitForTimeout(15000);
      out.hold15 = await snap();
      await page.evaluate(() => {           /* 后端侧：新消息（talk.since 与 talk.thread 都多一条 = 真来了一条） */
        const now = Math.floor(Date.now() / 1000);
        window.__newMsg = { id: 9100, from: 'pipeline.author', to: 'me', kind: 'private', topic: '', body: 'R32-新来的消息', at: now };
        window.__thread = window.__thread.concat([{ who: 'him', body: 'R32-新来的消息', at: now }]);
      });
      await page.waitForTimeout(15000);
      out.hold30 = await snap();
      out.poll = { since30s: out.hold30.since, expectApprox: 12, avgMs: Math.round(30000 / Math.max(1, out.hold30.since)) };

      /* ② 回归：新来的气泡能不能点开（R-37 B/C 那条真机验） */
      const him = await visibleHim();
      out.newBubble = him;
      if (him) { tap(him.x, him.y); await page.waitForTimeout(900); }
      out.tapNewBubble = await page.evaluate(() => { const d = document.querySelector('.tk-sheetcard'); return { open: !!d, 全名: (() => { if (!d) return null; const r = [...d.querySelectorAll('.tk-sheetrow')].find((x) => (x.querySelector('.tk-k') || {}).textContent === '全名'); return r ? r.querySelector('.tk-v').textContent : null; })() }; });
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);

      /* ②b 抬头（R-37 A）仍能开窗 */
      const t = await dev('#tk-chat .tk-title, .tk-title');
      if (t) { tap(t.x, t.y); await page.waitForTimeout(900); }
      out.tapTitle = await page.evaluate(() => ({ open: !!document.querySelector('.tk-sheetcard') }));
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);

      /* ②c 发送仍出终态（有 delivered+ms / 没有 delivered 两种） */
      const dSend = await dev('#tk-sayok');
      if (dSend) { await page.evaluate(() => { document.getElementById('tk-sayin').value = 'R32-发送A'; }); tap(dSend.x, dSend.y); await page.waitForTimeout(1400); }
      out.sendA = await snap();
      await page.evaluate(() => {
        const orig = HP.App.rpc;
        HP.App.rpc = async (op) => { if (op === 'talk.say') return {}; return orig(op); };
      });
      if (dSend) { await page.evaluate(() => { document.getElementById('tk-sayin').value = 'R32-发送B'; }); tap(dSend.x, dSend.y); await page.waitForTimeout(1400); }
      out.sendB = await snap();

      /* ④ 跨块②群聊：6s 挂机 0 报错 + since 次数 */
      out.group = await page.evaluate(async () => { window.__errs = []; const s0 = window.__sinceCount; HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 6000)); return { sinceDelta: window.__sinceCount - s0, errs: window.__errs.slice(0, 6), errCount: window.__errs.length, stream: !!document.getElementById('tk-stream'), bubs: document.querySelectorAll('#tk-stream .tk-bub').length }; });
      out.chrome = await page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: vis('keybar'), composer: vis('composer') }; });
      out.finalErrs = await page.evaluate(() => window.__errs.length);
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
