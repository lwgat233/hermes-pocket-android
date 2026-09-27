/* R-40 验收探针：单聊/信息窗/卡片 #id、会话页换人、按 tmux 去重、未起会话不显号、缺陷③（scenes 展平）
 * 走真页面真渲染；数据喂**真 fixtures 的读数**（sessions-json / roles-json / tmux-list）。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r40-sessid.mjs
 */
export default {
  name: 'R-40 验收：会话编号（#id）在卡片/信息窗/会话页/上次聊过一致，去重与不造号',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    await page.evaluate(() => {
      /* 真 fixtures：talk.sessions（含「同 tmux 重复」与「同 role 不同 tmux 的废条目」两种坑） */
      window.__r40SESS = { sessions: [
        { id: 2, kind: 'solo', name: 'solo-solo1790081404', role: null, tmux: 'solo-solo1790081404', alive: false, last_used: 1790081404 },
        { id: 4, kind: 'role', name: '可爱女仆（奈奈）', role: 'home.maid', tmux: 'qqbot:3FDE0CB3E30CD63FC5C635B4C657C844', alive: false, last_used: 1790258276 },
        { id: 5, kind: 'role', name: 'pipeline.tester', role: 'pipeline.tester', tmux: 'roles:pipeline-tester', alive: true, last_used: 1790257938 },
        { id: 6, kind: 'role', name: 'owner.me', role: 'owner.me', tmux: 'roles:owner-me', alive: true, last_used: 1790257930 },
        { id: 10, kind: 'role', name: 'pipeline.author', role: 'pipeline.author', tmux: 'roles:pipeline-author', alive: true, last_used: 1790257935 },
        { id: 99, kind: 'role', name: 'pipeline.tester（老快照）', role: 'pipeline.tester', tmux: 'roles:pipeline-tester', alive: false, last_used: 100 },
        { id: 3, kind: 'role', name: 'pipeline.tester（旧）', role: 'pipeline.tester', tmux: 'role-pipeline-tester', alive: false, last_used: 50 }
      ] };
      window.__r40ROLES = { channels: {}, scenes: [
        { scene: 'home', roles: [{ full_name: 'home.maid', name: 'maid', title: '可爱女仆（个人助手：管生活，把要紧的话中转给我）', online: false, state: 'paused' }] },
        { scene: 'owner', roles: [{ full_name: 'owner.me', name: 'me', title: '经理（管流程/派活/判报告；不是本人）', online: true }] },
        { scene: 'pipeline', roles: [
          { full_name: 'pipeline.tester', name: 'tester', title: '测试者', online: true },
          { full_name: 'pipeline.author', name: 'author', title: '功能创造者', online: true },
          { full_name: 'research.investigator', name: 'investigator', title: '调查者（调研与功能分析，不改代码）', online: false }
        ] }
      ] };
      window.__tmuxRaw = 'roles__HP__6__HP__0__HP__1790257930__HP__1790257930\nhermes__HP__1__HP__0__HP__1790258565__HP__1789994328\n';
      window.__r40Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m) { window.__lastRid = m._rid; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: window.__r40SESS }) }), 10); return; }
        if (m && m.t === 'talk.roles') {
          const d = (window.__r40Mode === 'empty') ? { channels: {}, scenes: [] } : window.__r40ROLES;
          setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: d }) }), 10);
          return;
        }
        return window.__r40Orig(t);
      };
      HP.App.showBoard('talk');
    });
    await page.waitForTimeout(900);

    /* ① 角色卡副行：#<id> · <真实窗口名>；通道型按本人叫法；没会话 ⇒ 名字 + 未起会话（不显号） */
    out['01_卡片副行'] = await page.evaluate(() => {
      const subs = [...document.querySelectorAll('.sub')].map((d) => d.textContent.trim());
      return {
        owner: subs.filter((s) => s.indexOf('#6') === 0),
        maid: subs.filter((s) => s.indexOf('#4') === 0),
        noSess: subs.filter((s) => s.indexOf('research.investigator') === 0),
        stillRoleName: subs.some((s) => s.indexOf('role-') >= 0)
      };
    });

    /* ② 信息窗「会话」行：与卡片同号同人；没会话那条不显号 */
    await page.evaluate(() => HP.Talk.openRoleSheet('owner.me'));
    out['02_信息窗_有会话'] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#tk-sheet .tk-sheetrow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim());
      return rows.filter((r) => r.indexOf('会话') === 0 || r.indexOf('全名') === 0);
    });
    await page.evaluate(() => HP.Talk.openRoleSheet('research.investigator'));
    out['03_信息窗_没会话'] = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#tk-sheet .tk-sheetrow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim());
      return { row: rows.filter((r) => r.indexOf('会话') === 0), hasHash: rows.some((r) => /#\d/.test(r)) };
    });

    /* ③ 频道页「上次聊过」：行首 #<id>；缺陷③ 修好 ⇒「在线 / 没在线」分组真的出现 */
    out['04_上次聊过'] = await page.evaluate(() => {
      const pg = document.getElementById('tab-talk');
      const rows = [...pg.querySelectorAll('[data-testid="talk-sessrow"]')].map((d) => d.textContent.trim());
      const groups = [...pg.querySelectorAll('[data-testid="talk-group"]')].map((d) => d.textContent.trim());
      return {
        groups: groups,
        numbered: rows.filter((r) => /^#\d/.test(r)),
        hasOnlineGroup: groups.some((g) => g.indexOf('在线') === 0),
        hasOfflineGroup: groups.some((g) => g.indexOf('没在线') === 0)
      };
    });

    /* ④ ⑤会话页：换成「人/通道」，行首 #<id> 身份；容器不成行；同 tmux 只出一条；废的标已废 */
    out['05_会话页'] = await page.evaluate(async () => {
      HP.App.sessionId = HP.App.sessionId || 's1';        /* 测试台默认没建会话；会话页要求「已连接」 */
      HP.App.state = 'connected';
      document.getElementById('tab-sessions').classList.add('on');
      await HP.Panels.renderSessions(true);
      const el = document.getElementById('tab-sessions');
      const titles = [...el.querySelectorAll('.ri-t')].map((d) => d.textContent.trim());
      const subs = [...el.querySelectorAll('.ri-s')].map((d) => d.textContent.trim());
      const heads = [...el.querySelectorAll('.ui-status')].map((d) => d.textContent.trim());
      return {
        titles: titles,
        hasContainerRow: titles.some((t) => /^\s*(roles|hermes)\s*$/.test(t)),
        hasOldSnapshot: titles.some((t) => t.indexOf('#99') >= 0),
        testerRows: titles.filter((t) => t.indexOf('测试者') >= 0),
        numberedCount: titles.filter((t) => /^#\d/.test(t)).length,
        groups: heads.filter((h) => h.indexOf('（') > 0),
        sampleSub: subs[0]
      };
    });

    /* ⑥ 弹窗：真点行 → 弹窗显示 #id 与身份；动作目标按「人」给（删＝角色分支，只杀他的窗口） */
    out['06_会话弹窗'] = await page.evaluate(async () => {
      const el = document.getElementById('tab-sessions');
      const clickRow = (hash) => {
        const r = [...el.querySelectorAll('.row-item')].find((x) => /^#\d/.test(((x.querySelector('.ri-t') || {}).textContent || '')) &&
          ((x.querySelector('.ri-t') || {}).textContent || '').indexOf(hash) >= 0);
        if (r) r.click();
        const t = document.querySelector('#tk-sess-sheet [data-testid="sess-sheet-title"]');
        return t ? t.textContent.trim() : '';
      };
      const maid = clickRow('#4');
      const other = clickRow('#6');
      const hasDel = !!document.querySelector('#tk-sess-del');
      const w = document.getElementById('tk-sess-sheet');
      if (w) w.remove();
      return { maidSheet: maid, ownerSheet: other, hasDel: hasDel };
    });

    /* ⑦ 修正①②：女仆那条＝固定标签「女仆（本人通道）」、恒在线、标「QQ 通道」、不标「已废」 */
    out['07_女仆与通道'] = await page.evaluate(async () => {
      await HP.Panels.renderSessions(true);
      const el = document.getElementById('tab-sessions');
      const rows = [];
      let group = '';
      [...el.children].forEach((c) => {
        if (c.className.indexOf('ui-status') >= 0) group = c.textContent.trim();
        if (c.className.indexOf('ui-list') >= 0) {
          [...c.querySelectorAll('.row-item')].forEach((r) => rows.push({
            group: group,
            title: (r.querySelector('.ri-t') || {}).textContent,
            right: (r.querySelector('.ri-r') || {}).textContent,
            sub: (r.querySelector('.ri-s') || {}).textContent
          }));
        }
      });
      const maid = rows.find((r) => /^#4\b/.test(r.title)) || {};
      const tester = rows.find((r) => /^#5\b/.test(r.title)) || {};
      return { 女仆行: maid, 测试者行: tester, 行数: rows.length, 分组: rows.map((r) => r.group).filter((v, i, a) => a.indexOf(v) === i) };
    });

    /* ⑧ 修正③：roles 还没到位 ⇒ 只显「（加载中）」；roles 到位必须替换（不许停在退化态） */
    out['08_退化态与替换'] = await page.evaluate(async () => {
      const sessStub = window.HermesPocket.postMessage;
      const rolesEmpty = () => setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: window.__lastRid, ok: true, data: { channels: {}, scenes: [] } }) }), 5);
      /* 拦一次 talk.roles，回空 scenes（模拟 roles 还没到位） */
      window.__r40Mode = 'empty';
      HP.Talk.roles = [];
      await HP.Panels.renderSessions(true);
      const el = document.getElementById('tab-sessions');
      const titlesLoading = [...el.querySelectorAll('.ri-t')].map((d) => d.textContent.trim());
      /* 换成真 roles，再渲染一次 */
      window.__r40Mode = 'real';
      HP.Talk.roles = [];
      await HP.Panels.renderSessions(true);
      const titlesReal = [...el.querySelectorAll('.ri-t')].map((d) => d.textContent.trim());
      return {
        退化态显示的: titlesLoading,
        到位的: titlesReal,
        平台name还露着吗: titlesLoading.some((t) => /pipeline\.|owner\.me|home\.maid/.test(t))
      };
    });

    out['07_报错'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
