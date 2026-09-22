/* 设备上读"这一版是什么"（说明书里「怎么确认装的是这一版」的判据）：
 *   读页面 HP.BUILD / HP.BUILDINFO（打包时由 assets/build-info.json 盖进来）+ 设置面板那张卡的原话。
 * 只读，不发任何输入。
 */
export default {
  name: '设备上读构建版本',
  check: async (page) => {
    const out = {};
    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      await HP.App.openBoard('settings');
    });
    await page.waitForTimeout(700);
    out.设备上读到的 = await page.evaluate(() => ({
      BUILD: HP.BUILD,
      BUILDINFO: HP.BUILDINFO || null,
      '设置面板': (() => {
        const 卡 = [...document.querySelectorAll('.card')].find((c) => /构建版本/.test(c.textContent));
        return 卡 ? 卡.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) : null;
      })(),
      '原生通道': HP.hasNative()
    }));
    out.结论 = {
      '设备上的版本串非空': !!out.设备上读到的.BUILD && out.设备上读到的.BUILD !== 'undefined',
      '设备上能读到打包信息': !!out.设备上读到的.BUILDINFO && !!out.设备上读到的.BUILDINFO.testVersion,
      设置面板里看得见构建版本:
        !!out.设备上读到的.设置面板 && out.设备上读到的.设置面板.indexOf(out.设备上读到的.BUILD) >= 0,
      '走的是原生 SSH 通道': out.设备上读到的.原生通道 === true
    };
    return out;
  }
};
