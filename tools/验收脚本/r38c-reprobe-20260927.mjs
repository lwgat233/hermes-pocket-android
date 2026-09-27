/* R-38 第 3 步复测 · 只量「列表末尾间隙 24px → 要不要补到 ≥44dp」两案读数（不裁决、不改代码）
 * 主块①单聊（改动面）+ 跨块⑧频道页（同一套"末尾 vs 底部条"结构 + R-42 热区）
 * B 案用**页面内临时改 padding-bottom 模拟**（只在内存里改 CSS，不动包/不动源树），量完立刻还原。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r38c-reprobe-20260927.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (c) => execSync(`adb -s ${SERIAL} shell ${c}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);

export default {
  name: 'R38-3-复测-末尾间隙两案读数',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      window.__thread = [];
      for (let i = 0; i < 30; i++) window.__thread.push({ who: i % 2 ? 'me' : 'him', body: 'R38c-第' + i + '条', at: now - (30 - i) * 60 });
      window.__thread.push({ who: 'him', body: 'R38c-末条他说的', at: now });
      HP.App.rpc = async (op, a) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: [] }] }], channels: {} };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: window.__thread };
        if (op === 'talk.say') return { id: 1, to: a.role, ok: 1, delivered: true, ms: 3329, attempts: 1, confirmed: 1 };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    });
    /* 一次读数：A/B 案共用（B 案只是把内层 padding-bottom 换成"条高+44px"再读一遍） */
    const probe = (tag) => page.evaluate((t) => {
      const c = document.getElementById('tk-chat');
      const say = document.getElementById('tk-sayline');
      const bubs = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const last = bubs[bubs.length - 1];
      const cr = c.getBoundingClientRect(), sr = say.getBoundingClientRect(), lr = last.getBoundingClientRect();
      const band = { top: Math.round(cr.top), bottom: Math.round(sr.top) };
      const fully = bubs.filter((b) => { const r = b.getBoundingClientRect(); return r.top >= band.top - 1 && r.bottom <= band.bottom + 1; }).length;
      const h = document.elementFromPoint(Math.round(lr.x + lr.width / 2), Math.round(lr.y + lr.height / 2));
      const root = getComputedStyle(document.documentElement);
      return {
        tag: t,
        scroller: { top: Math.round(cr.top), bottom: Math.round(cr.bottom), clientHeight: c.clientHeight, scrollTop: Math.round(c.scrollTop), max: c.scrollHeight - c.clientHeight, paddingBottom: getComputedStyle(c).paddingBottom },
        sayline: { top: Math.round(sr.top), bottom: Math.round(sr.bottom), h: Math.round(sr.height) },
        lastBub: { top: Math.round(lr.top), bottom: Math.round(lr.bottom), h: Math.round(lr.height), w: Math.round(lr.width) },
        gapToSayline: Math.round(sr.top - lr.bottom),
        clickableHeight: Math.round(Math.min(lr.bottom, sr.top) - lr.top),
        hitWhat: h ? h.tagName + '.' + String(h.className).split(' ').slice(0, 2).join('.') : null,
        hitSelf: !!(h && (h === last || last.contains(h))),
        fullyVisibleBubbles: fully,
        bubblePitch: bubs.length > 1 ? Math.round(bubs[1].getBoundingClientRect().top - bubs[0].getBoundingClientRect().top) : null,
        vars: { saylineH: root.getPropertyValue('--sayline-h').trim(), safeB: root.getPropertyValue('--safe-b').trim() },
        viewport: { w: window.innerWidth, h: window.innerHeight }
      };
    }, tag);
    try {
      /* ---------- 主块①单聊 ---------- */
      await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.openRole('pipeline.author'); await new Promise((r) => setTimeout(r, 1800)); const c = document.getElementById('tk-chat'); c.scrollTop = c.scrollHeight; await new Promise((r) => setTimeout(r, 600)); });
      out.A_现状 = await probe('A 现状（滚到底，不改任何东西）');
      /* R-39 回归：真触摸末条 → 开窗 */
      const pt = await page.evaluate(() => { const b = [...document.querySelectorAll('#tk-chat .tk-bub')].slice(-1)[0]; const r = b.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; });
      tap(pt.x, pt.y); await page.waitForTimeout(1000);
      out.R39_真触摸末条 = await page.evaluate(() => ({ sheet: !!document.querySelector('.tk-sheetcard'), 全名: (() => { const d = document.querySelector('.tk-sheetcard'); if (!d) return null; const r = [...d.querySelectorAll('.tk-sheetrow')].find((x) => x.querySelector('.tk-k').textContent === '全名'); return r ? r.querySelector('.tk-v').textContent : null; })() }));
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);
      /* ---------- B 案模拟（内存里把内层 padding-bottom 换成 条高+44px，量完还原）---------- */
      await page.evaluate(() => {
        const c = document.getElementById('tk-chat');
        c.setAttribute('data-orig-pb', getComputedStyle(c).paddingBottom);
        c.style.paddingBottom = 'calc(var(--sayline-h, 68px) + var(--safe-b, 0px) + 44px)';
        c.scrollTop = c.scrollHeight;
      });
      await page.waitForTimeout(600);
      out.B_补到44dp = await probe('B 模拟（内层 padding-bottom 改成 条高+44px，只在本页内存里改）');
      out.B_代价 = { 内层paddingBottom变化: '68px → 104px（+36px）', 末尾多出空白px: 36, 一屏可见气泡数A: out.A_现状.fullyVisibleBubbles, 一屏可见气泡数B: out.B_补到44dp.fullyVisibleBubbles, 气泡间距px: out.A_现状.bubblePitch };
      /* 还原（并复读一次确认还回去） */
      await page.evaluate(() => { const c = document.getElementById('tk-chat'); c.style.paddingBottom = ''; c.scrollTop = c.scrollHeight; });
      await page.waitForTimeout(400);
      out.restored = await probe('还原后');
      /* ---------- 跨块⑧频道页：同一套"末尾 vs 底部条"结构 + R-42 热区 ---------- */
      out.channel = await page.evaluate(async () => {
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 1800));
        const sc = [...document.querySelectorAll('.panel-body')].find((e) => e.scrollHeight > e.clientHeight) || document.querySelector('.panel-body');
        sc.scrollTop = sc.scrollHeight;
        await new Promise((r) => setTimeout(r, 500));
        const comp = document.getElementById('composer').getBoundingClientRect();
        const kids = [...sc.querySelectorAll('[data-role], #tk-gogroup')];
        const lastEl = kids[kids.length - 1];
        const lr = lastEl.getBoundingClientRect();
        return {
          容器: { id: sc.id || null, cls: String(sc.className), paddingBottom: getComputedStyle(sc).paddingBottom, scrollTop: Math.round(sc.scrollTop), max: sc.scrollHeight - sc.clientHeight },
          末尾元素: { tag: lastEl.tagName, id: lastEl.id || null, cls: String(lastEl.className), bottom: Math.round(lr.bottom) },
          composerTop: Math.round(comp.top),
          gapToComposer: Math.round(comp.top - lr.bottom),
          caret: (() => { const h = document.querySelector('[data-role="pipeline.author"] .tk-carethit'); const r = h.getBoundingClientRect(); const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return { w: Math.round(r.width), h: Math.round(r.height), hitWhat: hit ? hit.tagName + '.' + String(hit.className).split(' ')[0] : null, device: { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) } }; })()
        };
      });
      tap(out.channel.caret.device.x, out.channel.caret.device.y); await page.waitForTimeout(1000);
      out.R42_真触摸热区 = await page.evaluate(() => ({ sheet: !!document.querySelector('.tk-sheetcard'), view: HP.Talk.view }));
      out.chrome = await page.evaluate(() => { const v = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: v('keybar'), composer: v('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
