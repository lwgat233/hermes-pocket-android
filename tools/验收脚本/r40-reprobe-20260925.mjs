/* R-40 复测 · 主块⑤会话页 + 主块⑧频道页 + 跨块①聊天页-单聊（信息窗同源）
 * 数据：talk.roles / talk.sessions / tmux.list 全部用**作者存的平台真回包**（evidence/R40-定位-20260924/fixtures/）。
 * 真触摸：adb shell input tap。**不真杀窗口**：talk.sessionDel 拦在 rpc 层记录参数（真杀会打断正在干活的角色，
 *         且不接主机本来就走不通）→ 动作前后各抄一次真 `tmux list-windows -t roles` 证明别人的窗口没动。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r40-reprobe-20260925.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });
const F = '/vol1/1000/airesults/hermes-pocket/evidence/R40-定位-20260924/fixtures/';
const ROLES = readFileSync(F + 'roles-json.json', 'utf8');
const SESS = readFileSync(F + 'sessions-json.json', 'utf8');
const TMUX = readFileSync(F + 'tmux-list-raw.txt', 'utf8');
const tmuxWindows = () => { try { return execSync('tmux list-windows -t roles -F "#{window_index} #{window_name} #{pane_id}"', { encoding: 'utf8' }); } catch (e) { return 'ERR ' + e.message; } };

export default {
  name: 'R40-复测-会话编号与身份',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate((blob) => {
      const B = JSON.parse(blob);
      window.__del = []; window.__sent = []; window.__confirms = [];
      const R = B.roles, S = B.sess, tmux = B.tmux;
      window.__roles = R; window.__sess = S;
      const origConfirm = window.confirm;
      window.confirm = function (m) { window.__confirms.push(String(m || '').slice(0, 80)); return true; };   /* 自动放行，参数照样记 */
      window.__origConfirm = origConfirm;
      HP.App.rpc = async (op, args) => {
        if (op === 'talk.roles') return window.__roles || R;
        if (op === 'talk.sessions') return window.__sess || S;
        if (op === 'tmux.list') return { raw: tmux };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: [] };
        if (op === 'app.storage') throw new Error('暂不可用');
        if (op === 'talk.sessionDel') { window.__del.push(args); return { deleted: true, role: args && args.name }; }   /* **不转发** */
        return {};
      };
      const origSend = HP.App.send.bind(HP.App);
      HP.App.send = function (s) { window.__sent.push(String(s)); return; };   /* 只记录，不真发 */
      window.__origSend = origSend;
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    }, JSON.stringify({ roles: JSON.parse(ROLES), sess: JSON.parse(SESS), tmux: TMUX }));
    await page.evaluate(async () => { HP.App.showBoard('sessions'); await new Promise((r) => setTimeout(r, 1200)); });
    await page.evaluate(async () => { if (HP.Panels && HP.Panels.renderSessions) await HP.Panels.renderSessions(true); await new Promise((r) => setTimeout(r, 800)); });

    const readSessions = () => page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const rows = [...el.querySelectorAll('[data-testid^="session-"]')].map((r) => ({ testid: r.getAttribute('data-testid'), title: (r.querySelector('.t, .title, b') || {}).textContent || r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60), full: r.textContent.replace(/\s+/g, ' ').trim() }));
      const groups = [...el.querySelectorAll('.card, h3, .sec, .group')].map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 30)).filter((t) => /在跑|没在跑|临时对话/.test(t));
      return { headText: (el.firstElementChild || {}).textContent ? el.firstElementChild.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : null, rowCount: rows.length, rows, groups, dom: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 700) };
    });
    try {
      out.sessions1 = await readSessions();
      /* 变体：加一条容器行（tmux='roles'）+ 一条同 tmux 重复行 + 一个没会话的角色 */
      await page.evaluate(async () => {
        const S = JSON.parse(window.__sessRaw || 'null') || null;
        const base = (window.__sess && window.__sess.sessions) || [];
        window.__sess = { sessions: base.concat([
          { id: 99, kind: 'container', name: 'roles', role: null, tmux: 'roles', hermes: null, alive: true, last_used: 0, note: '容器（假行，用来验证不成行）' },
          { id: 12, kind: 'role', name: 'pipeline.tester', role: 'pipeline.tester', tmux: 'roles:pipeline-tester', hermes: 'pipeline.tester', alive: false, last_used: 1, note: '同 tmux 的重复行（旧快照）' }]) };
        const r0 = JSON.parse(JSON.stringify(window.__roles || {}));
        (r0.scenes || []).forEach((sc) => sc.roles.push({ full_name: 'pipeline.auditor', title: '审计者', online: true, state: 'running', channels: [] }));
        window.__roles = r0;
        HP.Panels.renderSessions(true); await new Promise((r) => setTimeout(r, 900));
      });
      out.sessions2_容器与重复 = await readSessions();
      /* 频道页：角色卡副行 */
      out.channel = await page.evaluate(async () => {
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 1800));
        const cards = [...document.querySelectorAll('[data-role]')].map((c) => ({ role: c.getAttribute('data-role'), sub: (c.querySelector('.sub') || {}).textContent || null }));
        return { cards, dom: (document.getElementById('tab-talk') || {}).textContent.replace(/\s+/g, ' ').trim().slice(0, 400) };
      });
      /* 信息窗「会话」行（与角色卡同源） */
      out.sheets = await page.evaluate(() => {
        const read = (full) => { HP.Talk.openRoleSheet(full); const d = document.querySelector('.tk-sheetcard'); const rows = d ? [...d.querySelectorAll('.tk-sheetrow')].map((x) => ({ k: x.querySelector('.tk-k').textContent, v: x.querySelector('.tk-v').textContent })) : []; HP.Talk.closeSheet(); return { full, sessRow: (rows.find((r) => r.k === '会话') || {}).v || null, keys: rows.map((r) => r.k) }; };
        return ['pipeline.tester', 'pipeline.author', 'home.maid', 'pipeline.auditor'].map(read);
      });
      /* 会话页弹窗动作：切 / 删（真触摸） */
      await page.evaluate(async () => { HP.App.showBoard('sessions'); await new Promise((r) => setTimeout(r, 900)); if (HP.Panels.renderSessions) HP.Panels.renderSessions(true); await new Promise((r) => setTimeout(r, 700)); });
      out.tmuxBefore = tmuxWindows();
      const rowDev = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="session-5"]');
        if (!r) return null;
        r.setAttribute('data-probe', '1');
        const b = r.getBoundingClientRect();
        return { x: Math.round((b.x + b.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (b.y + b.height / 2) * (2138 / window.innerHeight)), text: r.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) };
      });
      out.testerRow = rowDev;
      if (rowDev) { tap(rowDev.x, rowDev.y); await page.waitForTimeout(900); }
      out.sheetText = await page.evaluate(() => { const s = document.getElementById('tk-sess-sheet'); return s ? s.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null; });
      const sw = await page.evaluate(() => { const b = document.getElementById('tk-sess-switch'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      if (sw) { tap(sw.x, sw.y); await page.waitForTimeout(800); }
      out.afterSwitch = await page.evaluate(() => ({ sent: window.__sent.slice(), toasts: [] }));
      /* 再开一次弹窗点「删」 */
      if (rowDev) { tap(rowDev.x, rowDev.y); await page.waitForTimeout(800); }
      const del = await page.evaluate(() => { const b = document.getElementById('tk-sess-del'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      if (del) { tap(del.x, del.y); await page.waitForTimeout(1200); }
      out.afterDelete = await page.evaluate(() => ({ del: window.__del.slice(), confirms: window.__confirms.slice() }));
      out.tmuxAfter = tmuxWindows();
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
