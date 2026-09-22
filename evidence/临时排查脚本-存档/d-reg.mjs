/* 自检「没挂上」报了三行（系统提示词 / 模型 / 技能详情）—— 先分清是真没挂上，还是自检读 DOM 时那屏还没渲染。
 * 判据：把全部栏目都渲染一遍（并置成"已连接"，Hermes 那几行要连上才渲染）再跑 check()，对比两次读数。
 */
export default {
  name: 'debug: 登记表「没挂上」是真缺还是没渲染',
  check: async (page) => {
    const out = {};
    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
    });
    await page.waitForTimeout(200);
    out.只画了一部分 = await page.evaluate(() => HP.Registry.check().notMounted);

    await page.evaluate(async () => {
      for (const b of HP.Registry.boards.filter((x) => x.tab)) { try { await HP.App.openBoard(b.id); } catch (e) {} }
      HP.App.closePanel();
    });
    await page.waitForTimeout(600);
    out.全部画完 = await page.evaluate(() => HP.Registry.check());

    out.行到底在不在 = await page.evaluate(() => {
      const 板 = document.getElementById('tab-hermes');
      return {
        '有tab': !!板,
        remotePrompt: !!(板 && 板.querySelector('[data-testid="remote-prompt"]')),
        remoteModel: !!(板 && 板.querySelector('[data-testid="remote-model"]')),
        dataSkill: !!(板 && 板.querySelector('[data-skill]')),
        '板内前两行文本': 板 ? 板.textContent.replace(/\s+/g, ' ').slice(0, 160) : null
      };
    });
    out.结论 = {
      '全部渲染后没挂上是空的': (out.全部画完.notMounted || []).length === 0,
      '只画一部分时就报没挂上': out.只画了一部分.length > 0,
      '三行在 DOM 里其实都在': out.行到底在不在.remotePrompt && out.行到底在不在.remoteModel && out.行到底在不在.dataSkill,
      '没归属是空的': (out.全部画完.ungrouped || []).length === 0,
      '没测是空的': (out.全部画完.untested || []).length === 0
    };
    return out;
  }
};
