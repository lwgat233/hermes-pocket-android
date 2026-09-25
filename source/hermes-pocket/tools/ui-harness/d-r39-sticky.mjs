/* R-39 定位探针：单聊页 sticky 输入条 #tk-sayline 压住列表最后一条气泡。
 * 量：① sticky 条的定位方式/高度/bottom；② 滚到底时末条气泡下沿 vs sticky 条上沿的重叠 px；
 *     ③ 点末条气泡中心命中谁；④ 页面里到底有几个 #tk-sayin / .tk-askin（重复 id 那件事）；
 *     ⑤ 候选改法（只在页面里注入样式，工程文件不动）跑完三读数：滚到底 + scrollIntoView + elementFromPoint。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r39-sticky.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R40-定位-20260924/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const ROLES = read('roles-json.json');
const SESS = read('sessions-json.json');
const THREAD = JSON.parse(fs.readFileSync(path.resolve(HERE, '../../../../evidence/R37-定位-20260924/fixtures/thread-home.maid.json'), 'utf8'));

export default {
  name: 'R-39 定位：单聊 sticky 输入条压住末条气泡',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    await page.evaluate(({ ROLES, SESS, THREAD }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.thread') { setTimeout(() => reply(m._rid, THREAD), 3); return; }
        return orig(t);
      };
    }, { ROLES, SESS, THREAD });

    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); await HP.Talk.openRole('home.maid'); await new Promise((r) => setTimeout(r, 1200)); });

    const R = () => page.evaluate(() => {
      const cs = (sel) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e); const r = e.getBoundingClientRect(); return { position: c.position, bottom: c.bottom, zIndex: c.zIndex, height: Math.round(r.height), top: Math.round(r.top), bottomPx: Math.round(r.bottom), paddingBottom: c.paddingBottom, marginBottom: c.marginBottom }; };
      const pb = document.querySelector('.panel-body');
      const chat = document.querySelector('#tk-chat');
      const rows = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const last = rows[rows.length - 1];
      const line = document.querySelector('#tk-sayline');
      const hit = (x, y) => { const e = document.elementFromPoint(x, y); return e ? ((e.tagName || '') + '.' + ((e.className || '').toString().split(' ')[0] || '') + (e.id ? ('#' + e.id) : '')).slice(0, 34) : 'null'; };
      const lr = last ? last.getBoundingClientRect() : null;
      const nl = line ? line.getBoundingClientRect() : null;
      const cr = chat ? chat.getBoundingClientRect() : null;
      return {
        视口高: window.innerHeight,
        sticky条: cs('#tk-sayline'),
        聊天框: chat ? { top: Math.round(cr.top), bottom: Math.round(cr.bottom), clientHeight: chat.clientHeight, scrollHeight: chat.scrollHeight, scrollTop: Math.round(chat.scrollTop), 可滚到: Math.round(chat.scrollHeight - chat.clientHeight), CSS_maxHeight: getComputedStyle(chat).maxHeight, 内边距: getComputedStyle(chat).paddingBottom } : null,
        外层滚动: pb ? { rect: { top: Math.round(pb.getBoundingClientRect().top), bottom: Math.round(pb.getBoundingClientRect().bottom) }, scrollTop: Math.round(pb.scrollTop), 可滚到: Math.round(pb.scrollHeight - pb.clientHeight), 内边距底: getComputedStyle(pb).paddingBottom } : null,
        气泡数: rows.length,
        末条气泡: lr ? { top: Math.round(lr.top), bottom: Math.round(lr.bottom), 高: Math.round(lr.height), 文本: (last.innerText || '').replace(/\n+/g, ' ').slice(0, 24), 中心命中: hit(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2)), 下沿命中: hit(Math.round(lr.left + lr.width / 2), Math.round(lr.bottom) - 3) } : null,
        重叠px: (lr && nl) ? Math.max(0, Math.round(lr.bottom - nl.top)) : null,
        输入框清点: {
          tk_sayin个数: document.querySelectorAll('#tk-sayin').length,
          tk_sayin_类: (document.querySelector('#tk-sayin') || {}).className || null,
          tk_askin总数: document.querySelectorAll('.tk-askin').length,
          tk_sayline个数: document.querySelectorAll('#tk-sayline').length,
          页面里所有input的id类: [...document.querySelectorAll('#tab-talk input')].map((i) => (i.id || '(无id)') + '/' + (i.className || ''))
        }
      };
    });

    /* ① 现状：先量未滚到底，再滚到底（外层 .panel-body 滚到上限） */
    out.a_未滚到底 = await R();
    await page.evaluate(() => { const pb = document.querySelector('.panel-body'); pb.scrollTop = pb.scrollHeight; const c = document.querySelector('#tk-chat'); c.scrollTop = c.scrollHeight; });
    await page.waitForTimeout(400);
    out.b_滚到底 = await R();

    /* ② 末条气泡 scrollIntoView 后（用户实际会做的事） */
    out.c_scrollIntoView末条 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const last = rows[rows.length - 1];
      last.scrollIntoView({ block: 'nearest' });
      const r = last.getBoundingClientRect();
      const line = document.querySelector('#tk-sayline').getBoundingClientRect();
      const e = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return { 末条top: Math.round(r.top), 末条bottom: Math.round(r.bottom), 条top: Math.round(line.top), 重叠px: Math.max(0, Math.round(r.bottom - line.top)), 中心命中: e ? (e.tagName + '.' + (e.className || '').toString().split(' ')[0]) : 'null', 命中是自己或后代: !!(e && (e === last || last.contains(e))) };
    });

    /* ③ 候选改法乙（对症）：给**内层聊天框**补出 sticky 条高度，且**外层不滚**（用户手指只在气泡上滑的真实情形） */
    out.d_改法乙_内层补内边距 = await page.evaluate(async () => {
      const line = document.querySelector('#tk-sayline');
      const h = Math.round(line.getBoundingClientRect().height);
      const pb = document.querySelector('.panel-body');
      const chat = document.querySelector('#tk-chat');
      pb.scrollTop = 0;                       /* 外层不滚：这就是用户"滚到底"的实际状态 */
      chat.scrollTop = chat.scrollHeight;     /* 只滚内层到底 */
      const before = (() => {
        const rows = [...document.querySelectorAll('#tk-chat .tk-bub')];
        const last = rows[rows.length - 1];
        const lr = last.getBoundingClientRect(), nl = line.getBoundingClientRect();
        const e = document.elementFromPoint(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2));
        return { 末条bottom: Math.round(lr.bottom), 条top: Math.round(nl.top), 重叠px: Math.max(0, Math.round(lr.bottom - nl.top)), 中心命中: e ? (e.tagName + '.' + (e.className || '').toString().split(' ')[0]) : 'null' };
      })();
      await new Promise((r) => setTimeout(r, 200));
      const s = document.createElement('style');
      s.id = 'r39-fix-b';
      s.textContent = '#tk-chat { padding-bottom: calc(' + (h + 8) + 'px + var(--safe-b)) !important; }';
      document.head.appendChild(s);
      await new Promise((r) => setTimeout(r, 250));
      pb.scrollTop = 0;
      chat.scrollTop = chat.scrollHeight;
      await new Promise((r) => setTimeout(r, 350));
      const rows = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const last = rows[rows.length - 1];
      const lr = last.getBoundingClientRect(), nl = line.getBoundingClientRect();
      const e = document.elementFromPoint(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2));
      return {
        注入的样式: s.textContent, sticky条高: h, 改法前: before,
        改法后: {
          末条bottom: Math.round(lr.bottom), 条top: Math.round(nl.top),
          重叠px: Math.max(0, Math.round(lr.bottom - nl.top)),
          中心命中: e ? (e.tagName + '.' + (e.className || '').toString().split(' ')[0]) : 'null',
          命中是气泡本身: !!(e && (e === last || last.contains(e)))
        }
      };
    });

    /* ③b 对照：只给外层 .panel-body 补内边距（甲案），**外层不滚**时能不能救 */
    out.d2_甲案_外层补内边距 = await page.evaluate(async () => {
      const s = document.querySelector('#r39-fix-b'); if (s) s.remove();
      const line = document.querySelector('#tk-sayline');
      const h = Math.round(line.getBoundingClientRect().height);
      const st = document.createElement('style');
      st.id = 'r39-fix-a';
      st.textContent = '.panel-body { padding-bottom: calc(' + (h + 8) + 'px + var(--safe-b)) !important; }';
      document.head.appendChild(st);
      const pb = document.querySelector('.panel-body');
      const chat = document.querySelector('#tk-chat');
      pb.scrollTop = 0; chat.scrollTop = chat.scrollHeight;
      await new Promise((r) => setTimeout(r, 400));
      const rows = [...document.querySelectorAll('#tk-chat .tk-bub')];
      const last = rows[rows.length - 1];
      const lr = last.getBoundingClientRect(); const nl = line.getBoundingClientRect();
      const e = document.elementFromPoint(Math.round(lr.left + lr.width / 2), Math.round(lr.top + lr.height / 2));
      return { 注入的样式: st.textContent, 外层不滚时_重叠px: Math.max(0, Math.round(lr.bottom - nl.top)),
        中心命中: e ? (e.tagName + '.' + (e.className || '').toString().split(' ')[0]) : 'null' };
    });

    out.e_源码位置 = {
      'sticky 条创建': 'talk.js:1113-1125（line.id="tk-sayline"，line.style.position="sticky"，bottom=0，背景 #0f1218）',
      '单聊输入框': 'talk.js:1129（inp.id="tk-sayin"）',
      '聊天框': 'talk.js:1040-1048（#tk-chat：maxHeight 48vh、overflowY auto、overflowAnchor none）',
      'DOM 顺序': 'render() talk.js:373-375：先 paintRole（bar→head→#tk-chat→chips→#tk-sayline），**再 paintSends(el)** ⇒ 粘性条后面还有内容（发送状态行），这就是"滚到底仍被压"的原因',
      '外层滚动容器': '.panel-body（style.css:223，padding-bottom 24px）'
    };
    return out;
  }
};
