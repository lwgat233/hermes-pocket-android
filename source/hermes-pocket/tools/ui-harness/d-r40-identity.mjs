/* R-40 定位探针：三处（⑤会话页 / ⑧频道页「上次聊过」 / 角色卡+信息窗）现在怎么显示身份与编号。
 * 全部用**平台真回包**当夹具：roles-json / sessions-json / hermes-sessions / 真 tmux list-sessions 原文。
 * 只读不写：不改工程文件。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r40-identity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R40-定位-20260924/fixtures');
const read = (n) => fs.readFileSync(path.join(FX, n), 'utf8');
const ROLES = JSON.parse(read('roles-json.json'));
const SESS = JSON.parse(read('sessions-json.json'));
const HERMES_SESS = JSON.parse(read('hermes-sessions.json'));
const TMUX_RAW = read('tmux-list-raw.txt');

export default {
  name: 'R-40 定位：会话页 / 频道页历史 / 角色卡与信息窗 现在显示什么（身份与编号）',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    /* 桥：全部真回包 */
    await page.evaluate(({ ROLES, SESS, HERMES_SESS, TMUX_RAW }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.__tmuxRaw = JSON.stringify({ raw: TMUX_RAW, at: Date.now() });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.hermesSessions') { setTimeout(() => reply(m._rid, HERMES_SESS), 3); return; }
        if (m && m.t === 'tmux.list') { setTimeout(() => reply(m._rid, { raw: TMUX_RAW, at: Date.now() }), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS, HERMES_SESS, TMUX_RAW });

    /* ---------- ⑤ 会话页（panels.js renderSessions） ---------- */
    out.a_会话页 = await page.evaluate(async () => {
      HP.App.sessionId = '20260924_probe';          /* A() === HP.App，sessionId 是它的直接属性（app.js:29） */
      HP.App.state = HP.App.state || 'connected';
      HP.App.showBoard('sessions');
      try { await HP.Sessions.refresh(true); } catch (e) { /* 读不到也要出读数 */ }
      await HP.Panels.renderSessions(true);
      await new Promise((r) => setTimeout(r, 500));
      const el = document.getElementById('tab-sessions');
      const rows = [...el.querySelectorAll('[data-testid^="session-"], .row')].map((r) => ({
        testid: r.getAttribute('data-testid'), 文本: (r.innerText || '').replace(/\n+/g, ' | ').slice(0, 90)
      }));
      return {
        整体文案: (el.innerText || '').replace(/\n+/g, ' | ').slice(0, 260),
        行数: rows.length, 行: rows.slice(0, 8),
        有井号编号: /#\d/.test(el.innerText || ''),
        tmux_会话表: (HP.Sessions.list || []).map((s) => s.name)
      };
    });

    /* ---------- ⑧ 频道页「上次聊过」（talk.js paintChannel → paintHistory） ---------- */
    out.b_频道页历史 = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await HP.Talk.refreshRoles();
      HP.Talk.render();
      await new Promise((r) => setTimeout(r, 900));
      const hist = document.getElementById('tk-hist');
      const groups = [...document.querySelectorAll('[data-testid="talk-group"]')].map((g) => g.innerText.replace(/\n+/g, ' ').trim());
      const rows = setTimeout ? [...document.querySelectorAll('[data-testid="talk-sessrow"]')].map((r) => (r.innerText || '').replace(/\n+/g, ' ').trim().slice(0, 80)) : [];
      const page = document.querySelector('#tab-talk');
      return {
        分组标题: groups,
        历史行数: rows.length,
        历史行: rows.slice(0, 14),
        有井号编号: /#\d/.test((page && page.innerText) || ''),
        读到的_roles_数组长度: '（见 §判定：talk.js:710 读的是 r.roles，而 roles-json 只有 scenes/channels）',
        频道页整页含_我_的行: ((page && page.innerText) || '').split('\n').filter((l) => l.includes('我')).slice(0, 8)
      };
    });

    /* ---------- 角色卡 + 信息窗（talk.js roleCard / paintSheet） ---------- */
    out.c_角色卡与信息窗 = await page.evaluate(async () => {
      HP.Talk.view = 'channel'; HP.Talk.sel = null;
      HP.Talk.render();
      await new Promise((r) => setTimeout(r, 700));
      const cards = [...document.querySelectorAll('.tk-rolecard')].map((c) => ({
        角色: c.getAttribute('data-role'),
        第一行: (c.querySelector('.row1 .name') || {}).textContent || '',
        副行: (c.querySelector('.sub') || {}).textContent || '',
        含编号: /#\d/.test(c.innerText || '')
      }));
      await HP.Talk.openRoleSheet('home.maid');
      await new Promise((r) => setTimeout(r, 400));
      const sheet = document.querySelector('#tk-sheet .tk-sheetcard');
      const sheetRows = sheet ? [...sheet.querySelectorAll('.tk-sheetrow')].map((r) => ({
        键: (r.querySelector('.tk-k') || {}).textContent, 值: (r.querySelector('.tk-v') || {}).textContent
      })) : null;
      await HP.Talk.closeSheet();
      return { 卡片: cards, 信息窗行: sheetRows, 信息窗含编号: sheet ? /#\d/.test(sheet.innerText) : null };
    });

    /* ---------- 现成的「编号↔人」素材（供改法用：role → session.id） ---------- */
    out.d_素材映射 = await page.evaluate(({ SESS }) => {
      const out = {};
      (SESS.sessions || []).forEach((s) => {
        const win = String(s.tmux || '').split(':');
        out[String(s.id)] = { kind: s.kind, role: s.role, tmux会话: win[0], tmux窗口: win[1], alive: s.alive, name: s.name };
      });
      return out;
    }, { SESS });

    out.e_源码位置 = {
      '会话页(⑤)': 'panels.js:821-859 renderSessions()（数据＝HP.Sessions.list ← tmux.list 桥，只有 tmux 会话名/窗口数/attach，无编号无身份）',
      '频道页历史(⑧)': 'talk.js:706-780 paintHistory()（被 talk.js:413 调；数据＝talk.sessions + talk.roles + talk.hermesSessions）',
      '角色卡': 'talk.js:506-535 roleCard()（副行 talk.js:519 用 sess() 合成名）',
      '信息窗': 'talk.js:809-830 paintSheet()（「会话」行 talk.js:824 也用 sess()）',
      'sess() 合成名': 'talk.js:137 const sess = (full) => "role-" + full.replace(/\\./g, "-")'
    };
    return out;
  }
};
