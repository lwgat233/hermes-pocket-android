/* R-38 复测 · 主块⑧ 频道页（角色列表）—— 新口径：**先滚到底再判**
 * 交：滚到底后的 scrollTop/scrollHeight/clientHeight；末尾卡与「去群聊 →」的真触摸 + 命中 + 重叠像素；
 *     四个数（.panel-body rect.bottom / #composer rect.top / innerHeight / visualViewport.height）；末尾到 composer 顶的间隙。
 * 全真触摸：adb shell input tap（系统触摸链路）。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r38-reprobe-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const tap = (x, y) => execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' });

export default {
  name: 'R38-复测-滚到底再判',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(async () => {
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [
          { full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] },
          { full_name: 'pipeline.renderer', title: '渲染者', online: true, state: 'running', channels: [] },
          { full_name: 'pipeline.tester', title: '测试者', online: false, state: 'running', channels: [] },
          { full_name: 'owner.me', title: '我（经理）', online: true, state: 'running', channels: [] },
          { full_name: 'home.maid', title: '可爱女仆', online: false, state: 'paused', channels: [] }] }], channels: { qqbot: 1, wechat: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk'); HP.Talk.tab = 'channel'; HP.Talk.view = 'channel';
      await new Promise((r) => setTimeout(r, 2600));
    });
    /* 一次读数：三个数 + 四个数 + 两个目标 + 重叠像素 + 间隙 */
    const readAll = () => page.evaluate(() => {
      const sc = [...document.querySelectorAll('#tab-talk .panel-body, .panel-body')].find((e) => e.scrollHeight > e.clientHeight) || document.querySelector('.panel-body');
      const comp = document.getElementById('composer');
      const cr = comp.getBoundingClientRect();
      const sr = sc.getBoundingClientRect();
      const vv = window.visualViewport || {};
      const info = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
        const h = document.elementFromPoint(cx, cy);
        const ov = Math.max(0, Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top));
        return {
          px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
          dp: { x: +(r.x / 1).toFixed(1), y: +(r.y / 1).toFixed(1), w: +(r.width).toFixed(1), h: +(r.height).toFixed(1) },
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
          hitSelf: !!(h && (h === el || el.contains(h))),
          hitWhat: h ? h.tagName + '.' + String(h.className).split(' ').slice(0, 2).join('.') : null,
          overlapWithComposer: Math.round(ov),
          device: { x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }
        };
      };
      return {
        scroll: { scrollTop: Math.round(sc.scrollTop), scrollHeight: sc.scrollHeight, clientHeight: sc.clientHeight, max: sc.scrollHeight - sc.clientHeight },
        four: { panelBodyBottom: Math.round(sr.bottom), composerTop: Math.round(cr.top), innerHeight: window.innerHeight, vvHeight: Math.round(vv.height || 0), vvOffsetTop: Math.round(vv.offsetTop || 0), vvScale: vv.scale || null },
        cards: [...document.querySelectorAll('[data-role]')].length,
        lastCard: info(document.querySelector('[data-role="home.maid"]')),
        gogroup: info(document.getElementById('tk-gogroup')),
        lastChildBottom: (() => { const cs = document.querySelector('#tk-rolelist') ? [...document.querySelector('#tk-rolelist').children] : [...sc.children]; const last = cs[cs.length - 1]; return last ? Math.round(last.getBoundingClientRect().bottom) : null; })(),
        gapToComposer: (() => { const cs = document.querySelector('#tk-rolelist') ? [...document.querySelector('#tk-rolelist').children] : [...sc.children]; const last = cs[cs.length - 1]; return last ? Math.round(cr.top - last.getBoundingClientRect().bottom) : null; })(),
        view: HP.Talk.view, sheet: !!document.querySelector('.tk-sheetcard')
      };
    });

    try {
      out.beforeScroll = await readAll();                 /* 未滚到底（复现前两轮的形态） */
      await page.evaluate(() => {
        const sc = [...document.querySelectorAll('.panel-body')].find((e) => e.scrollHeight > e.clientHeight) || document.querySelector('.panel-body');
        sc.scrollTop = sc.scrollHeight;                   /* 滚到底 */
      });
      await page.waitForTimeout(700);
      out.afterScrollToBottom = await readAll();
      out.scrollIntoView = await page.evaluate(() => {
        const el = document.querySelector('[data-role="home.maid"]');
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        const h = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
        return { y: Math.round(r.y), bottom: Math.round(r.bottom), hitWhat: h ? h.tagName + '.' + String(h.className).split(' ')[0] : null, hitSelf: !!(h && (h === el || el.contains(h))) };
      });
      /* 真触摸：末尾卡（home.maid）→ 信息窗应真开 */
      const lc = out.afterScrollToBottom.lastCard;
      tap(lc.device.x, lc.device.y);
      await page.waitForTimeout(900);
      out.tapLastCard = await page.evaluate(() => { const d = document.querySelector('.tk-sheetcard'); return { open: !!d, 全名: (() => { if (!d) return null; const r = [...d.querySelectorAll('.tk-sheetrow')].find((x) => (x.querySelector('.tk-k') || {}).textContent === '全名'); return r ? r.querySelector('.tk-v').textContent : null; })() }; });
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);
      /* 真触摸：「去群聊 →」→ 应切到群聊 */
      const gv0 = await page.evaluate(() => HP.Talk.view);
      const gg = out.afterScrollToBottom.gogroup;
      tap(gg.device.x, gg.device.y);
      await page.waitForTimeout(1200);
      out.tapGogroup = { viewBefore: gv0, viewAfter: await page.evaluate(() => HP.Talk.view), titleAfter: await page.evaluate(() => { const t = document.querySelector('#tab-talk .tk-title'); return t ? t.textContent.trim() : null; }) };
      out.chrome = await page.evaluate(() => { const vis = (id) => { const e = document.getElementById(id); if (!e) return null; return [...e.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).length; }; return { keybar: vis('keybar'), composer: vis('composer') }; });
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
