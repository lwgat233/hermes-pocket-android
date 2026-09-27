/* R-33 复测 · 追问段：①「清理」到底有没有弹确认 ②「广播」真触摸有没有真触发（键盘会改布局，先收键盘再量再点）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r33-reprobe-followup-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const adb = (cmd) => { execSync(`adb -s ${SERIAL} ${cmd}`, { stdio: 'ignore' }); };

export default {
  name: 'R33-复测-追问段',
  check: async (page) => {
    const out = {};
    const coords = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const sx = 1080 / window.innerWidth, sy = 2138 / window.innerHeight;
      return { device: { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy) }, css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }, sel);

    /* ① 清理：量→点→读（含 toast / 卡片文案 / 是否有弹窗 / 是否真清了） */
    await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1200));
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      const sc = card.closest('.panel-body'); sc.scrollTop = card.getBoundingClientRect().top + sc.scrollTop - 200;
      await new Promise((r) => setTimeout(r, 400));
      window.__seen = { confirm: 0, confirmMsg: [], toasts: [] };
      const oc = window.confirm; window.confirm = function (m) { window.__seen.confirm++; window.__seen.confirmMsg.push(String(m || '')); return false; };
      window.__origConfirm = oc;
      const ot = HP.App.toast; HP.App.toast = function (m) { window.__seen.toasts.push(String(m || '')); return ot.apply(this, arguments); };
      window.__origToast = ot;
      const before = HP.Cache.report();
      window.__before = { total: before.total, keys: before.count };
    });
    const c1 = await coords('[data-store="clean"]');
    adb(`shell input tap ${c1.device.x} ${c1.device.y}`);
    await page.waitForTimeout(1200);
    out.clean = await page.evaluate(() => {
      const rep = HP.Cache.report();
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      return {
        tap: true, confirmCalls: window.__seen.confirm, confirmMsgs: window.__seen.confirmMsg, toasts: window.__seen.toasts,
        keysBefore: window.__before.keys, keysAfter: rep.count, kbBefore: +(window.__before.total / 1024).toFixed(1), kbAfter: +(rep.total / 1024).toFixed(1),
        cardHead: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 70),
        restored: (window.confirm = window.__origConfirm, HP.App.toast = window.__origToast, true)
      };
    });

    /* ② 广播：先收键盘 → 量 → 点 → 读（真触发则出现发送状态行） */
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 800)); });
    adb('shell input keyevent 4');                       /* 收键盘（若开着） */
    await page.waitForTimeout(600);
    const c2 = await coords('#tk-shoutin');
    adb(`shell input tap ${c2.device.x} ${c2.device.y}`);
    await page.waitForTimeout(500);
    adb('shell input text "R33shout"');
    await page.waitForTimeout(400);
    adb('shell input keyevent 4');                       /* 再收键盘，别让它改布局 */
    await page.waitForTimeout(700);
    out.beforeShout = await page.evaluate(() => ({ value: document.getElementById('tk-shoutin').value, rows: document.querySelectorAll('[data-testid="talk-sendrow"]').length, kbFocus: (document.activeElement || {}).id || null }));
    const c3 = await coords('#tk-shoutok');
    adb(`shell input tap ${c3.device.x} ${c3.device.y}`);
    await page.waitForTimeout(2000);
    out.afterShout = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent || '' }));
      return { rows: rows, valueAfter: document.getElementById('tk-shoutin').value, sendsLen: (HP.Talk.sends || []).length, lastSend: (HP.Talk.sends || []).slice(-1)[0] ? { state: HP.Talk.sends.slice(-1)[0].state, note: HP.Talk.sends.slice(-1)[0].note } : null };
    });
    /* 常驻按键 + 遮挡 */
    out.chrome = await page.evaluate(() => {
      const page = document.getElementById('tab-group');
      const vis = [...page.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0);
      const tb = document.getElementById('topbar'), kb = document.getElementById('keybar'), cp = document.getElementById('composer');
      const cov = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const br = { top: 0, bottom: 0 }; return false; };
      const inter = [];
      [['topbar', tb], ['keybar', kb], ['composer', cp]].forEach(([n, b]) => {
        if (!b) return;
        const br = b.getBoundingClientRect();
        if (br.height === 0) return;
        vis.forEach((v) => { const r = v.getBoundingClientRect(); if (br.bottom > r.top && br.top < r.bottom) inter.push(n + '↔' + String(v.textContent).trim().slice(0, 8)); });
      });
      return { count: vis.length, labels: vis.map((b) => String(b.textContent).trim().slice(0, 12)), overlaps: inter };
    });
    return out;
  }
};
