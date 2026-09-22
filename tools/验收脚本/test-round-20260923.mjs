/* 测试轮驱动（2026-09-23）：pocket 面板只做「不需要连主机就能读回来」的那几条，
 * 连主机才能点的四条（信息窗 / 气泡 / 删会话 / 切会话）在结论里如实标「等放行」，不装样子。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/test-round-20260923.mjs
 * 结论口径：每一条都是页面里读回来的值（DOM 原文 / 样式 / 类名），不是看界面像不像。
 */
export default {
  name: 'hermes-pocket-测试轮-20260923',
  check: async (page) => {
    const out = {};

    /* ① 版本串对账：页面 HP.BUILD + 包内 build-info.json + 设置页「构建版本」那一行 */
    out.versionChain = await page.evaluate(async () => {
      const pageBuild = window.HP && HP.BUILD ? HP.BUILD : null;
      const info = (window.HP && HP.BUILDINFO) || null;
      if (HP.App && HP.App.openBoard) {
        HP.App.sessionId = 'probe'; HP.App.state = 'connected';
        await HP.App.openBoard('settings');
        await new Promise((r) => setTimeout(r, 700));
      }
      const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.indexOf('构建版本') >= 0);
      return {
        pageBuild,
        infoTestVersion: info ? info.testVersion : null,
        infoBuiltAt: info ? info.builtAt : null,
        settingsLine: card ? card.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null
      };
    });

    /* ② 频道页（不需要主机）：渲染出来了吗、降级文案是否如实、有没有未捕获异常 */
    out.talkBoard = await page.evaluate(async () => {
      const r = HP.App.showBoard('talk');
      await new Promise((s) => setTimeout(s, 2500));
      const pg = document.getElementById('tab-talk');
      return {
        showBoard: r,
        tabOn: (document.querySelector('.tabpage.on') || {}).id || null,
        roleRows: document.querySelectorAll('#tab-talk [data-testid="talk-role"]').length,
        text: pg ? pg.textContent.replace(/\s+/g, ' ').trim().slice(0, 240) : null,
        saylineExists: !!document.getElementById('tk-sayline'),
        chipsExists: !!document.getElementById('tk-saychips')
      };
    });

    /* ③ 开左栏要收起「会话专属的键」（本轮改动）：读样式前 → 真手指点 ☰ → 读样式后 → 点遮罩收起 → 再读 */
    const readKeys = () => page.evaluate(() => {
      const g = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : null; };
      const dw = document.getElementById('drawer');
      return {
        sayline: g('tk-sayline'), saychips: g('tk-saychips'),
        bodyDrawerOpen: document.body.classList.contains('drawer-open'),
        drawerHasShow: !!(dw && dw.classList.contains('show'))
      };
    });
    out.keysBefore = await readKeys();
    const panelBtn = await page.evaluate(() => {
      const e = document.getElementById('btn-panel');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
    });
    out.drawerBtnRect = panelBtn;
    if (panelBtn && panelBtn.w > 0) { await page.tap(panelBtn.x, panelBtn.y); await page.waitForTimeout(500); }
    out.keysWhileDrawerOpen = await readKeys();
    out.drawerEntries = await page.evaluate(() => [...document.querySelectorAll('#drawer [data-testid], #drawer .dr-item, #drawer button')]
      .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12));
    const scrim = await page.evaluate(() => {
      const e = document.getElementById('drawer-scrim');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width - 6), y: Math.round(r.y + r.height - 6) };
    });
    if (scrim) { await page.tap(scrim.x, scrim.y); await page.waitForTimeout(500); }
    out.keysAfterClose = await readKeys();

    /* ④ 结论：这一轮不需要主机就能判的几条 */
    const v = out.versionChain, b = out.talkBoard;
    out.verdict = {
      buildLabelStale: !!(v.pageBuild && v.infoTestVersion && v.pageBuild === v.infoTestVersion && /20260921/.test(v.pageBuild)),
      versionCriteriaUsable: !!(v.pageBuild && v.infoBuiltAt && /2026-09-22 2[0-9]|2026-09-22 23|2026-09-23 0/.test(v.infoBuiltAt)),
      talkRendered: !!(b.tabOn === 'tab-talk' && b.text && b.text.length > 20),
      talkDegradeHonest: !!(b.text && /还没连接|连不上/.test(b.text)),
      drawerCollapsesSessionKeys: !!(out.keysWhileDrawerOpen.bodyDrawerOpen
        && out.keysWhileDrawerOpen.sayline === 'none'
        && out.keysWhileDrawerOpen.saychips === 'none'),
      closeRestoresSessionKeys: !!(out.keysAfterClose && !out.keysAfterClose.bodyDrawerOpen
        && out.keysAfterClose.sayline !== 'none' && out.keysAfterClose.saychips !== 'none')
    };
    return out;
  }
};
