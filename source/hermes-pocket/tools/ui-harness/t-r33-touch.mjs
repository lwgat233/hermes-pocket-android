/* R-33 验收探针：触控目标 ≥44px（六处），以及「上沿/下沿都命中自己、不换行、无横向溢出」
 * 走真页面：进设置页量两个 .btn，进群聊栏目量 .tk-chip（投递台账/身份）、.tk-act（广播）、.tk-askin（输入框）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r33-touch.mjs
 */
export default {
  name: 'R-33 验收：六处触控目标 ≥44px + elementFromPoint 上下沿命中 + 不换行 + 无横向溢出',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    /* 每处量：高度、上下沿 elementFromPoint 是不是命中自己（或自己的后代）、有没有被文案挤到换行 */
    await page.evaluate(() => {
      window.__r33 = {
        measure(sel, label) {
          const el = document.querySelector(sel);
          if (!el) return { 处: label, 在: false };
          /* 先把它滚进视口：elementFromPoint 只认视口内的点，滚不到就一律 false（探针自己的坑） */
          const r0 = el.getBoundingClientRect();
          const needScroll = r0.top < 0 || r0.bottom > (window.innerHeight || 0);
          if (needScroll) el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const hit = (y) => {
            const t = document.elementFromPoint(cx, y);
            return !!(t && (t === el || el.contains(t) || t.contains(el)));
          };
          const cs = getComputedStyle(el);
          return {
            处: label, 在: true, 高: Math.round(r.height), 宽: Math.round(r.width),
            display: cs.display,
            上沿命中: hit(r.top + 1), 下沿命中: hit(r.bottom - 1), 中心命中: hit(r.top + r.height / 2),
            文案被裁: el.scrollWidth > el.clientWidth + 1,
            行数估算: Math.round(r.height / (parseFloat(cs.fontSize) * 1.5)) || 0
          };
        }
      };
    });

    /* ① 设置页两处 .btn（「看明细」「清理」）+ 横向溢出 */
    await page.evaluate(() => HP.App.openBoard('settings'));
    await page.waitForTimeout(700);
    out['①_设置页'] = await page.evaluate(() => ({
      看明细: window.__r33.measure('[data-store="detail"]', '设置页·看明细(.btn)'),
      清理: window.__r33.measure('[data-store="clean"]', '设置页·清理(.btn)')
    }));

    /* ② 群聊栏目：投递台账(.tk-chip)、广播键(.tk-act)、身份键(.tk-chip)、输入框(.tk-askin) */
    await page.evaluate(() => { HP.App.showBoard('group'); });
    await page.waitForTimeout(500);
    out['②_群聊'] = await page.evaluate(() => ({
      投递台账: window.__r33.measure('#tk-delivbtn', '群聊·投递台账(.tk-chip)'),
      广播键: window.__r33.measure('#tk-shoutok', '群聊·广播(.tk-act)'),
      身份键: window.__r33.measure('#tk-whosay2', '群聊·身份(.tk-chip)'),
      输入框: window.__r33.measure('#tk-shoutin', '群聊·输入框(.tk-askin)')
    }));

    /* ③ 不换行 / 无横向溢出：几行容器的宽度对账 + 文档级溢出 */
    out['③_排版'] = await page.evaluate(() => {
      const rowOf = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const box = el.closest('.tk-row, .tk-askline, .tk-acts, .btnrow');
        if (!box) return null;
        const kids = [...box.children].filter((c) => c.offsetHeight > 0);
        const maxKid = kids.length ? Math.max(...kids.map((c) => c.getBoundingClientRect().height)) : 0;
        return {
          容器高: Math.round(box.getBoundingClientRect().height),
          子元素最高: Math.round(maxKid),
          折行了: kids.length > 1 && Math.round(box.getBoundingClientRect().height) > Math.round(maxKid) + 20,
          横向溢出: box.scrollWidth > box.clientWidth + 1
        };
      };
      return {
        投递台账那一行: rowOf('#tk-delivbtn'),
        输入那一行: rowOf('#tk-shoutin'),
        广播那一行: rowOf('#tk-shoutok'),
        文档横向溢出: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        整页宽度: document.documentElement.clientWidth + ' / ' + document.documentElement.scrollWidth
      };
    });

    /* ④ 单聊页也量一遍（同一套 tk-* 样式复用） */
    await page.evaluate(async () => {
      HP.Talk.pullRoleOutput = () => { };
      HP.Talk.roles = [{ full_name: 'pipeline.tester', title: '测试者', scene: 'pipeline', online: true }];
      HP.App.showBoard('talk');                 /* 先切到 talk 栏目，单聊页画在 #tab-talk 里 */
      await new Promise((r) => setTimeout(r, 200));
      await HP.Talk.openRole('pipeline.tester');
    });
    await page.waitForTimeout(700);
    out['④_单聊'] = await page.evaluate(() => ({
      发送键: window.__r33.measure('#tk-sayok', '单聊·发送(.tk-act)'),
      身份键: window.__r33.measure('#tk-whosay', '单聊·身份(.tk-chip)'),
      输入框: window.__r33.measure('#tk-sayin', '单聊·输入框(.tk-askin)'),
      返回键: window.__r33.measure('[data-testid="talk-back"]', '单聊·返回(.tk-chip)')
    }));

    /* ⑤ 间距没动：量一排相邻键之间的 gap（应为 8px，本轮不许改排版） */
    out['⑤_间距'] = await page.evaluate(() => {
      const cs = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const box = el.closest('.tk-row, .tk-askline');
        return box ? getComputedStyle(box).gap : null;
      };
      return { 输入那一行gap: cs('#tk-sayin'), 群聊那一行gap: cs('#tk-shoutin') };
    });

    await page.waitForTimeout(200);
    out['⑥_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
