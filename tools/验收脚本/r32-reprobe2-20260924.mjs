/* R-32 复测 · 单聊页两处真触摸的隔离复现（气泡开窗 / 发送出终态）—— 上一版这两处返回 false，
 * 用更细的时序（250/600/1200ms）与命中测试定位到底是"没点到"还是"真没反应"。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r32-reprobe2-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R32-复测-两处真触摸隔离',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);
      const base = [];
      for (let i = 0; i < 8; i++) base.push({ who: i % 2 ? 'me' : 'him', body: 'R32b-第' + i + '条', at: now - (8 - i) * 60 });
      window.__sinceCount = 0; window.__errs = [];
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') { window.__sinceCount++; return { messages: [], last: 9003 }; }
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: base };
        if (op === 'talk.say') return { delivered: true, ms: 1234 };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author');
      await new Promise((r) => setTimeout(r, 1600));
    });
    const probeHit = (sel) => page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
      const h = document.elementFromPoint(cx, cy);
      return { css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, device: { x: Math.round(cx * (1080 / window.innerWidth)), y: Math.round(136 + cy * (2138 / window.innerHeight)) }, hitWhat: h ? h.tagName + '.' + String(h.className).split(' ').slice(0, 2).join('.') : null, hitIsSelf: !!(h && (h === e || e.contains(h))), tapwho: e.getAttribute('data-tapwho') };
    }, sel);
    try {
      /* A) 可见的他说的气泡 */
      const him = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('#tk-chat .tk-bub.him')].filter((b) => { const r = b.getBoundingClientRect(); return r.top > 40 && r.bottom < window.innerHeight - 120; });
        if (!bs.length) return null;
        bs[bs.length - 1].setAttribute('data-probe-idx', 'pick');
        return bs.length;
      });
      out.himCount = him;
      out.himHit = await probeHit('#tk-chat .tk-bub.him[data-probe-idx="pick"]');
      if (out.himHit) {
        tap(out.himHit.device.x, out.himHit.device.y);
        await page.waitForTimeout(250);
        out.sheet250 = await page.evaluate(() => !!document.querySelector('.tk-sheetcard'));
        await page.waitForTimeout(400);
        out.sheet650 = await page.evaluate(() => !!document.querySelector('.tk-sheetcard'));
        await page.waitForTimeout(600);
        out.sheet1250 = await page.evaluate(() => !!document.querySelector('.tk-sheetcard'));
      }
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);
      /* B) 发送键 */
      out.sayHit = await probeHit('#tk-sayok');
      out.sayInHit = await probeHit('#tk-sayin');
      await page.evaluate(() => { document.getElementById('tk-sayin').value = 'R32b-发送'; });
      if (out.sayHit) {
        tap(out.sayHit.device.x, out.sayHit.device.y);
        await page.waitForTimeout(400);
        out.sends400 = await page.evaluate(() => [...document.querySelectorAll('#tk-sends .tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent })));
        await page.waitForTimeout(900);
        out.sends1300 = await page.evaluate(() => [...document.querySelectorAll('#tk-sends .tk-sendrow')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent })));
      }
      out.errs = await page.evaluate(() => window.__errs.length);
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
