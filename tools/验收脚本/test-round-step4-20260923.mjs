/* 测试轮第 4 步「复测」驱动（2026-09-23）：三处读数互相对账。
 *  ① 页面 HP.BUILD        ② 设置页「构建版本」那一行        ③ 终端横幅那行（app.js:2216 写进 term 的）
 * 与包内 assets/build-info.json 的值一起看（包内那份由 stamp-build.py 盖章，已在包外先对过）。
 * 跑法： node tools/ui-harness/dev-probe.mjs tools/验收脚本/test-round-step4-20260923.mjs
 */
export default {
  name: 'hermes-pocket-测试轮-第4步-复测-20260923',
  check: async (page) => {
    const out = {};

    /* ① 页面 HP.BUILD / ② 设置页「构建版本」那一行 */
    out.settings = await page.evaluate(async () => {
      if (HP.App && HP.App.openBoard) {
        HP.App.sessionId = 'probe'; HP.App.state = 'connected';
        await HP.App.openBoard('settings');
        await new Promise((r) => setTimeout(r, 800));
      }
      const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.indexOf('构建版本') >= 0);
      return {
        pageBuild: (window.HP && HP.BUILD) || null,
        infoTestVersion: (window.HP && HP.BUILDINFO) ? HP.BUILDINFO.testVersion : null,
        infoBuiltAt: (window.HP && HP.BUILDINFO) ? HP.BUILDINFO.builtAt : null,
        infoFeature: (window.HP && HP.BUILDINFO) ? HP.BUILDINFO.feature : null,
        settingsLine: card ? card.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) : null
      };
    });

    /* ③ 终端横幅：在 xterm 的缓冲里找写着 'Hermes Pocket' 的那一行原文 */
    out.terminalBanner = await page.evaluate(async () => {
      const t = HP.App && HP.App.term;
      if (!t || !t.buffer) return { found: false, why: '没有 xterm 实例' };
      const b = t.buffer.active;
      const lines = [];
      let joined = '';
      for (let i = 0; i < b.length; i += 1) {
        const row = b.getLine(i);
        if (!row) continue;
        const s = row.translateToString(true);
        if (s.indexOf('Hermes Pocket') >= 0) {
          lines.push({ row: i, text: s.trim().slice(0, 160) });
          /* 横幅比终端宽（48 列）会折行 —— 版本串可能被切到下一行，必须把后面两行接起来读 */
          for (let k = 1; k <= 2; k += 1) {
            const nx = b.getLine(i + k);
            if (nx) joined += nx.translateToString(true);
          }
          joined = s + joined;
        }
      }
      return { found: lines.length > 0, count: lines.length, lines: lines.slice(0, 3), joined: joined.slice(0, 200), bufferLines: b.length };
    });

    /* 结论：三处读数必须与包内 build-info.json 完全一致 */
    const s = out.settings;
    const bar = out.terminalBanner;
    const wantBuild = 'unified-20260923-012200';
    const wantBuilt = '2026-09-23 01:22 CST';
    out.verdict = {
      pageBuildEqualsPack: s.pageBuild === wantBuild,
      settingsLineHasBuild: !!(s.settingsLine && s.settingsLine.indexOf(wantBuild) >= 0),
      settingsLineHasBuiltAt: !!(s.settingsLine && s.settingsLine.indexOf(wantBuilt) >= 0),
      terminalBannerHasBuild: !!(bar.found && (bar.joined || '').indexOf(wantBuild) >= 0),
      infoEqualsPack: s.infoTestVersion === wantBuild && s.infoBuiltAt === wantBuilt,
      threePlacesAgree: s.pageBuild === s.infoTestVersion
        && !!(s.settingsLine && s.settingsLine.indexOf(wantBuild) >= 0)
        && !!(bar.found && (bar.joined || '').indexOf(wantBuild) >= 0)
    };
    return out;
  }
};
