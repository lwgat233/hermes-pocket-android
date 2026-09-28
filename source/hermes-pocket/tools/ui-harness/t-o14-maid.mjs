/* O14 验收探针：会话页女仆显示成「本体 + 通道（+ 多余一份）」两/三行、固定顺序（本体在前）、
 * 其它角色不回归、0 报错、会话页常驻按键 ≤3、页面上没有新增说明类文案。
 * 喂的是平台新字段（canonical）之后的真形状读数（#14 本体 / #4 QQ 通道 / #13 平台误建残迹）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-o14-maid.mjs
 */
export default {
  name: 'O14 验收：会话页女仆＝本体 + 通道（固定顺序、余量标清楚）',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      window.__sess = { sessions: [
        /* 女仆三行（平台现状：本体 canonical=1；QQ 通道 canonical=0；roles:home-maid 残迹 canonical=0）——
         * 故意把「多余的一份」放在数组**最前面**，看排序会不会把本体挤到后面 */
        { id: 13, kind: 'role', name: 'home.maid', role: 'home.maid', tmux: 'roles:home-maid', hermes: null, canonical: 0, alive: true, last_used: 1790300000 },
        { id: 4, kind: 'role', name: '可爱女仆（奈奈）', role: 'home.maid', tmux: 'qqbot:3FDE0CB3E30CD63FC5C635B4C657C844', hermes: '20260924_220750_c33dc998', canonical: 0, alive: false, last_used: 1790258276 },
        { id: 14, kind: 'role', name: '奈奈（女仆本体）', role: 'home.maid', tmux: 'hermes:女仆本体', hermes: 'hermes.agent', canonical: 1, alive: true, last_used: 1790257000 },
        /* 其它角色：各一行，别被这轮改动碰坏 */
        { id: 10, kind: 'role', name: 'pipeline.author', role: 'pipeline.author', tmux: 'roles:pipeline-author', canonical: 0, alive: true, last_used: 1790257935 },
        { id: 8, kind: 'role', name: 'pipeline.renderer', role: 'pipeline.renderer', tmux: 'roles:pipeline-renderer', canonical: 0, alive: true, last_used: 1790257936 },
        { id: 5, kind: 'role', name: 'pipeline.tester', role: 'pipeline.tester', tmux: 'roles:pipeline-tester', canonical: 0, alive: true, last_used: 1790257938 },
        { id: 11, kind: 'role', name: 'research.investigator', role: 'research.investigator', tmux: 'roles:research-investigator', canonical: 0, alive: false, last_used: 1790257001 }
      ] };
      window.__roles = { channels: {}, scenes: [{ scene: 'all', roles: [
        { full_name: 'home.maid', name: 'maid', title: '可爱女仆（个人助手：管生活，把要紧的话中转给我）', online: true },
        { full_name: 'pipeline.author', name: 'author', title: '功能创造者', online: true },
        { full_name: 'pipeline.renderer', name: 'renderer', title: '渲染者', online: true },
        { full_name: 'pipeline.tester', name: 'tester', title: '测试者', online: true },
        { full_name: 'research.investigator', name: 'investigator', title: '调查者（调研与功能分析，不改代码）', online: false }
      ] }] };
      window.__tmuxRaw = 'roles__HP__6__HP__0__HP__1790257930__HP__1790257930\nhermes__HP__1__HP__0__HP__1790258565__HP__1789994328\n';
      window.__orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: window.__sess }) }), 10); return; }
        if (m && m.t === 'talk.roles') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: window.__roles }) }), 10); return; }
        return window.__orig(t);
      };
      HP.App.sessionId = HP.App.sessionId || 's1';
      HP.App.state = 'connected';
    });

    /* 进「设置→会话」页：把 tab-sessions 点亮再渲染 */
    await page.evaluate(async () => {
      document.getElementById('tab-sessions').classList.add('on');
      await HP.Panels.renderSessions(true);
    });
    await page.waitForTimeout(600);

    /* ① 逐行 DOM 原文（title / 右标 / sub / data-testid）+ 顺序 */
    out['01_逐行DOM原文'] = await page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const rows = [...el.querySelectorAll('.row-item')].map((r) => ({
        testid: r.getAttribute('data-testid'),
        title: (r.querySelector('.ri-t') || {}).textContent,
        right: (r.querySelector('.ri-r') || {}).textContent,
        sub: (r.querySelector('.ri-s') || {}).textContent
      }));
      return rows;
    });

    /* ② 女仆三条的顺序（本体 #14 在前、通道 #4 在后、多余 #13 最后） */
    out['02_女仆顺序'] = await page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const ids = [...el.querySelectorAll('.row-item')].map((r) => (r.querySelector('.ri-t') || {}).textContent);
      const idx = (n) => ids.findIndex((t) => String(t).indexOf('#' + n + ' ') === 0);
      return { 全部行首: ids, 本体内14: idx(14), 通道4: idx(4), 多余13: idx(13),
        '本体在通道前': idx(14) >= 0 && idx(4) >= 0 && idx(14) < idx(4),
        '多余在最后': idx(13) > idx(4) && idx(13) > idx(14) };
    });

    /* ③ #13 不再顶替本体：它的中心点命中的就是它自己那行（不是本体行），且行文标了「多余的一份」 */
    out['03_余量不抢位'] = await page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const r13 = el.querySelector('[data-testid="session-13"]');
      const r14 = el.querySelector('[data-testid="session-14"]');
      if (!r13 || !r14) return { error: '缺行', 有13: !!r13, 有14: !!r14 };
      r13.scrollIntoView({ block: 'center' });
      const b = r13.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const own = hit && hit.closest('[data-testid="session-13"]');
      const t14 = r14.getBoundingClientRect();
      return {
        点13中心命中自己: !!own,
        '13的行文': (r13.querySelector('.ri-t') || {}).textContent,
        '14的行文': (r14.querySelector('.ri-t') || {}).textContent,
        '13在上还是下': Math.round(b.top) > Math.round(t14.top) ? '在14下面' : '在14上面'
      };
    });

    /* ④ 其它角色不回归 + 会话页非行内文案 + 常驻按键数 */
    out['04_其它角色与按键'] = await page.evaluate(() => {
      const el = document.getElementById('tab-sessions');
      const rows = [...el.querySelectorAll('.row-item')].map((r) => ({
        t: (r.querySelector('.ri-t') || {}).textContent, r: (r.querySelector('.ri-r') || {}).textContent
      }));
      const others = rows.filter((x) => !/#(14|4|13|2)\s/.test(x.t));
      const nonRowText = [...el.children].filter((c) => !c.classList.contains('ui-list') && !c.classList.contains('row-item'))
        .map((c) => (c.textContent || '').trim()).filter(Boolean);
      const btns = [...el.querySelectorAll('button')].filter((b) => !b.closest('.row-item'));
      return {
        其它角色行: others,
        其它角色行数: others.length,
        非行内文案: nonRowText,
        常驻按键数: btns.length,
        常驻按键字: btns.map((b) => (b.textContent || '').trim()),
        行总数: rows.length
      };
    });

    out['05_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
