/* R-39 第 3 步复测 · 主块①单聊（改动面）+ 跨块②群聊 + 跨块⑧频道页
 * 核心：**只滚内层 `#tk-chat` 到底**（不碰外层 .panel-body）→ 真触摸末条气泡 → 应能开信息窗
 * 三读数：①末条下沿 vs #tk-sayline 上沿/重叠量 ②scrollIntoView 后 elementFromPoint 命中谁
 *        ③#tk-chat 的 padding-bottom 与 --sayline-h 实际值
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r39-reprobe-20260925.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const key = (c) => sh(`input keyevent ${c}`);

export default {
  name: 'R39-复测-末条不被压',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      window.__thread = [];
      for (let i = 0; i < 30; i++) window.__thread.push({ who: i % 2 ? 'me' : 'him', body: 'R39-第' + i + '条', at: now - (30 - i) * 60 });
      window.__say = [];
      HP.App.rpc = async (op, a) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: [] }] }], channels: {} };
        if (op === 'talk.since') return { messages: [{ id: 9001, from: 'pipeline.author', to: 'me', kind: 'private', topic: '', body: 'R39-群里的话', at: 1790260000 }], last: 9001 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: window.__thread };
        if (op === 'talk.say') { window.__say.push(a); window.__thread = window.__thread.concat([{ who: 'me', body: a.body, at: 1790260200 }]); return { id: 1, to: a.role, ok: 1, delivered: true, ms: 3329, attempts: 1, confirmed: 1 }; }
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    });
    const measure = () => page.evaluate(() => {
      const chat = document.getElementById('tk-chat');
      const say = document.getElementById('tk-sayline');
      const bubs = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const last = bubs[bubs.length - 1];
      const g = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), x: Math.round(r.x), w: Math.round(r.width) }; };
      const lr = last ? last.getBoundingClientRect() : null;
      const sr = say ? say.getBoundingClientRect() : null;
      const cs = chat ? getComputedStyle(chat) : null;
      const root = getComputedStyle(document.documentElement);
      return {
        外层bodyScrollTop: (() => { const p = document.querySelector('.panel-body'); return p ? Math.round(p.scrollTop) : null; })(),
        inner: chat ? { scrollTop: Math.round(chat.scrollTop), scrollHeight: chat.scrollHeight, clientHeight: chat.clientHeight, max: chat.scrollHeight - chat.clientHeight, paddingBottom: cs.paddingBottom, id: chat.id } : null,
        vars: { saylineH: root.getPropertyValue('--sayline-h').trim(), safeB: root.getPropertyValue('--safe-b').trim() },
        bubCount: bubs.length,
        lastBub: g(last), sayline: g(say),
        overlap: (lr && sr) ? Math.max(0, Math.round(Math.min(lr.bottom, sr.bottom) - Math.max(lr.top, sr.top))) : null,
        gap: (lr && sr) ? Math.round(sr.top - lr.bottom) : null,
        sayinCount: document.querySelectorAll('#tk-sayin').length,
        visibleSendsRows: (() => { const boxes = [...document.querySelectorAll('#tk-sends')]; const vis = boxes.find((b) => b.getBoundingClientRect().height > 0); return { boxes: boxes.length, visibleRows: vis ? vis.querySelectorAll('.tk-sendrow').length : 0 }; })()
      };
    });
    try {
      /* ===== 主块①单聊 ===== */
      await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author'); await new Promise((r) => setTimeout(r, 1800)); });
      out.beforeInnerScroll = await measure();
      /* 只滚内层到底（不碰外层） */
      await page.evaluate(() => { const c = document.getElementById('tk-chat'); c.scrollTop = c.scrollHeight; });
      await page.waitForTimeout(700);
      out.afterInnerScroll = await measure();
      /* ② scrollIntoView(nearest) + elementFromPoint */
      out.scrollIntoView = await page.evaluate(() => {
        const bubs = [...document.querySelectorAll('#tk-chat .tk-bub')];
        const last = bubs[bubs.length - 1];
        last.scrollIntoView({ block: 'nearest' });
        const r = last.getBoundingClientRect();
        const h = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return { cls: String(last.className), rect: { top: Math.round(r.top), bottom: Math.round(r.bottom) }, hitWhat: h ? h.tagName + '.' + String(h.className).split(' ').slice(0, 2).join('.') : null, hitIsSelfOrChild: !!(h && (h === last || last.contains(h))), scrollerMax: (() => { const c = document.getElementById('tk-chat'); return c.scrollHeight - c.clientHeight; })(), scrollTop: Math.round(document.getElementById('tk-chat').scrollTop) };
      });
      /* 真触摸末条气泡 → 信息窗应开 */
      const pt = await page.evaluate(() => {
        const bubs = [...document.querySelectorAll('#tk-chat .tk-bub')];
        const last = bubs[bubs.length - 1];
        const r = last.getBoundingClientRect();
        return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { top: Math.round(r.top), bottom: Math.round(r.bottom) } };
      });
      out.lastBubDevice = pt;
      tap(pt.x, pt.y); await page.waitForTimeout(1000);
      out.tapLastBubble = await page.evaluate(() => ({ sheet: !!document.querySelector('.tk-sheetcard'), 全名: (() => { const d = document.querySelector('.tk-sheetcard'); if (!d) return null; const r = [...d.querySelectorAll('.tk-sheetrow')].find((x) => x.querySelector('.tk-k').textContent === '全名'); return r ? r.querySelector('.tk-v').textContent : null; })() }));
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);
      /* R-41 链复核：真机回车 → talk.say 1 + 出现自己的气泡 */
      const sin = await page.evaluate(() => { const el = [...document.querySelectorAll('#tk-sayin')].find((e) => e.getBoundingClientRect().height > 0); const r = el.getBoundingClientRect(); el.value = 'R39-回车复核'; return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      const preBubs = await page.evaluate(() => document.querySelectorAll('#tk-chat .tk-bub').length);
      tap(sin.x, sin.y); await page.waitForTimeout(900); key(66); await page.waitForTimeout(1200);
      out.enterChain = await page.evaluate((pre) => ({ pre: pre, post: document.querySelectorAll('#tk-chat .tk-bub').length, mine: document.querySelectorAll('#tk-chat .tk-bub.me').length, sayCalls: window.__say.length, sayArgs: window.__say.slice(-1), rows: (() => { const b = [...document.querySelectorAll('#tk-sends')].find((x) => x.getBoundingClientRect().height > 0); return b ? [...b.querySelectorAll('.tk-sendrow')].map((r) => (r.querySelector('.tk-sendtext') || {}).textContent) : []; })() }), preBubs);
      /* ===== 跨块②群聊 ===== */
      out.group = await page.evaluate(async () => {
        HP.App.showBoard('group');
        await new Promise((r) => setTimeout(r, 1600));
        const s = document.getElementById('tk-stream');
        const cs = s ? getComputedStyle(s) : null;
        const bubs = [...document.querySelectorAll('#tk-stream .tk-bub')];
        const last = bubs[bubs.length - 1];
        const lr = last ? last.getBoundingClientRect() : null;
        const comp = document.getElementById('composer');
        const cr = comp ? comp.getBoundingClientRect() : null;
        return { streamPaddingBottom: cs ? cs.paddingBottom : null, streamId: s ? s.id : null, hasTkChatClass: s ? s.classList.contains('tk-chat') : null, bubs: bubs.length, lastBub: lr ? { top: Math.round(lr.top), bottom: Math.round(lr.bottom) } : null, composerTop: cr ? Math.round(cr.top) : null, overlapWithComposer: (lr && cr) ? Math.max(0, Math.round(Math.min(lr.bottom, cr.bottom) - Math.max(lr.top, cr.top))) : null, paddingBottomOfIdSelector: (() => { const e = document.getElementById('tk-chat'); return e ? getComputedStyle(e).paddingBottom : '(单聊页不在当前板)'; })() };
      });
      /* ===== 跨块⑧频道页：R-42 回归（一步进单聊 + 右缘热区）===== */
      out.channel = await page.evaluate(async () => {
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 1800));
        const card = document.querySelector('[data-role="pipeline.author"]');
        const hit = card ? card.querySelector('.tk-carethit') : null;
        const cr = card.getBoundingClientRect(), hr = hit.getBoundingClientRect();
        const h = document.elementFromPoint(Math.round(hr.x + hr.width / 2), Math.round(hr.y + hr.height / 2));
        return { cardSub: (card.querySelector('.sub') || {}).textContent, cardDevice: { x: Math.round((cr.x + 60) * (1080 / window.innerWidth)), y: Math.round(136 + (cr.y + cr.height / 2) * (2138 / window.innerHeight)) }, caretHit: { w: Math.round(hr.width), h: Math.round(hr.height), hitWhat: h ? h.tagName + '.' + String(h.className).split(' ')[0] : null }, caretDevice: { x: Math.round((hr.x + hr.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (hr.y + hr.height / 2) * (2138 / window.innerHeight)) }, view: HP.Talk.view };
      });
      tap(out.channel.caretDevice.x, out.channel.caretDevice.y); await page.waitForTimeout(1000);
      out.channelAfterCaretTap = await page.evaluate(() => ({ sheet: !!document.querySelector('.tk-sheetcard'), view: HP.Talk.view }));
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);
      tap(out.channel.cardDevice.x, out.channel.cardDevice.y); await page.waitForTimeout(1400);
      out.channelAfterNameTap = await page.evaluate(() => ({ view: HP.Talk.view, sayin: !!document.querySelector('#tk-sayin') }));
      out.chrome = await page.evaluate(() => { const v = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: v('keybar'), composer: v('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
