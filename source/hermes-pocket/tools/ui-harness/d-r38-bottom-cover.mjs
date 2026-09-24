/* R-38 定位探针：频道页（角色列表）末尾到底被底部固定层压住没有。
 * 量法：真页面（真 DOM/CSS、视口对齐 tester 的 393×778）——
 *   ① 列出所有底部固定层（#composer / #keybar）的高度、位置、z-index、安全区内边距；
 *   ② 列表容器是谁、能不能滚、滚到底之后最后一张卡与「去群聊 →」在哪；
 *   ③ 最后一张卡中心 elementFromPoint 命中谁（tester 报的是 TEXTAREA）；
 *   ④ 复刻 tester 的读数位置（最后一张卡 y≈588）与滚到底两种状态，各自算重叠像素。
 * 只读不写：不改工程文件。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r38-bottom-cover.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R34-定位-20260924/fixtures');
const ROLES = JSON.parse(fs.readFileSync(path.join(FX, 'roles-json.json'), 'utf8'));
const SESS = JSON.parse(fs.readFileSync(path.join(FX, 'sessions-json.json'), 'utf8'));

export default {
  name: 'R-38 定位：角色列表末尾被底部固定层压住吗',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    await page.evaluate(({ ROLES, SESS }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS });

    /* 真路径进频道页；并确认底部两层的显隐实态 */
    out.显示层 = await page.evaluate(async () => {
      HP.App.showBoard('talk');
      await HP.Talk.refreshRoles();
      HP.Talk.render();
      await new Promise((r) => setTimeout(r, 600));
      const st = (id) => { const e = document.getElementById(id); return e ? { hidden: e.classList.contains('hidden'), 显示: getComputedStyle(e).display } : null; };
      return { composer: st('composer'), keybar: st('keybar'),
        显示输入框设置: HP.App.bool('showComposer', true), 显示键条设置: HP.App.bool('showKeybar', true) };
    });

    const R = () => page.evaluate(() => {
      const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), top: Math.round(r.top) }; };
      const cs = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); return { position: c.position, zIndex: c.zIndex, paddingBottom: c.paddingBottom, height: c.height, overflow: c.overflowY }; };
      const cards = [...document.querySelectorAll('.tk-rolecard')];
      const last = cards[cards.length - 1];
      const lr = last ? last.getBoundingClientRect() : null;
      const go = [...document.querySelectorAll('.tk-act, .tk-chip')].find((b) => (b.textContent || '').includes('去群聊'));
      const gr = go ? go.getBoundingClientRect() : null;
      const pb = document.querySelector('.panel-body');
      const pbCs = pb ? getComputedStyle(pb) : null;
      const hit = (x, y) => { const e = document.elementFromPoint(x, y); return e ? ((e.tagName || '') + '.' + ((e.className || '').toString().split(' ')[0] || '')).slice(0, 30) : 'null'; };
      const cp = rect('#composer'), kb = rect('#keybar');
      const chromeTop = Math.min(cp && !document.getElementById('composer').classList.contains('hidden') ? cp.top : 1e9,
                                 kb && !document.getElementById('keybar').classList.contains('hidden') ? kb.top : 1e9);
      return {
        视口高: window.innerHeight,
        列表容器: pb ? { class: '.panel-body', rect: rect('.panel-body'), scrollTop: Math.round(pb.scrollTop), clientHeight: pb.clientHeight, scrollHeight: pb.scrollHeight, 可滚到: Math.round(pb.scrollHeight - pb.clientHeight), 底部内边距: pbCs.paddingBottom } : null,
        卡片数: cards.length,
        最后一张卡: lr ? { x: Math.round(lr.left), y: Math.round(lr.top), w: Math.round(lr.width), h: Math.round(lr.height), bottom: Math.round(lr.bottom), 文本: (last.innerText || '').replace(/\n+/g, ' ').slice(0, 40) } : null,
        最后一张卡中心命中: lr ? hit(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2)) : null,
        去群聊: gr ? { x: Math.round(gr.left), y: Math.round(gr.top), w: Math.round(gr.width), h: Math.round(gr.height), bottom: Math.round(gr.bottom), 在视口内: gr.top >= 0 && gr.bottom <= window.innerHeight, 中心命中: hit(Math.round(gr.left + gr.width / 2), Math.round(gr.top + gr.height / 2)) } : null,
        底部固定层: {
          composer: cp, composer_css: cs('#composer'),
          keybar: kb, keybar_css: cs('#keybar'),
          chrome顶: chromeTop === 1e9 ? null : chromeTop,
          安全区变量: { safe_b: getComputedStyle(document.documentElement).getPropertyValue('--safe-b').trim(), composer_h: getComputedStyle(document.documentElement).getPropertyValue('--composer-h').trim(), keybar_h: getComputedStyle(document.documentElement).getPropertyValue('--keybar-h').trim() }
        },
        重叠: (lr && chromeTop !== 1e9) ? Math.max(0, Math.round(lr.bottom - chromeTop)) : null,
        视口内可见的卡: cards.filter((c) => { const r = c.getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top >= 0; }).length
      };
    });

    /* ① tester 读数复刻：他们在「没滚到底」的位置量到最后一卡 y=588 */
    out.a_初始位置 = await R();
    await page.evaluate(() => { const pb = document.querySelector('.panel-body'); pb.scrollTop = Math.max(0, pb.scrollHeight - pb.clientHeight - 0); });
    await page.waitForTimeout(400);
    /* ② 滚到底（真的滚到 scrollTop 上限） */
    out.b_滚到底 = await R();
    /* ③ 再确认一次：把最后一张卡 scrollIntoView 后它能不能完整可见可点 */
    out.c_scrollIntoView最后一张卡 = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tk-rolecard')];
      const last = cards[cards.length - 1];
      last.scrollIntoView({ block: 'nearest' });
      const r = last.getBoundingClientRect();
      const e = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { y: Math.round(r.top), bottom: Math.round(r.bottom), 视口高: window.innerHeight,
        中心命中: e ? ((e.tagName || '') + '.' + ((e.className || '').toString().split(' ')[0] || '')).slice(0, 30) : 'null',
        命中是自己或后代: e ? (e === last || last.contains(e)) : false };
    });
    return out;
  }
};
