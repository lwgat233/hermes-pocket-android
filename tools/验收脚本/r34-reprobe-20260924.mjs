/* R-34 复测 · 主块⑧频道页（五张角色卡）+ 跨块①单聊信息窗 + 真触摸 + 遮挡复核
 * 数据说明：不接主机 → 用 talk.roles 的**后端真实形状**造 5 个角色（1 个带 channels=['qqbot']、4 个空），
 *          真渲染/真触摸走产品代码；本文件不含任何"改产品代码"的动作。
 * 真触摸：adb shell input tap（系统触摸链路），坐标由页面 rect × (1080/innerWidth, 2138/innerHeight) + y 偏移 136。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r34-reprobe-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => { execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' }); };

const ROLES = [
  { full_name: 'pipeline.author', title: '功能创造者', name: 'author', online: true, state: 'running', pending: 0, channels: ['qqbot'] },
  { full_name: 'pipeline.renderer', title: '渲染者', name: 'renderer', online: true, state: 'running', pending: 0, channels: [] },
  { full_name: 'pipeline.tester', title: '测试者', name: 'tester', online: false, state: 'running', pending: 0, channels: [] },
  { full_name: 'owner.me', title: '我（经理）', name: 'me', online: true, state: 'running', pending: 0, channels: [] },
  { full_name: 'home.maid', title: '可爱女仆', name: 'maid', online: false, state: 'paused', pending: 0, channels: [] }
];

export default {
  name: 'R34-复测-频道页与信息窗',
  check: async (page) => {
    const out = {};
    await page.reload();                       /* 干净起点：上一轮可能留着开着的信息窗浮层（会盖住整页，让命中测试全假红） */
    await page.waitForTimeout(1500);
    out.cleanStart = await page.evaluate(() => ({ sheet: !!document.querySelector('#tk-sheet') }));

    await page.evaluate((roles) => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: roles }], channels: { qqbot: 1, wechat: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: [{ who: 'role', body: '他说的第一句', at: 1790200000 }, { who: 'me', body: '我说的', at: 1790200100 }, { who: 'role', body: '他说的第二句', at: 1790200200 }] };
        if (op === 'talk.sessions') return { sessions: [] };
        if (op === 'talk.deliveries') return { items: [] };
        return {};
      };
    }, ROLES);

    /* ① 频道页：五张角色卡 */
    out.channel = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2500));
      const cards = [...document.querySelectorAll('#tab-talk [data-testid="talk-role"]')];
      const chrome = () => ({ topbar: document.getElementById('topbar'), keybar: document.getElementById('keybar'), composer: document.getElementById('composer') });
      const rows = cards.map((c) => {
        const r = c.getBoundingClientRect();
        const chan = c.querySelector('[data-testid="talk-rolechans"]');
        const sub = c.querySelector('.sub');
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(cx, cy);
        const ch = chrome();
        const cov = (b) => { if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; };
        return {
          role: c.getAttribute('data-role'),
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, dp_h: +r.height.toFixed(1),
          chanRowPresent: !!chan, chanText: chan ? chan.textContent.trim() : null, chanClass: chan ? String(chan.className) : null,
          chanClipped: chan ? (chan.scrollWidth > chan.clientWidth + 1) : null,
          subText: sub ? sub.textContent.trim().slice(0, 40) : null,
          childRows: c.children.length,
          hitIsSelf: !!(hit && (hit === c || c.contains(hit))), hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
          coveredByChrome: cov(ch.topbar) || cov(ch.keybar) || cov(ch.composer),
          deviceTap: { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }
        };
      });
      const gogroup = document.getElementById('tk-gogroup');
      const gr = gogroup ? gogroup.getBoundingClientRect() : null;
      const gh = gr ? document.elementFromPoint(Math.round(gr.x + gr.width / 2), Math.round(gr.y + gr.height / 2)) : null;
      const chanToggle = document.getElementById('tk-channels-toggle');
      return {
        cardCount: cards.length, cards: rows,
        channelsToggleText: chanToggle ? chanToggle.textContent.replace(/\s+/g, ' ').trim().slice(0, 30) : null,
        oldTagsPresent: !!document.querySelector('#tab-talk .tags, #tab-talk .tk-tag'),
        gogroupOcclusion: gr ? { px: { x: Math.round(gr.x), y: Math.round(gr.y), w: Math.round(gr.width), h: Math.round(gr.height) }, hitSelf: !!(gh && (gh === gogroup || gogroup.contains(gh))), hitWhat: gh ? (gh.tagName + '.' + String(gh.className || '').split(' ')[0]) : null } : null
      };
    });

    /* ① 真触摸：点第一张卡（pipeline.author）→ 信息窗真开 */
    const first = out.channel.cards.find((c) => c.role === 'pipeline.author') || out.channel.cards[0];
    const beforeSheet = await page.evaluate(() => !!document.querySelector('.tk-sheetcard'));
    tap(first.deviceTap.x, first.deviceTap.y);
    await page.waitForTimeout(900);
    out.tapCard = {
      device: first.deviceTap, sheetBefore: beforeSheet,
      sheetAfter: await page.evaluate(() => {
        const card = document.querySelector('.tk-sheetcard');
        if (!card) return { open: false };
        const rows = [...card.querySelectorAll('.tk-sheetrow')].map((d) => ({ k: (d.querySelector('.tk-k') || {}).textContent, v: (d.querySelector('.tk-v') || {}).textContent }));
        return { open: true, rows: rows, head: (card.querySelector('.tk-sheethead') || {}).textContent || '', text: card.textContent.replace(/\s+/g, ' ').slice(0, 160) };
      })
    };
    /* 关掉信息窗（真触摸 ✕） */
    const xBtn = await page.evaluate(() => { const x = document.getElementById('tk-sheetx'); if (!x) return null; const r = x.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
    if (xBtn) { tap(xBtn.x, xBtn.y); await page.waitForTimeout(600); }
    out.sheetClosed = await page.evaluate(() => !document.querySelector('.tk-sheetcard'));

    /* ② 单聊：点消息头开信息窗（有频道 / 无频道各一次）—— 每步先确保上一张窗已关（否则读到的是旧窗） */
    const closeSheet = async () => {
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} const x = document.getElementById('tk-sheetx'); if (x) x.click(); });
      await page.waitForTimeout(400);
      return page.evaluate(() => !document.querySelector('#tk-sheet'));
    };
    const sheetFor = async (role) => {
      const closed = await closeSheet();
      await page.evaluate(async (full) => { await HP.Talk.openRole(full); await new Promise((r) => setTimeout(r, 1200)); }, role);
      const t = await page.evaluate(() => {
        const bub = document.querySelector('#tk-chat .tk-bub');
        if (!bub) return null;
        const r = bub.getBoundingClientRect();
        return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + 18) * (2138 / window.innerHeight)), bubbles: document.querySelectorAll('#tk-chat .tk-bub').length };
      });
      if (!t) return { role: role, error: 'no bubbles' };
      tap(t.x, t.y);
      await page.waitForTimeout(900);
      const sheet = await page.evaluate(() => {
        const card = document.querySelector('.tk-sheetcard');
        if (!card) return { open: false };
        const rows = [...card.querySelectorAll('.tk-sheetrow')].map((d) => ({ k: (d.querySelector('.tk-k') || {}).textContent, v: (d.querySelector('.tk-v') || {}).textContent }));
        const chan = rows.find((r2) => r2.k === '接入频道');
        const head = (card.querySelector('.tk-sheethead .name') || {}).textContent || '';
        return { open: true, headName: head, chanRow: chan || null, allKeys: rows.map((r2) => r2.k), oldKeyPresent: rows.some((r2) => /能接入/.test(String(r2.k))) };
      });
      return { role: role, tapY: t.y, bubbles: t.bubbles, closedBefore: closed, sheet: sheet };
    };
    out.roleChatWithChan = await sheetFor('pipeline.author');
    out.roleChatNoChan = await sheetFor('pipeline.tester');

    /* ④ 遮挡/常驻按键 */
    out.chrome = await page.evaluate(() => {
      const vis = (id) => { const e = document.getElementById(id); if (!e) return null; const bs = [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0); return { n: bs.length, labels: bs.map((b) => String(b.textContent).trim().slice(0, 8)) }; };
      return { keybar: vis('keybar'), composer: vis('composer') };
    });
    return out;
  }
};
