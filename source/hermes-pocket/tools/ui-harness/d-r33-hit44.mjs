/* R-33（触控目标 <44dp）定位探针：量三处命中区现状 + **在页面里注入候选 CSS** 看能不能到 ≥44dp。
 * 只读不写：不改工程任何文件；样式只在浏览器里注入（跑完随页面一起丢）。
 * 真路径：HP.App.openBoard('settings')（设置页那两个按钮）、HP.App.showBoard('group')（群聊那行）
 * 视口对齐测试者设备：393×778（dpr 2.75，布局按 CSS px，与 dpr 无关）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r33-hit44.mjs
 */
export default {
  name: 'R-33 定位：三处触控目标的高度 + 候选 CSS 注入后能否 ≥44',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });

    const SEL = {
      设置页看明细: '[data-store="detail"]',
      设置页清理: '[data-store="clean"]',
      群聊喊话输入框: '#tk-shoutin',
      群聊广播键: '#tk-shoutok',
      群聊身份键: '#tk-whosay2',
      群聊投递台账键: '#tk-delivbtn'
    };

    /* 量一组目标：矩形 + 上下左右相邻是否被别的控件压住 + 边沿命中是不是自己 */
    const measure = async (label, anchor) => page.evaluate(({ SEL, label, anchor }) => {
      const anc = anchor && document.querySelector(anchor);
      if (anc) anc.scrollIntoView({ block: 'center' });
      const hit = (el, x, y) => {
        const e = document.elementFromPoint(x, y);
        if (!e) return 'null';
        if (e === el || el.contains(e)) return 'self';
        return (e.id || e.className || e.tagName).toString().slice(0, 28);
      };
      const rows = {};
      for (const [name, sel] of Object.entries(SEL)) {
        const el = document.querySelector(sel);
        if (!el) { rows[name] = { 缺失: true, 选择器: sel }; continue; }
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        rows[name] = {
          选择器: sel,
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
          上沿命中: hit(el, cx, Math.round(r.top) + 1),      // 上沿是不是也算这个控件
          下沿命中: hit(el, cx, Math.round(r.bottom) - 1),   // 下沿
          中心命中: hit(el, cx, Math.round(r.top + r.height / 2)),
          ge44: Math.round(r.height) >= 44,
          css_minHeight: getComputedStyle(el).minHeight,
          css_padding: getComputedStyle(el).padding,
          css_fontSize: getComputedStyle(el).fontSize
        };
      }
      // 相邻间距：同一容器里横向相邻的两个目标；纵向：台账键与它上面那一行
      const g = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      const a = g(SEL.设置页看明细), b = g(SEL.设置页清理);
      const c = g(SEL.群聊广播键), d = g(SEL.群聊身份键), i = g(SEL.群聊喊话输入框), k = g(SEL.群聊投递台账键);
      const askline = document.querySelector('.tk-askline');
      const wrapSetting = a && a.parentElement;
      return {
        视图: label,
        目标: rows,
        横向间距: {
          '看明细→清理': a && b ? Math.round(b.left - a.right) : null,
          '喊话输入框→广播键': i && c ? Math.round(c.left - i.right) : null,
          '广播键→身份键': c && d ? Math.round(d.left - c.right) : null
        },
        纵向间隙: {
          '喊话行底→台账键顶': askline && k ? Math.round(k.top - askline.bottom) : null
        },
        横向溢出: {
          '群聊喊话行_内容宽超过容器': askline ? askline.scrollWidth > askline.clientWidth : null,
          '设置页按钮行_内容宽超过容器': wrapSetting ? wrapSetting.scrollWidth > wrapSetting.clientWidth : null,
          '文档横向溢出': document.documentElement.scrollWidth > document.documentElement.clientWidth
        },
        文档高: document.documentElement.scrollHeight
      };
    }, { SEL, label, anchor });

    /* ① 进设置页（真路径）量现状 */
    await page.evaluate(() => HP.App.openBoard('settings'));
    await page.waitForTimeout(700);
    const before设置 = await measure('设置页-注入前', '[data-store="detail"]');

    /* ② 进群聊（真路径）量现状 */
    await page.evaluate(() => HP.App.showBoard('group'));
    await page.waitForTimeout(500);
    const before群聊 = await measure('群聊-注入前', '.tk-askline');

    /* ③ 注入候选 CSS（只在页面里，工程文件不动） */
    const injected = await page.evaluate(() => {
      const css = [
        '.btn { min-height: 44px; }',
        '.tk-chip { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }',
        '.tk-askin { min-height: 44px; box-sizing: border-box; }',
        '.tk-act { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; }'
      ].join('\n');
      const s = document.createElement('style');
      s.id = 'r33-probe';
      s.textContent = css;
      document.head.appendChild(s);
      return css;
    });
    await page.waitForTimeout(300);

    /* ④ 注入后复量两页 */
    const after群聊 = await measure('群聊-注入后', '.tk-askline');
    await page.evaluate(() => HP.App.openBoard('settings'));
    await page.waitForTimeout(600);
    const after设置 = await measure('设置页-注入后', '[data-store="detail"]');

    /* ⑤ 顺带：注入后能不能真点到（边沿 elementFromPoint 已经是自己了，这里再试点击触发） */
    await page.evaluate(() => HP.App.showBoard('group'));
    await page.waitForTimeout(400);
    const 点台账键 = await page.evaluate(() => {
      const el = document.querySelector('#tk-delivbtn');
      const r = el.getBoundingClientRect();
      const before = HP.Talk.delivOpen;
      const e = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.bottom) - 2);
      if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { 点前: before, 点后: HP.Talk.delivOpen, 下沿命中的是: (e && (e.id || e.className)) || 'null' };
    });

    return {
      注入的CSS: injected,
      注入前_设置页: before设置,
      注入前_群聊: before群聊,
      注入后_设置页: after设置,
      注入后_群聊: after群聊,
      点投递台账键下沿: 点台账键
    };
  }
};
