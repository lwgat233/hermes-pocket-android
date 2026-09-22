/* 安全检查 + 排查：
 * ① 立刻把这个 App 从远端会话上**断开**（不能让它挂在我/用户正在用的 tmux 会话上）
 * ② 查 skill.read 的路径到底是谁加的转义（直接调一次，把原始回包和路径打印出来）
 */
export default {
  name: '真机·断开与排查',
  check: async (page) => {
    const out = {};
    out.断开前 = await page.evaluate(() => ({ state: HP.App.state, host: HP.App.host ? HP.App.host.host : null }));
    out.断开 = await page.evaluate(async () => {
      try { HP.App.disconnect ? HP.App.disconnect() : (HP.App.transport && HP.App.transport.close()); } catch (e) { return '抛错: ' + e.message; }
      await new Promise((r) => setTimeout(r, 1500));
      return { state: HP.App.state, sessionId: HP.App.sessionId };
    });
    out.断开后 = await page.evaluate(() => ({ state: HP.App.state, hasTransport: !!HP.App.transport }));

    /* skill.read 原样调一次，看路径 */
    out.直调skill读 = await page.evaluate(async () => {
      const 路径 = 'skills/hpk-verify-tmp/SKILL.md';
      let 回包 = null;
      try { 回包 = await HP.App.rpc('skill.read', { path: 路径 }, 20000); } catch (e) { 回包 = { 抛错: String(e.message) }; }
      const raw = 回包 && 回包.raw !== undefined ? 回包.raw : JSON.stringify(回包).slice(0, 300);
      return { 传的路径: 路径, 路径_json化: JSON.stringify(路径), 回包前160字: String(raw).slice(0, 160) };
    });
    return out;
  }
};
