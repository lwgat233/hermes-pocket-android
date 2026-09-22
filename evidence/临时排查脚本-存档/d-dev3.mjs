/* 真机复验 第 3 批：M3/M4 的新功能在**真设备 + 真远端**上跑一遍。
 * 每一步包一层 try/catch（真机上会慢、会有元素还没渲染的时候），某一步失败不影响后面的读数 ——
 * 验收跑一次要尽量拿到完整的证据，而不是第一条断言就把整轮掀了。
 */
const 关小窗 = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));
const 窗数 = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length);
const 等小窗 = async (page, ms = 12000) => {
  for (let i = 0; i < ms / 500; i++) {
    if (await 窗数(page)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const 等元素 = async (page, sel, ms = 12000) => {
  for (let i = 0; i < ms / 500; i++) {
    if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const 点 = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return false;
  e.click();
  return true;
}, sel);
const 小窗读 = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return null;
  const 取 = (s) => { const e = d.querySelector(s); return e ? e.textContent : ''; };
  const 字段列表 = () => {
    const 出 = [];
    d.querySelectorAll('.sheet-body .field').forEach((f) => {
      const lab = f.querySelector('label');
      const inp = f.querySelector('input') || f.querySelector('textarea');
      const val = f.querySelector('.val');
      出.push({
        label: lab ? lab.textContent : '',
        '值': inp ? inp.value : (val ? val.textContent : '')
      });
    });
    return 出;
  };
  return {
    '抬头': 取('.sheet-t'),
    '字段': 字段列表(),
    '有正文': !!d.querySelector('.sheet-pre'),
    '正文开头': (d.querySelector('.sheet-pre') || {}).textContent ? (d.querySelector('.sheet-pre').textContent.slice(0, 60)) : '',
    '有编辑框': !!d.querySelector('textarea.sheet-area'),
    '柱数': d.querySelectorAll('.net-col').length,
    '图例': [...d.querySelectorAll('.net-legend-row[data-name]')].map((r) => r.textContent),
    '合计': (d.querySelector('[data-testid="net-sum"]') || {}).textContent || '',
    '按钮': [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim())
  };
});
const 点按钮 = (page, re) => page.evaluate((r) => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return false;
  const b = [...d.querySelectorAll('.btnrow button')].find((x) => new RegExp(r).test(x.textContent));
  if (b) b.click();
  return !!b;
}, re);
const 提示 = (page) => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const 行读 = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s);
  if (!r) return null;
  const 取 = (x) => { const e = r.querySelector(x); return e ? e.textContent : ''; };
  return { 标题: 取('.ri-t'), 次行: 取('.ri-s'), 右列: 取('.ri-r') };
}, sel);

const 步 = async (out, 名字, fn) => {
  try { out[名字] = await fn(); } catch (e) { out[名字] = { 出错: String((e && e.message) || e).slice(0, 300) }; }
};

