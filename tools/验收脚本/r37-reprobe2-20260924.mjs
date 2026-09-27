/* R-37 复测 · 补测段：滑动手势（上滑/下滑）与「滑完再点 / 点完再滑」
 * 上一版两个驱动瑕疵：① 直接在钉底位置向上滑 → scrollTop 本来就到顶，看不出动没动；
 * ② 复用 querySelector('.tk-bub.him')＝DOM 里第一条（早滚出屏幕），点到的不是可见气泡。
 * 本段修正：先记 scrollTop/上限，再**向下滑**（能真动），并且只点「当前在可视区内」的气泡。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r37-reprobe2-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const sh = (cmd) => execSync(`adb -s ${SERIAL} shell ${cmd}`, { stdio: 'ignore' });
const tap = (x, y) => sh(`input tap ${x} ${y}`);
const swipe = (x1, y1, x2, y2, ms) => sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`);

export default {
  name: 'R37-复测-补齐滑动手势',
  check: async (page) => {
    const out = {};
    await page.reload();
    await page.waitForTimeout(1800);
    await page.evaluate(async () => {
      const now = Math.floor(Date.now() / 1000);
      const items = [];
      for (let i = 0; i < 30; i++) items.push({ who: i % 2 ? 'me' : 'him', body: 'R37b-第' + i + '条', at: now - (30 - i) * 60 });
      HP.App.rpc = async (op) => {
        if (op === 'talk.roles') return { scenes: [{ scene: 'pipeline', roles: [{ full_name: 'pipeline.author', title: '功能创造者', online: true, state: 'running', channels: ['qqbot'] }] }], channels: { qqbot: 1 } };
        if (op === 'talk.since') return { messages: [], last: 0 };
        if (op === 'talk.asks') return { count: 0, asks: [] };
        if (op === 'talk.thread') return { items };
        return {};
      };
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      HP.App.showBoard('talk');
      await HP.Talk.openRole('pipeline.author');
      await new Promise((r) => setTimeout(r, 1600));
    });
    /* 取「当前在可视区里」的可见气泡 + 滚动读数（含上限，用来解释"没动"是不是因为钉到底） */
    const probe = () => page.evaluate(() => {
      const bs = [...document.querySelectorAll('.tk-bub')];
      const box = bs[0] ? (() => { let e = bs[0].parentElement; while (e && e.scrollHeight <= e.clientHeight) e = e.parentElement; return e; })() : null;
      const seen = bs.filter((b) => { const r = b.getBoundingClientRect(); return r.top > 40 && r.bottom < window.innerHeight - 120; });
      const pick = (cls) => { const c = seen.filter((b) => b.classList.contains(cls)); const el = c.length ? c[Math.floor(c.length / 2)] : null; if (!el) return null; const r = el.getBoundingClientRect(); return { css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, x: Math.round((r.x + r.width / 2) * (1080 / window.innerWidth)), y: Math.round(136 + (r.y + r.height / 2) * (2138 / window.innerHeight)) }; };
      return { scrollTop: box ? Math.round(box.scrollTop) : null, max: box ? box.scrollHeight - box.clientHeight : null, visible: seen.length, him: pick('him'), me: pick('me'), sheet: !!document.querySelector('.tk-sheetcard') };
    });
    try {
      out.atBottom = await probe();
      /* ① 向下滑 70px（内容往下走＝看更早的）→ 列表该真动 */
      const a = out.atBottom.him;
      const dy = Math.round(70 * (2138 / 778));
      swipe(a.x, a.y - Math.round(dy / 2), a.x, a.y + Math.round(dy / 2), 250);
      await page.waitForTimeout(900);
      out.swipeDown70 = await probe();
      /* ② 再向上滑 70px → 回到下面 */
      const b = out.swipeDown70.him;
      swipe(b.x, b.y + Math.round(dy / 2), b.x, b.y - Math.round(dy / 2), 250);
      await page.waitForTimeout(900);
      out.swipeUp70 = await probe();
      /* ③ 滑完再点：点可见的他说的气泡 → 应开窗 */
      const c = out.swipeUp70.him;
      tap(c.x, c.y);
      await page.waitForTimeout(900);
      out.tapAfterSwipe = await page.evaluate(() => ({ open: !!document.querySelector('.tk-sheetcard'), 全名: (() => { const d = document.querySelector('.tk-sheetcard'); if (!d) return null; const r = [...d.querySelectorAll('.tk-sheetrow')].find((x) => (x.querySelector('.tk-k') || {}).textContent === '全名'); return r ? r.querySelector('.tk-v').textContent : null; })() }));
      await page.evaluate(() => { try { HP.Talk.closeSheet(); } catch (e) {} });
      await page.waitForTimeout(400);
      /* ④ 点完再滑：先在可见气泡上滑 40px → 该滚动且不开窗 */
      const st0 = await probe();
      const d = st0.him;
      const dy40 = Math.round(40 * (2138 / 778));
      swipe(d.x, d.y - Math.round(dy40 / 2), d.x, d.y + Math.round(dy40 / 2), 220);
      await page.waitForTimeout(900);
      out.swipeAfterTap = await probe();
      /* ⑤ 小位移 20px：位移在守卫阈内测一次（20px > 8px 仍算滚动，不该开窗） */
      const e2 = out.swipeAfterTap.him;
      const dy20 = Math.round(20 * (2138 / 778));
      swipe(e2.x, e2.y - Math.round(dy20 / 2), e2.x, e2.y + Math.round(dy20 / 2), 200);
      await page.waitForTimeout(800);
      out.swipeDown20 = await probe();
    } catch (e) { out.__error = String((e && e.message) || e); }
    return out;
  }
};
