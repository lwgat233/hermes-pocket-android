/* R-33 复测 · 真机真触摸段：坐标由页面量 → 交给 `adb shell input tap`（系统触摸链路，不是注入事件）→ 再回页面读效果
 * 设备映射：WebView [0,136][1080,2274]，scale = 1080/innerWidth = 2138/innerHeight（uiautomator dump 实测）
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r33-reprobe-taps-20260924.mjs
 */
import { execSync } from 'node:child_process';
const SERIAL = process.env.ADB_SERIAL || 'emulator-5554';
const realTap = (x, y) => { execSync(`adb -s ${SERIAL} shell input tap ${x} ${y}`, { stdio: 'ignore' }); return { tap: `adb shell input tap ${x} ${y}` }; };

export default {
  name: 'R33-复测-真触摸段',
  check: async (page) => {
    const out = {};
    const deviceCoords = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const sx = 1080 / window.innerWidth, sy = 2138 / window.innerHeight;
      return { x: Math.round((r.x + r.width / 2) * sx), y: Math.round(136 + (r.y + r.height / 2) * sy), css: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
    }, sel);

    /* A 设置页：真触摸「看明细」→ 明细真出来了吗 */
    await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1200));
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      const sc = card.closest('.panel-body'); sc.scrollTop = card.getBoundingClientRect().top + sc.scrollTop - 200;
      await new Promise((r) => setTimeout(r, 400));
    });
    out.detailBefore = await page.evaluate(() => { const c = [...document.querySelectorAll('#tab-settings .card')].filter((x) => /本地占用：/.test(x.textContent)).pop(); return { len: c.textContent.replace(/\s+/g, ' ').trim().length, head: c.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) }; });
    const dc1 = await deviceCoords('[data-store="detail"]');
    out.detailTap = { ...dc1, ...realTap(dc1.x, dc1.y) };
    await page.waitForTimeout(900);
    out.detailAfter = await page.evaluate(() => { const c = [...document.querySelectorAll('#tab-settings .card')].filter((x) => /本地占用：/.test(x.textContent)).pop(); const t = c.textContent.replace(/\s+/g, ' ').trim(); return { len: t.length, hasKeyKB: /[a-z][a-z0-9._-]*\.?[a-z0-9._-]*\s*[0-9.]+KB/.test(t), sample: t.slice(0, 120) }; });

    /* B 设置页：真触摸「清理」→ 真弹出确认了吗
     * 说明：如果 App 走的是 window.confirm（native 对话框），页面会被阻塞住 —— 所以**先装一个只观察不拦业务**的钩子：
     * 记下被调用与文案，然后放行（返回 false = 不真删，避免真清缓存）。tap 本身仍是系统触摸。 */
    await page.evaluate(() => {
      window.__confirmSeen = false; window.__confirmMsg = null;
      const orig = window.confirm;
      window.confirm = function (m) { window.__confirmSeen = true; window.__confirmMsg = String(m || ''); return false; };
      window.__origConfirm = orig;
    });
    const dc2 = await deviceCoords('[data-store="clean"]');
    out.cleanTap = { ...dc2, ...realTap(dc2.x, dc2.y) };
    await page.waitForTimeout(900);
    out.cleanAfter = await page.evaluate(() => {
      const modal = [...document.querySelectorAll('.modal, .sheet, #modal, #sheet, [role="dialog"]')].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
      const btns = [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0 && /取消|确定|删除|清空|是的/.test(b.textContent)).map((b) => String(b.textContent).trim());
      return { confirmSeen: window.__confirmSeen === true, confirmMsg: window.__confirmMsg, modalTexts: modal, confirmButtons: btns, restored: (window.confirm = window.__origConfirm, true) };
    });

    /* C 群聊：真触摸「投递台账 / 身份键 / 输入框 / 广播」 */
    await page.evaluate(async () => { HP.App.showBoard('group'); await new Promise((r) => setTimeout(r, 900)); });
    out.delivBefore = await page.evaluate(() => ({ open: !!HP.Talk.delivOpen, block: !!document.getElementById('tk-deliv') }));
    const dc3 = await deviceCoords('#tk-delivbtn');
    out.delivTap = { ...dc3, ...realTap(dc3.x, dc3.y) };
    await page.waitForTimeout(900);
    out.delivAfter = await page.evaluate(() => {
      const b = document.getElementById('tk-deliv');
      return { open: !!HP.Talk.delivOpen, blockExists: !!b, blockText: b ? b.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : null, blockH: b ? Math.round(b.getBoundingClientRect().height) : 0 };
    });

    const dc4 = await deviceCoords('#tk-whosay2');
    out.whoBefore = await page.evaluate(() => String(document.getElementById('tk-whosay2').textContent).trim());
    out.whoTap = { ...dc4, ...realTap(dc4.x, dc4.y) };
    await page.waitForTimeout(700);
    out.whoAfter = await page.evaluate(() => ({ text: String(document.getElementById('tk-whosay2').textContent).trim(), asWho: HP.Talk.asWho }));

    /* 先点输入框（真触摸）→ 看焦点；再用 adb 输入文字 → 点广播（真触摸）→ 看有没有真触发发送 */
    const dc5 = await deviceCoords('#tk-shoutin');
    out.inputTap = { ...dc5, ...realTap(dc5.x, dc5.y) };
    await page.waitForTimeout(600);
    out.inputFocus = await page.evaluate(() => { const a = document.activeElement; return { tag: a ? a.tagName : null, id: a ? a.id : null, isShout: a && a.id === 'tk-shoutin' }; });
    execSync(`adb -s ${SERIAL} shell input text "R33shout"`, { stdio: 'ignore' });
    await page.waitForTimeout(500);
    out.inputValue = await page.evaluate(() => document.getElementById('tk-shoutin').value);
    const dc6 = await deviceCoords('#tk-shoutok');
    out.shoutTap = { ...dc6, ...realTap(dc6.x, dc6.y) };
    await page.waitForTimeout(1500);
    out.shoutAfter = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')].map((r) => ({ state: r.getAttribute('data-state'), text: (r.querySelector('.tk-sendtext') || {}).textContent || '' }));
      const toast = [...document.querySelectorAll('.toast, #toast')].filter((t) => t.getBoundingClientRect().height > 0).map((t) => t.textContent.trim().slice(0, 40));
      return { sendRows: rows, toast: toast, inputValueAfter: document.getElementById('tk-shoutin') ? document.getElementById('tk-shoutin').value : null };
    });
    /* 常驻按键清点（真可见的按钮/胶囊） */
    out.groupChrome = await page.evaluate(() => {
      const page = document.getElementById('tab-group');
      const vis = [...page.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0);
      return { count: vis.length, labels: vis.map((b) => String(b.textContent).trim().slice(0, 12)) };
    });

    return out;
  }
};
