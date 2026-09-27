/* R-40 复测 · 第二段：**角色数据先到位**再看会话页（上一段先开会话页 → ident 退化成平台 name）
 * 读：分组标题（在跑/没在跑/临时对话）+ 每行原文 + #4 女仆那条 + 一条临时对话
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r40-reprobe2-20260925.mjs
 */
import { readFileSync } from 'node:fs';
const F = '/vol1/1000/airesults/hermes-pocket/evidence/R40-定位-20260924/fixtures/';
const ROLES = JSON.parse(readFileSync(F + 'roles-json.json', 'utf8'));
const SESS = JSON.parse(readFileSync(F + 'sessions-json.json', 'utf8'));
const TMUX = readFileSync(F + 'tmux-list-raw.txt', 'utf8');

export default {
  name: 'R40-复测-会话页（角色先到位）',
  check: async (page) => {
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate((blob) => {
      const B = JSON.parse(blob);
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return B.roles;
        if (op === 'talk.sessions') return B.sess;
        if (op === 'tmux.list') return { raw: B.tmux };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    }, JSON.stringify({ roles: ROLES, sess: SESS, tmux: TMUX }));
    /* 先去频道页把 roles 拉进内存（真机上打开 App 也是这条路径），再进会话页 */
    await page.evaluate(async () => {
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2200));
      HP.App.showBoard('sessions'); await new Promise((r) => setTimeout(r, 1200));
      if (HP.Panels.renderSessions) await HP.Panels.renderSessions(true);
      await new Promise((r) => setTimeout(r, 900));
    });
    return page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const groups = [...el.querySelectorAll('.ui-status')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
      const rows = [...el.querySelectorAll('[data-testid^="session-"]')].map((r) => ({ testid: r.getAttribute('data-testid'), full: r.textContent.replace(/\s+/g, ' ').trim() }));
      const pick = (id) => (rows.find((r) => r.testid === 'session-' + id) || {}).full || null;
      return {
        rolesLoaded: (HP.Talk.roles || []).map((r) => r.full_name),
        groups, rowCount: rows.length, rows,
        女仆行: pick(4), 临时对话行: pick(7), tester行: pick(5), owner行: pick(6), 调查者行: pick(11),
        domHead: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
      };
    });
  }
};
