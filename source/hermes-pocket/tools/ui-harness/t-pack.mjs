/* 打包这一轮的判据（「怎么确认装的是这一版」得有可读的判据，不能只靠文件名）：
 *   ① 界面上的版本串 == assets/build-info.json 里的 testVersion（两边真对账，不是各说各话）
 *   ② 设置面板里要看得见 构建版本 + 功能 + 打包时间（用户装上去第一眼就该读到）
 *   ③ 不许出现 undefined/NaN 这类"盖漏了"的痕迹
 *   ④ 终端横幅里写的版本串也是同一个
 * 这份 JSON 就是包里的那一份（下面用 node 直接读同一个文件）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* 读的就是源树里那一份（按本文件位置推：tools/ui-harness → app/src/main/assets）；要用别的树设 HP_JSON=… */
const jsonPath = process.env.HP_JSON
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../app/src/main/assets/build-info.json');
const info = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

export default {
  name: '打包信息：界面版本串与包内 build-info.json 对账',

  check: async (page) => {
    const out = {};
    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
    });
    await page.waitForTimeout(400);

    out.pageInfo = await page.evaluate(() => ({
      BUILD: HP.BUILD,
      BUILDINFO: HP.BUILDINFO || null,
      settingsCardText: (() => {
        const buildVersionLabel = '构建版本';
        const card = [...document.querySelectorAll('.card')].find((c) => c.textContent.includes(buildVersionLabel));
        return card ? card.textContent.replace(/\s+/g, ' ').trim() : null;
      })(),
      banner: (() => {                                // 终端第一行横幅里的版本串
        const t = HP.App.term;
        const lines = [];
        for (let i = 0; i < 3; i += 1) lines.push(t.buffer.active.getLine(i) ? t.buffer.active.getLine(i).translateToString(true) : '');
        // 版本串可能被 xterm 的换行拆到两行，这里**不带分隔符**拼回去再找（只用来查一个子串，不影响别的判据）
        return lines.join('').trim();
      })()
    }));
    out.bundleJson = info;

    const panelText = out.pageInfo.settingsCardText || '';
    out.verdict = {
      uiVersionMatchesBundle: out.pageInfo.BUILD === info.testVersion,
      injectedFeatureMatchesBundle: !!out.pageInfo.BUILDINFO && out.pageInfo.BUILDINFO.feature === info.feature
        && out.pageInfo.BUILDINFO.featureId === info.featureId,
      settingsShowsBuildVersion: panelText.indexOf(info.testVersion) >= 0,
      settingsShowsFeatureAndBuiltAt: panelText.indexOf(info.feature) >= 0 && panelText.indexOf(info.builtAt) >= 0,
      bannerUsesSameVersion: out.pageInfo.banner.indexOf(info.testVersion) >= 0,
      noMissingPlaceholders: !/undefined|NaN/.test(panelText) && !/undefined/.test(String(out.pageInfo.BUILD)),
      bundleJsonFieldsComplete: ['project', 'testVersion', 'feature', 'featureId', 'builtAt', 'packageId', 'entry']
        .every((k) => !!info[k])
    };
    return out;
  }
};
