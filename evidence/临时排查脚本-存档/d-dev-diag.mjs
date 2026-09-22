/* 查两件事：① 技能行 data-skill 到底存的是什么（读回的路径里怎么会有反斜杠）；② 终端里那 32 行到底是哪来的 */
export default {
  name: '真机·排查（技能路径 / 终端内容）',
  check: async (page) => {
    const out = {};
    await page.evaluate(() => HP.App.openBoard('hermes'));
    await page.waitForTimeout(4000);
    out.技能行 = await page.evaluate(() => {
      const el = document.getElementById('tab-hermes');
      const rows = [...el.querySelectorAll('[data-skill]')].slice(0, 3);
      return rows.map((r) => ({
        dataset: r.dataset.skill,
        字符串里的反斜杠数: (r.dataset.skill.match(/\\/g) || []).length,
        属性原文: r.getAttribute('data-skill'),
        name: r.dataset.name
      }));
    });
    out.esc的实现 = await page.evaluate(() => String(window.esc || (() => '')).slice(0, 300));
    out.Hermes解析出的第一条 = await page.evaluate(async () => {
      const info = await HP.App.rpc('hermes.info', {}, 20000);
      return info.skills ? info.skills[0] : info;
    });
    out.终端 = await page.evaluate(() => {
      const t = HP.App.term;
      if (!t || !t.buffer) return { 出错: '拿不到 term' };
      const b = t.buffer.active;
      const 行 = [];
      for (let i = 0; i < b.length; i++) {
        const l = b.getLine(i);
        行.push(l ? l.translateToString(true) : '');
      }
      return { 总行: b.length, 全部: 行 };
    });
    out.发送中的东西 = await page.evaluate(() => ({
      composerOpen: (document.getElementById('composer') || {}).className || '',
      composerText: ((document.getElementById('cinput') || {}).value || '').slice(0, 60),
      lastSent: (window.__hpLastSent || '').slice(0, 80),
      state: HP.App.state
    }));
    return out;
  }
};
