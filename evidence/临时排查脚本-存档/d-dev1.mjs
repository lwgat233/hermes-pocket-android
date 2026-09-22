/* 真机（模拟器）复验 第 1 批：跑的是不是这一版、页面有没有报错、登记表自检、各栏目真的渲染出来没有。
 * 注意：这里读的是**设备 WebView 里的真页面**（真原生桥、真 SSH 通道），不是本地测试台的假桥。
 */
export default {
  name: '真机·基础（版本 / 自检 / 各栏目）',
  check: async (page) => {
    const out = {};
    out.版本 = await page.evaluate(() => ({
      BUILD: HP.BUILD,
      PROTO: HP.PROTO,
      UA: navigator.userAgent.slice(0, 60),
      native: !!(window.HermesPocket && typeof window.HermesPocket.postMessage === 'function'),
      '通道': HP.App.transport ? HP.App.transport.name : null,
      BOOT: HP.BOOT || null
    }));
    out.自检_初 = await page.evaluate(() => HP.Registry.check());
    // 逐个栏目过一遍（自检读 DOM，没渲染过的栏目里那几行会被当成"没挂上"）
    for (const id of ['hosts', 'keys', 'settings', 'hermes', 'sessions', 'net']) {
      await page.evaluate((x) => HP.App.openBoard(x), id);
      await page.waitForTimeout(1200);
    }
    out.自检 = await page.evaluate(() => HP.Registry.check());
    out.栏目行数 = await page.evaluate(() => {
      const o = {};
      ['hosts', 'keys', 'settings', 'hermes', 'sessions', 'net'].forEach((t) => {
        const el = document.getElementById('tab-' + t);
        o[t] = { 行: el ? el.querySelectorAll('.row-item').length : -1, 文字长: el ? el.textContent.trim().length : -1 };
      });
      return o;
    });
    out.主机与密钥 = await page.evaluate(async () => {
      const hosts = await HP.App.rpcRaw('host.list').catch((e) => ({ err: String(e) }));
      const keys = await HP.App.rpcRaw('key.list').catch((e) => ({ err: String(e) }));
      return { 主机数: Array.isArray(hosts) ? hosts.length : hosts, 密钥数: Array.isArray(keys) ? keys.length : keys };
    });
    out.空转 = await page.evaluate(() => '好');
    return out;
  }
};