export default {
  name: '真机·M3/M4 功能（真远端）',
  check: async (page) => {
    const out = {};

    await 步(out, '①Hermes页', async () => {
      await page.evaluate(() => HP.App.openBoard('hermes'));
      await 等元素(page, '#tab-hermes [data-testid="remote-prompt"]', 20000);
      return page.evaluate(() => {
        const el = document.getElementById('tab-hermes');
        const 行 = (id) => {
          const r = el.querySelector('[data-testid="' + id + '"]');
          if (!r) return null;
          const 取 = (s) => { const e = r.querySelector(s); return e ? e.textContent : ''; };
          return { 标题: 取('.ri-t'), 次行: 取('.ri-s'), 右列: 取('.ri-r') };
        };
        return { 提示词行: 行('remote-prompt'), 模型行: 行('remote-model'),
          '技能行数': el.querySelectorAll('[data-skill]').length,
          '临时技能在列表里': !!el.querySelector('[data-skill*="hpk-verify-tmp"]') };
      });
    });

    await 步(out, '②自检_连上后', async () => page.evaluate(() => HP.Registry.check()));

    await 步(out, '③提示词小窗', async () => {
      await 点(page, '#tab-hermes [data-testid="remote-prompt"]');
      const 到了 = await 等小窗(page, 15000);
      const 读 = await 小窗读(page);
      await 关小窗(page);
      return { 到了, ...读 };
    });

    await 步(out, '④技能行下载到手机', async () => {
      await 点(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]');
      const 到了 = await 等小窗(page, 15000);
      const 小窗 = await 小窗读(page);
      const 点了 = await 点按钮(page, '下载到手机');
      await page.waitForTimeout(6000);
      return { 到了, 小窗, 点了下载: 点了, 提示: await 提示(page), 小窗还剩: await 窗数(page) };
    });

    await 步(out, '⑤编辑并回写', async () => {
      await 关小窗(page);
      await 点(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]');
      await 等小窗(page, 15000);
      const 点了编辑 = await 点按钮(page, '编辑并回写');
      await 等元素(page, '#stage textarea.sheet-area', 10000);
      const 编辑小窗 = await 小窗读(page);
      await page.evaluate(() => {
        const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
        const ta = d && d.querySelector('textarea.sheet-area');
        if (ta) ta.value = ta.value.replace('原始内容', '设备复验改过这一行');
      });
      const 点了回写 = await 点按钮(page, '回写');
      await page.waitForTimeout(8000);
      const 结果 = { 点了编辑, 编辑小窗: { 有编辑框: 编辑小窗 && 编辑小窗.有编辑框, 按钮: 编辑小窗 && 编辑小窗.按钮 }, 点了回写, 提示: await 提示(page) };
      await 关小窗(page);
      return 结果;
    });

    await 步(out, '⑥网络栏目', async () => {
      await page.evaluate(() => HP.App.openBoard('net'));
      await 等元素(page, '#tab-net [data-testid="net-ping"]', 15000);
      await 点(page, '#tab-net [data-testid="net-ping"]');
      await page.waitForTimeout(14000);
      const ping行 = await 行读(page, '#tab-net [data-testid="net-ping"]');
      await 点(page, '#tab-net [data-testid="net-tcp"]');
      await page.waitForTimeout(11000);
      const 端口行 = await 行读(page, '#tab-net [data-testid="net-tcp"]');
      await 点(page, '#tab-net [data-testid="net-raw"]');
      await 等小窗(page, 6000);
      const 原文 = await 小窗读(page);
      await 关小窗(page);
      return { ping行, 端口行, 原文小窗: { 正文开头: 原文 && 原文.正文开头, 按钮: 原文 && 原文.按钮 } };
    });

    await 步(out, '⑦流量小窗', async () => {
      const 计数 = await page.evaluate(async () => {
        HP.App.traffic.samples = [];
        HP.App.traffic.down = 0; HP.App.traffic.up = 0; HP.App.traffic._d = 0; HP.App.traffic._u = 0;
        for (let i = 0; i < 3; i++) {                       // 真发三次远端请求，攒出真实流量
          await HP.App.rpc('hermes.info', {}, 15000).catch(() => { });
          HP.App.sampleTraffic();
          await new Promise((r) => setTimeout(r, 1200));
        }
        return { 采样条数: HP.App.traffic.samples.length, 下行: HP.App.traffic.down, 上行: HP.App.traffic.up };
      });
      await page.evaluate(() => HP.App.openTrafficDialog());
      await 等小窗(page, 8000);
      const 读 = await 小窗读(page);
      await 关小窗(page);
      return { 计数, 小窗: { 抬头: 读 && 读.抬头, 柱数: 读 && 读.柱数, 图例: 读 && 读.图例, 合计: 读 && 读.合计, 按钮: 读 && 读.按钮 } };
    });

    await 步(out, '⑧终端有输出', async () => page.evaluate(() => {
      const t = HP.App.term;
      if (!t || !t.buffer) return { 出错: '拿不到 term' };
      const b = t.buffer.active;
      const 行 = [];
      for (let i = 0; i < Math.min(b.length, 60); i++) {
        const l = b.getLine(i);
        if (l) 行.push(l.translateToString(true));
      }
      const 有字 = 行.filter((s) => s.trim());
      return { 总行: b.length, 有字行: 有字.length, 样本: 有字.slice(0, 5) };
    }));

    return out;
  }
};
