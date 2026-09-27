/* R-37 复测 · 主块①聊天页-单聊（抬头/他说的气泡开信息窗 + 三条负向）+ 跨块②聊天页-群聊
 * 全部真触摸：adb shell input tap / adb shell input swipe（系统触摸链路，不是注入事件）
 * 数据：talk.roles / talk.since / talk.thread 用后端真实形状喂进真渲染路径；判定全走产品代码。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r37-reprobe-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (cmd, tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try { return execSync(`adb -s ${SERIAL} shell ${cmd}`, { stdio: 'ignore' }); }
    catch (e) {
      if (i === tries - 1) throw new Error(`adb '${cmd}' 失败 status=${e.status} stderr=${String(e.stderr || '').slice(0, 160)} stdout=${String(e.stdout || '').slice(0, 160)}`);
      execSync('sleep 1', { stdio: 'ignore' });
    }
  }
};
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const swipe = (x1, y1, x2, y2, ms) => sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`);

export default {
  name: 'R37-复测-单聊开窗',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(() => {
      const now = Math.floor(Date.now() / 1000);
      const items = [];
      for (let i = 0; i < 30; i++) items.push({ who: i % 2 ? 'me' : 'him', body: 'R37-第' + i + '条', at: now - (30 - i) * 60 });
      window.__items = items;
      window.__origRpc = HP.App.rpc.bind(HP.App);
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [
          { id: 9001, from: 'pipeline.author', to: 'me', kind: 'private', topic: '', body: 'R37-群里他说的话', at: now - 300 },
          { id: 9002, from: 'owner.me', to: 'pipeline.author', kind: 'private', topic: '', body: 'R37-群里我说的话', at: now - 240 },
          { id: 9003, from: 'pipeline.renderer', to: 'me', kind: 'private', topic: '', body: 'R37-群里渲染者的话', at: now - 180 }], last: 9003 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items: window.__items };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
    });

    const dev = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, hit: (() => { const h = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)); return h ? h.tagName + '.' + String(h.className).split(' ').slice(0, 2).join('.') : null; })() }; }, sel);
    const sheet = () => page.evaluate(() => {
      const d = document.querySelector('.tk-sheetcard');
      if (!d) return { open: false };
      const rows = [...d.querySelectorAll('.tk-sheetrow')].map((x) => ({ k: (x.querySelector('.tk-k') || {}).textContent, v: (x.querySelector('.tk-v') || {}).textContent }));
      return { open: true, head: (d.querySelector('.tk-title') || {}).textContent, rows };
    });
    const closeSheet = async () => { await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} }); await page.waitForTimeout(300); };
    const scrollTop = () => page.evaluate(() => { const b = document.querySelector('.tk-bub'); if (!b) return null; let e = b.parentElement; while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement; return e ? Math.round(e.scrollTop) : null; });
    const waitFor = async (sel, ms = 5000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true; await page.waitForTimeout(250); } return false; };

    try {
      /* 校准触摸（群聊身份键） */
      await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 900)); });
      const w0 = await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim());
      const dw = await dev('#tk-whosay2'); tap(dw.x, dw.y); await page.waitForTimeout(600);
      out.calibration = { before: w0, after: await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim()) };

      /* ---------- 主块① 单聊 ---------- */
      out.chat = await page.evaluate(async () => {
        HP.App.showBoard('talk');
        await HP.Talk.openRole('pipeline.author');
        await new Promise((r) => setTimeout(r, 1600));
        const t = document.querySelector('.tk-title');
        const boxes = [...document.querySelectorAll('.tk-bub')];
        let e = boxes[0] ? boxes[0].parentElement : null;
        while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement;
        const exp = (s) => { const r = s.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; };
        return {
          titleText: t ? t.textContent.trim() : null, titleDevice: t ? exp(t) : null,
          bubCount: boxes.length,
          meCount: boxes.filter((b) => b.classList.contains('me')).length,
          himCount: boxes.filter((b) => b.classList.contains('him')).length,
          himDevice: boxes.length ? exp(boxes.filter((b) => b.classList.contains('him')).slice(-1)[0]) : null,
          himDevice2: boxes.length > 4 ? exp(boxes.filter((b) => b.classList.contains('him')).slice(-3)[0]) : null,
          meDevice: boxes.length ? exp(boxes.filter((b) => b.classList.contains('me')).slice(-1)[0]) : null,
          scroller: e ? { id: e.id || null, cls: String(e.className), scrollTop: Math.round(e.scrollTop), scrollHeight: e.scrollHeight, clientHeight: e.clientHeight } : null,
          tapwhoCount: document.querySelectorAll('[data-tapwho="1"]').length
        };
      });

      /* 1) 点抬头 → 开窗 + 全名一致 */
      await closeSheet();
      tap(out.chat.titleDevice.x, out.chat.titleDevice.y);
      await page.waitForTimeout(900);
      out.tapTitle = await sheet();

      /* 2) 点「他说的」气泡 → 开窗 */
      await closeSheet();
      tap(out.chat.himDevice.x, out.chat.himDevice.y);
      await page.waitForTimeout(900);
      out.tapHim = await sheet();

      /* 3a) 负向：点我自己的气泡 → 不开 */
      await closeSheet();
      tap(out.chat.meDevice.x, out.chat.meDevice.y);
      await page.waitForTimeout(800);
      out.tapMe = await sheet();

      /* 3b) 负向：点空白处（气泡之间的缝）→ 不开 */
      await closeSheet();
      const blank = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('.tk-bub')];
        const a = bs[bs.length - 3], b = bs[bs.length - 2];
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        if (rb.top - ra.bottom >= 6) { const y = Math.round((ra.bottom + rb.top) / 2), x = Math.round(ra.x + 8); return { x: Math.round(x * (1080 / window.innerWidth)), y: Math.round(136 + y * (2138 / window.innerHeight)), css: { x: x, y: y } }; }
        const last = bs[bs.length - 1].getBoundingClientRect();
        const par = document.querySelector('.tk-bub').parentElement.getBoundingClientRect();
        const y = Math.round(last.bottom + 6), x = Math.round(par.x + par.width - 20);
        return { x: Math.round(x * (1080 / window.innerWidth)), y: Math.round(136 + y * (2138 / window.innerHeight)), css: { x: x, y: y } };
      });
      out.blankPoint = blank;
      tap(blank.x, blank.y);
      await page.waitForTimeout(800);
      out.tapBlank = await sheet();

      /* 3c) 负向：在气泡上滑 70px（≈192 设备像素）→ 不开窗 + 列表照常滚动 */
      await closeSheet();
      const before = await scrollTop();
      const him = await dev('.tk-bub.him');
      const dy70 = Math.round(70 * (2138 / 778));
      swipe(him.x, him.y + Math.round(dy70 / 2), him.x, him.y - Math.round(dy70 / 2), 250);
      await page.waitForTimeout(900);
      out.swipe70 = { sheet: await sheet(), scrollTopBefore: before, scrollTopAfter: await scrollTop() };

      /* 3d) 小位移 20px 也在守卫内 */
      await closeSheet();
      const before20 = await scrollTop();
      const him20 = await dev('.tk-bub.him');
      const dy20 = Math.round(20 * (2138 / 778));
      swipe(him20.x, him20.y + Math.round(dy20 / 2), him20.x, him20.y - Math.round(dy20 / 2), 200);
      await page.waitForTimeout(800);
      out.swipe20 = { sheet: await sheet(), scrollTopBefore: before20, scrollTopAfter: await scrollTop() };

      /* 4) 滑完再点 / 点完再滑：不粘滞 */
      await closeSheet();
      const himAgain = await dev('.tk-bub.him');
      tap(himAgain.x, himAgain.y);
      await page.waitForTimeout(900);
      out.tapAfterSwipe = await sheet();
      await closeSheet();
      const before2 = await scrollTop();
      const him2 = await dev('.tk-bub.him');
      swipe(him2.x, him2.y + 80, him2.x, him2.y - 80, 250);
      await page.waitForTimeout(900);
      out.swipeAfterTap = { sheet: await sheet(), scrollTopBefore: before2, scrollTopAfter: await scrollTop() };

      /* ---------- 跨块② 群聊 ---------- */
      await closeSheet();
      out.group = await page.evaluate(async () => {
        HP.App.showBoard('group');
        await new Promise((r) => setTimeout(r, 1500));
        const bs = [...document.querySelectorAll('.tk-bub')];
        const exp = (s) => { const r = s.getBoundingClientRect(); return { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; };
        const him = bs.filter((b) => b.classList.contains('him'));
        const me = bs.filter((b) => b.classList.contains('me'));
        return { total: bs.length, him: him.length, me: me.length, himDevice: him.length ? exp(him.slice(-1)[0]) : null, meDevice: me.length ? exp(me.slice(-1)[0]) : null };
      });
      await closeSheet();
      tap(out.group.himDevice.x, out.group.himDevice.y);
      await page.waitForTimeout(900);
      out.groupTapHim = await sheet();
      await closeSheet();
      tap(out.group.meDevice.x, out.group.meDevice.y);
      await page.waitForTimeout(800);
      out.groupTapMe = await sheet();

      /* ---------- 常驻键 / 遮挡 / R-38 只读复核 ---------- */
      out.chrome = await page.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; };
        return { keybar: vis('keybar'), composer: vis('composer') };
      });
      out.r38 = await page.evaluate(async () => {
        HP.App.rpc = async (op) => {
          if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
            { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] },
            { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] },
            { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', channels: [] },
            { full_name: 'owner.me', title: '我（经理）', online: true, state: 'running', channels: [] },
            { full_name: 'home.maid', title: '可爱女仆', online: false, state: 'paused', channels: [] }] }], channels: { qqbot: 1 } };
          if (op === 'talk.since') return { messages: [], last: 0 };
          if (op === 'talk.asks') return { count: 0, asks: [] };
          return {};
        };
        HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
        await new Promise((r) => setTimeout(r, 2500));
        const g = document.getElementById('tk-gogroup').getBoundingClientRect();
        const gh = document.elementFromPoint(Math.round(g.x + g.width / 2), Math.round(g.y + g.height / 2));
        const maid = document.querySelector('[data-role="home.maid"]');
        const mr = maid.getBoundingClientRect();
        const mh = document.elementFromPoint(Math.round(mr.x + mr.width / 2), Math.round(mr.y + mr.height / 2));
        return {
          gogroup: { px: { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width), h: Math.round(g.height) }, inViewport: g.bottom <= window.innerHeight, hitSelf: !!(gh && (gh === document.getElementById('tk-gogroup') || document.getElementById('tk-gogroup').contains(gh))), hitWhat: gh ? gh.tagName : null },
          homeMaid: { px: { x: Math.round(mr.x), y: Math.round(mr.y), w: Math.round(mr.width), h: Math.round(mr.height) }, hitSelf: !!(mh && (mh === maid || maid.contains(mh))), hitWhat: mh ? mh.tagName + '.' + String(mh.className).split(' ')[0] : null },
          viewport: { w: window.innerWidth, h: window.innerHeight }
        };
      });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
