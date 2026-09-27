/* R-33 复测 · 第一段：量「真机真触摸」要点的坐标（含 px/dp、上/下沿），并把设备像素坐标算好交给 shell 去 adb input tap
 * 设备映射：WebView bounds [0,136][1080,2274]（uiautomator dump）；scale = 1080/innerWidth = 2138/innerHeight
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/r33-reprobe-coords-20260924.mjs
 */
export default {
  name: 'R33-复测-坐标段',
  check: async (page) => {
    const out = {};
    out.meta = await page.evaluate(() => ({ cssW: window.innerWidth, cssH: window.innerHeight, dpr: window.devicePixelRatio, webview: { x: 0, y: 136, w: 1080, h: 2138 } }));

    const collect = (sel, label) => page.evaluate((a) => {
      const el = document.querySelector(a.sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const inW = window.innerWidth, inH = window.innerHeight;
      const sx = 1080 / inW, sy = 2138 / inH, ox = 0, oy = 136;
      const cxp = Math.round(r.x + r.width / 2), cyp = Math.round(r.y + r.height / 2);
      const hit = document.elementFromPoint(cxp, cyp);
      const chromeIds = [['topbar', 'topbar'], ['keybar', 'keybar'], ['composer', 'composer']];
      const overlaps = chromeIds.filter((c) => { const b = document.getElementById(c[0]); if (!b) return false; const br = b.getBoundingClientRect(); return !(br.width === 0 || br.height === 0) && br.bottom > r.top && br.top < r.bottom; }).map((c) => c[1]);
      return {
        label: a.label, sel: a.sel,
        px: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) },
        dp: { x: +(r.x).toFixed(1), y: +(r.y).toFixed(1), w: +(r.width).toFixed(1), h: +(r.height).toFixed(1) },
        deviceTap: { x: Math.round(r.x * sx + ox + (r.width / 2) * sx), y: Math.round(r.y * sy + oy + (r.height / 2) * sy) },
        hitIsSelf: !!(hit && (hit === el || el.contains(hit))), hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : null,
        overlapsChrome: overlaps, text: String(el.textContent).replace(/\s+/g, ' ').trim().slice(0, 24)
      };
    }, { sel: sel, label: label });

    /* 设置页：存储卡滚进可视区，量「看明细 / 清理」 */
    out.settings = await page.evaluate(async () => {
      HP.App.sessionId = 'probe'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
      await new Promise((r) => setTimeout(r, 1200));
      const card = [...document.querySelectorAll('#tab-settings .card')].filter((c) => /本地占用：/.test(c.textContent)).pop();
      const sc = card.closest('.panel-body');
      sc.scrollTop = card.getBoundingClientRect().top + sc.scrollTop - 200;
      await new Promise((r) => setTimeout(r, 400));
      const btns = [...card.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { t: String(b.textContent).trim(), y: Math.round(r.y), h: Math.round(r.height) }; });
      return { cardY: Math.round(card.getBoundingClientRect().y), buttons: btns, cardHead: card.textContent.replace(/\s+/g, ' ').trim().slice(0, 60), textLenBefore: card.textContent.replace(/\s+/g, ' ').trim().length };
    });
    out.tapDetail = await collect('[data-store="detail"]', '看明细键');
    out.tapClean = await collect('[data-store="clean"]', '清理键');

    /* 群聊：量「投递台账 / 广播 / 身份键 / 输入框」 */
    out.group = await page.evaluate(async () => {
      HP.App.showBoard('group');
      await new Promise((r) => setTimeout(r, 900));
      const page = document.getElementById('tab-group');
      const btns = [...page.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => String(b.textContent).trim().slice(0, 14));
      const chips = [...page.querySelectorAll('.tk-chip')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => String(b.textContent).trim().slice(0, 14));
      const deliv = document.getElementById('tk-delivbtn');
      const delivBefore = !!document.getElementById('tk-deliv');
      return { buttons: btns, chips: chips, delivOpenBefore: HP.Talk.delivOpen, delivBlockBefore: delivBefore, askline: !!document.querySelector('.tk-askline') };
    });
    out.tapDeliv = await collect('#tk-delivbtn', '投递台账键');
    out.tapShout = await collect('#tk-shoutok', '广播键');
    out.tapWho = await collect('#tk-whosay2', '身份键');
    out.tapIn = await collect('#tk-shoutin', '喊话输入框');
    return out;
  }
};
