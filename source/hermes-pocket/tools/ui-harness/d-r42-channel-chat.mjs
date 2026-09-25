/* R-42 定位探针：App「频道」页点开到底能不能聊天 —— 三条入口逐个用**真触摸**点，记每次点击后 DOM 里出现/缺少什么。
 * 三条入口：A 顶部「频道（N）」折叠区（含展开后的频道行）· B 频道流里的消息气泡 · C 角色卡
 * 每一步都回答：进到哪一层？有没有输入框（#tk-sayin / #tk-shoutin）？要点几下才到"能打字"？
 * 只读不写：不改工程文件。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r42-channel-chat.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R40-定位-20260924/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const ROLES = read('roles-json.json');
const SESS = read('sessions-json.json');
const BATCH = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../evidence/R28-定位-20260923/batch0.json'), 'utf8'));

export default {
  name: 'R-42 定位：频道页三条入口能不能一步进到「能打字」',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    await page.evaluate(({ ROLES, SESS, BATCH }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.since') { setTimeout(() => reply(m._rid, BATCH), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS, BATCH });

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const tap = async (x, y) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await page.waitForTimeout(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(450);
    };

    /* 当前状态快照：在哪一层、有没有输入框 */
    const state = (label) => page.evaluate((label) => {
      const q = (s) => document.querySelector(s);
      const on = (s) => { const e = q(s); return !!(e && e.getBoundingClientRect().height > 0); };  /* offsetParent 对 fixed 祖先会误判，不用它 */
      return {
        步骤: label,
        视图: (typeof HP !== 'undefined' && HP.Talk) ? HP.Talk.view : null,
        选中角色: (HP.Talk && HP.Talk.sel) ? HP.Talk.sel.full_name : null,
        信息窗在: on('#tk-sheet'),
        单聊输入框在: on('#tk-sayin'),
        群聊输入框在: on('#tk-shoutin'),
        频道流在: on('#tk-stream'),
        角色卡数: document.querySelectorAll('.tk-rolecard').length,
        频道折叠区在: on('#tk-channels-toggle'),
        频道折叠已展开: !!q('#tk-channels'),
        频道行数: document.querySelectorAll('.tk-chrow').length,
        页面上可见的一级键: [...document.querySelectorAll('#tab-talk .tk-act, #tab-talk .tk-chip')].map((b) => (b.textContent || '').trim().slice(0, 14)).filter((x) => x).slice(0, 8)
      };
    }, label);

    const rect = (sel) => page.evaluate((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      e.scrollIntoView({ block: 'center' });
      const r = e.getBoundingClientRect();
      if (!r.height) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), 文本: (e.textContent || '').trim().slice(0, 18) };
    }, sel);

    /* 进频道页 */
    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); HP.Talk.view = 'channel'; HP.Talk.sel = null; HP.Talk.render(); await new Promise((r) => setTimeout(r, 900)); });
    out.起步 = await state('进频道页');

    /* ---- 入口 A：顶部「频道（N）」折叠区 ---- */
    const aToggle = await rect('#tk-channels-toggle');
    out.A_频道折叠区_位置 = aToggle;
    if (aToggle) {
      await tap(aToggle.x, aToggle.y);
      out.A_点折叠区后 = await state('点「频道（N）」折叠区');
      const aRow = await rect('.tk-chrow');
      out.A_频道行_位置 = aRow;
      if (aRow) {
        await tap(aRow.x, aRow.y);
        out.A_点频道行后 = await state('点展开后的频道行（qqbot → home.maid）');
      }
    }

    /* ---- 入口 C：角色卡（先复位到频道页） ---- */
    await page.evaluate(async () => { HP.Talk.view = 'channel'; HP.Talk.sel = null; HP.Talk.render(); await new Promise((r) => setTimeout(r, 700)); });
    const cCard = await rect('.tk-rolecard');
    out.C_角色卡_位置 = cCard;
    if (cCard) {
      await tap(cCard.x, cCard.y);
      out.C_点角色卡后 = await state('点角色卡（第 1 张）');
      const talkBtn = await rect('#tk-sess-talk, [data-testid="talk-sheet-say"]');
      out['C_信息窗里跟他对话按钮位置'] = talkBtn;
      if (talkBtn) {
        await tap(talkBtn.x, talkBtn.y);
        out.C_点跟他对话后 = await state('点「跟他对话」');
      }
    }

    /* ---- 入口 B：频道流里的非本人气泡 ---- */
    await page.evaluate(async () => { HP.Talk.view = 'channel'; HP.Talk.sel = null; HP.Talk.render(); await new Promise((r) => setTimeout(r, 900)); });
    const bBub = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#tk-stream .tk-bub.him')];
      const el = rows[rows.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), 文本: (el.innerText || '').replace(/\n+/g, ' ').slice(0, 30) };
    });
    out.B_频道流气泡_位置 = bBub;
    if (bBub) {
      await tap(bBub.x, bBub.y);
      out.B_点气泡后 = await state('点频道流里的"他说的"气泡');
    }

    /* ---- 从频道页到"能打字"最少要点几下（把三条路各数一遍） ---- */
    out.D_最短路径计数 = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      HP.Talk.view = 'channel'; HP.Talk.sel = null; HP.Talk.render(); await wait(700);
      /* ① 角色卡 → 信息窗 → 跟他对话（3 次点击到输入框） */
      let steps = 0;
      const card = document.querySelector('.tk-rolecard');
      card.dispatchEvent(new MouseEvent('click', { bubbles: true })); steps += 1; await wait(350);
      const sayBtn = document.querySelector('[data-testid="talk-sheet-say"]');
      if (sayBtn) { sayBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); steps += 1; await wait(700); }
      const hasSayin = !!document.querySelector('#tk-sayin');
      return { 角色卡到输入框_点击数: steps + (hasSayin ? 0 : 0), 到输入框时已有输入框: hasSayin, 说明: '点卡=信息窗（1）→ 跟他对话（2）→ 单聊页出现 #tk-sayin' };
    });

    /* ---- 关键读数的 DOM 原文（有没有可输入入口） ---- */
    out.E_DOM原文 = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      HP.Talk.view = 'channel'; HP.Talk.sel = null; HP.Talk.render(); await wait(700);
      const flat = (el) => (el.innerText || '').replace(/\n+/g, ' | ').slice(0, 300);
      const page1 = flat(document.getElementById('tab-talk'));
      const inputsInChannel = [...document.querySelectorAll('#tab-talk input, #tab-talk textarea')].map((i) => i.id || i.className);
      const channelRows = [...document.querySelectorAll('.tk-chrow')].map((r) => ({ 文本: flat(r), 可点: !!r.onclick || r.getAttribute('role') === 'button' }));
      return { 频道页可见文案: page1, 频道页里的输入控件: inputsInChannel, 频道行: channelRows, 频道行有监听: channelRows.some((x) => x.可点) };
    });

    /* 对照：群聊页（那片**有**消息流 + 有输入框的地方） */
    out.F_群聊页对照 = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 800));
      const has = (s) => { const e = document.querySelector(s); return !!(e && e.getBoundingClientRect().height > 0); };
      return { 视图: HP.App.current, 消息流在: has('#tk-stream'), 群聊输入框在: has('#tk-shoutin'), 说明: '#tk-stream 是**群聊页**（paintGroup talk.js:529-544）建的；频道页没有它' };
    });

    out.G_结论读数 = {
      '频道页有没有消息流': '没有（#tk-stream 只在群聊页创建，talk.js:529-544；频道页 tick 里 paintStream 因取不到容器直接返回）',
      '频道页有没有聊天输入框': '没有（#tab-talk 下只有「＋新角色」表单的 4 个 input：tk-new-scene/name/title/tags）',
      '「频道（N）」折叠区能干什么': '只展开/折叠一行只读的「频道名 → 谁能收到」；行本身不可点、不能发消息',
      '角色卡点一下发生什么': '开信息窗（不直接进单聊）；要再点「跟他对话」才进单聊',
      '从频道页到能打字要点几下': '2 下（角色卡 → 跟他对话）'
    };
    return out;
  }
};
