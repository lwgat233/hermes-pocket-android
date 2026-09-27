/* R-40 第 5 步复测 · 主块⑤会话页 + 主块⑧频道页 + 跨块①单聊（信息窗同源）
 * 数据：**本机现取的平台真回包**（talk.py roles-json / sessions-json）+ 本机 tmux list-sessions 原文。
 * 覆盖：① 女仆 #4 口径 ② 形态判据（qqbot: 是通道 / 裸 tmux 名仍判已废）③ 退化态「（加载中）」
 *       ④ 抽验旧判据 ⑤ 卡片副行有没有「被停」+ 字段来源 ⑥ 常驻键/遮挡
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r40b-reprobe-20260925.mjs
 */
import { readFileSync } from 'node:fs';
const E = '/vol1/1000/airesults/hermes-pocket/evidence/R40-复测2-20260925/';
const ROLES = JSON.parse(readFileSync(E + 'fixture-roles-json-当前.json', 'utf8'));
const SESS = JSON.parse(readFileSync(E + 'fixture-sessions-json-当前.json', 'utf8'));
const TMUX = readFileSync(E + 'fixture-tmux-list-当前.txt', 'utf8');
/* 形态变体：裸 tmux 名（无冒号）的老记录 #3，应仍判「已废」且不被当成通道 */
const SESS2 = { sessions: SESS.sessions.concat([{ id: 3, kind: 'role', name: 'pipeline.author', role: 'pipeline.author', tmux: 'role-pipeline-author', hermes: 'pipeline.author', alive: false, last_used: 1790090000, note: '老快照：合成名（裸 tmux，无冒号）' }]) };

export default {
  name: 'R40-5-复测-口径修复',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate((blob) => {
      const B = JSON.parse(blob);
      window.__B = B;
      window.__rolesDelay = 0;                      /* >0 时 talk.roles 延迟返回（用来抓退化态） */
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') { if (window.__rolesDelay) await new Promise((r) => setTimeout(r, window.__rolesDelay)); return B.roles; }
        if (op === 'talk.sessions') return window.__sess || B.sess;
        if (op === 'tmux.list') return { raw: B.tmux };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: [] };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    }, JSON.stringify({ roles: ROLES, sess: SESS2, tmux: TMUX }));

    const readSess = () => page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const groups = [...el.querySelectorAll('.ui-status')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
      const rows = [...el.querySelectorAll('[data-testid^="session-"]')].map((r) => {
        const t = r.querySelector('.t') || r.querySelector('b') || r.firstElementChild;
        return { testid: r.getAttribute('data-testid'), text: r.textContent.replace(/\s+/g, ' ').trim(), right: (r.querySelector('.r') || r.lastElementChild || {}).textContent ? String((r.querySelector('.r') || r.lastElementChild).textContent).trim() : null };
      });
      return { groups, rowCount: rows.length, rows };
    });
    try {
      /* ---------- ③ 退化态：先开会话页 + roles 延迟 4s ---------- */
      out.degraded = await page.evaluate(async () => {
        window.__rolesDelay = 4000;
        HP.App.showBoard('sessions');
        await new Promise((r) => setTimeout(r, 1500));
        const el = document.getElementById('tab-sessions');
        const first = (el.querySelector('[data-testid^="session-"]') || {}).textContent || '';
        return { 首屏行原文: first.replace(/\s+/g, ' ').trim().slice(0, 120), 含加载中: el.textContent.indexOf('（加载中）') >= 0, 含平台name当身份: /#\d+ pipeline\.|#\d+ owner\.me|#\d+ research\./.test(el.textContent.replace(/\s+/g, ' ')) };
      });
      await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 4200)); HP.Panels.renderSessions(true); await new Promise((r) => setTimeout(r, 900)); });
      out.degradedAfter = await readSess();

      /* ---------- ①②④ 正常态（roles 已到位） ---------- */
      await page.evaluate(async () => {
        window.__rolesDelay = 0;
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 2200));
        HP.App.showBoard('sessions'); await new Promise((r) => setTimeout(r, 900));
        if (HP.Panels.renderSessions) HP.Panels.renderSessions(true);
        await new Promise((r) => setTimeout(r, 900));
      });
      out.sessions = await readSess();
      const pick = (id) => (out.sessions.rows.find((r) => r.testid === 'session-' + id) || {}).text || null;
      out.pick = { 女仆4: pick(4), bareTmux3: pick(3), solo7: pick(7), tester5: pick(5) };
      out.checks = {
        女仆_含身份: /#4 女仆（本人通道）/.test(out.pick['女仆4'] || ''),
        女仆_含QQ通道: /QQ 通道/.test(out.pick['女仆4'] || ''),
        女仆_不该有已废: !/已废/.test(out.pick['女仆4'] || ''),
        裸tmux3_仍判已废: /（已废）/.test(out.pick['bareTmux3'] || ''),
        裸tmux3_不被当通道: !/QQ 通道/.test(out.pick['bareTmux3'] || ''),
        solo7_仍判已废: /（已废）/.test(out.pick['solo7'] || '')
      };
      /* 女仆在哪个组 */
      out.女仆所在组 = await page.evaluate(() => {
        const el = document.getElementById('tab-sessions');
        const nodes = [...el.children];
        let cur = '';
        for (const n of nodes) { if (n.classList && n.classList.contains('ui-status')) cur = n.textContent.trim(); if (n.querySelector && n.querySelector('[data-testid="session-4"]')) return cur; if (n.getAttribute && n.getAttribute('data-testid') === 'session-4') return cur; }
        return null;
      });
      /* ---------- ⑧ 频道页：卡片副行（重点看有没有「被停」）+ 信息窗 ---------- */
      out.channel = await page.evaluate(async () => {
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 1800));
        const card = document.querySelector('[data-role="home.maid"]');
        const sub = card ? (card.querySelector('.sub') || {}).textContent : null;
        const full = card ? card.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : null;
        const row = ((HP.Talk.roles || []).find((r) => r.full_name === 'home.maid')) || {};
        HP.Talk.openRoleSheet('home.maid');
        const d = document.querySelector('.tk-sheetcard');
        const rows = d ? [...d.querySelectorAll('.tk-sheetrow')].map((x) => x.querySelector('.tk-k').textContent + '=' + x.querySelector('.tk-v').textContent) : [];
        HP.Talk.closeSheet();
        return { cardSub: sub, cardFull: full, 含被停: /被停/.test(String(sub) || ''), sheetRows: rows, 字段: { online: row.online, state: row.state } };
      });
      /* 全页扫一遍有没有「被停」 */
      out.频道页含被停 = await page.evaluate(() => ({ 频道页: /被停/.test((document.getElementById('tab-talk') || {}).textContent || ''), 全页: /被停/.test(document.body.textContent || '') }));
      out.chrome = await page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: vis('keybar'), composer: vis('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
