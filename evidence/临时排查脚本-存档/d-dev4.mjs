/* 真机复验 第 4 批（**安全版**）：先把「进哪个会话」定成一次性会话 hpk-verify，再连，
 * 免得挂到用户/我正在用的 `hermes` 会话上（上一轮就挂上去了，虽然只读也够危险）。
 * 然后验 M3/M4 的新功能：Hermes 三行 / 提示词小窗 / 技能下载到手机 / 编辑并回写 / 网络 ping+端口 / 流量小窗。
 * 最后自己断开，不动远端任何东西（tmux 会话由宿主侧脚本收尾）。
 */
const 关小窗 = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));
const 窗数 = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length);
const 等小窗 = async (page, ms = 15000) => {
  for (let i = 0; i < ms / 500; i++) { if (await 窗数(page)) return true; await page.waitForTimeout(500); }
  return false;
};
const 等元素 = async (page, sel, ms = 15000) => {
  for (let i = 0; i < ms / 500; i++) {
    if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
const 点 = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel);
const 小窗读 = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return null;
  const t = (s) => { const e = d.querySelector(s); return e ? e.textContent : ''; };
  const 字段 = [];
  d.querySelectorAll('.sheet-body .field').forEach((f) => {
    const lab = f.querySelector('label'); const inp = f.querySelector('input') || f.querySelector('textarea'); const val = f.querySelector('.val');
    字段.push({ label: lab ? lab.textContent : '', 值: inp ? inp.value : (val ? val.textContent : '') });
  });
  return { 抬头: t('.sheet-t'), 字段, 有正文: !!d.querySelector('.sheet-pre'), 正文开头: t('.sheet-pre').slice(0, 50),
    '有编辑框': !!d.querySelector('textarea.sheet-area'), 柱数: d.querySelectorAll('.net-col').length,
    '图例': [...d.querySelectorAll('.net-legend-row[data-name]')].map((r) => r.textContent),
    '合计': t('[data-testid="net-sum"]'), 按钮: [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim()) };
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
  const t = (x) => { const e = r.querySelector(x); return e ? e.textContent : ''; };
  return { 标题: t('.ri-t'), 次行: t('.ri-s'), 右列: t('.ri-r') };
}, sel);
const 步 = async (out, 名字, fn) => {
  try { out[名字] = await fn(); } catch (e) { out[名字] = { 出错: String((e && e.message) || e).slice(0, 300) }; }
};

export default {
  name: '真机·M3/M4（一次性会话，安全版）',
  check: async (page) => {
    const out = {};

    await 步(out, '①指定会话并连接', async () => {
      // 这就是"用户在会话列表里点了一下 hpk-verify"的等价动作（走它自己的 pick 机制）
      await page.evaluate(() => { HP.Sessions.sel = 'hpk-verify'; HP.Sessions.at = 0; });
      await page.evaluate(() => HP.App.openBoard('hosts'));
      await page.waitForTimeout(1200);
      await page.evaluate(() => { const c = document.querySelector('#tab-hosts .card[data-host]'); if (c) c.click(); });
      await page.waitForTimeout(900);
      await page.evaluate(() => {
        const it = [...document.querySelectorAll('#ctxmenu button, #ctxmenu .ctx-item, #ctxmenu div')].find((b) => /连接/.test(b.textContent || ''));
        if (it) it.click();
      });
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(1000);
        const s = await page.evaluate(() => HP.App.state);
        if (s === 'connected') break;
      }
      return page.evaluate(() => ({ state: HP.App.state, sessionId: HP.App.sessionId, transport: HP.App.transport ? HP.App.transport.name : null }));
    });

    await 步(out, '②会话板块', async () => {
      await page.evaluate(() => HP.App.openBoard('sessions'));
      await page.waitForTimeout(5000);
      const 行 = await page.evaluate(() => [...document.querySelectorAll('#tab-sessions .row-item')].map((r) => ({
        id: r.dataset.testid, 标题: (r.querySelector('.ri-t') || {}).textContent || '',
        '次行': (r.querySelector('.ri-s') || {}).textContent || '', 右列: (r.querySelector('.ri-r') || {}).textContent || ''
      })));
      const 抬头 = await page.evaluate(() => (document.getElementById('tab-sessions') || {}).textContent.slice(0, 120));
      return { 抬头, 行, 选中: await page.evaluate(() => HP.Sessions.sel) };
    });

    await 步(out, '③Hermes 三行', async () => {
      await page.evaluate(() => HP.App.openBoard('hermes'));
      await 等元素(page, '#tab-hermes [data-testid="remote-prompt"]', 25000);
      return page.evaluate(() => {
        const el = document.getElementById('tab-hermes');
        const 行 = (id) => { const r = el.querySelector('[data-testid="' + id + '"]'); if (!r) return null;
          const t = (s) => { const e = r.querySelector(s); return e ? e.textContent : ''; }; return { 标题: t('.ri-t'), 次行: t('.ri-s'), 右列: t('.ri-r') }; };
        return { 提示词行: 行('remote-prompt'), 模型行: 行('remote-model'),
          '技能行数': el.querySelectorAll('[data-skill]').length, 临时技能在: !!el.querySelector('[data-skill*="hpk-verify-tmp"]') };
      });
    });

    await 步(out, '④临时技能：下载到手机', async () => {
      await 点(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]');
      const 到了 = await 等小窗(page, 20000);
      const 小窗 = await 小窗读(page);
      const 点了 = await 点按钮(page, '下载到手机');
      await page.waitForTimeout(8000);
      return { 到了, 小窗, 点了下载: 点了, 提示: await 提示(page), 小窗还剩: await 窗数(page) };
    });

    await 步(out, '⑤临时技能：编辑并回写', async () => {
      await 关小窗(page);
      await 点(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]');
      await 等小窗(page, 20000);
      const 点了编辑 = await 点按钮(page, '编辑并回写');
      await 等元素(page, '#stage textarea.sheet-area', 12000);
      const 编辑小窗 = await 小窗读(page);
      const 改前 = await page.evaluate(() => { const d = [...document.querySelectorAll('#stage .hp-dialog')].pop(); const ta = d && d.querySelector('textarea.sheet-area'); return ta ? ta.value.slice(0, 40) : null; });
      await page.evaluate(() => {
        const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
        const ta = d && d.querySelector('textarea.sheet-area');
        if (ta) ta.value = ta.value.replace('原始内容', '设备复验改过这一行');
      });
      const 点了回写 = await 点按钮(page, '回写');
      await page.waitForTimeout(10000);
      const r = { 点了编辑, 编辑小窗: { 有编辑框: 编辑小窗 && 编辑小窗.有编辑框, 正文开头: 改前, 按钮: 编辑小窗 && 编辑小窗.按钮 }, 点了回写, 提示: await 提示(page) };
      await 关小窗(page);
      return r;
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
      await 等小窗(page, 8000);
      const 原文 = await 小窗读(page);
      await 关小窗(page);
      return { ping行, 端口行, 原文开头: 原文 && 原文.正文开头, 原文按钮: 原文 && 原文.按钮 };
    });

    await 步(out, '⑦流量小窗（真流量）', async () => {
      const 计数 = await page.evaluate(async () => {
        HP.App.traffic.samples = []; HP.App.traffic.down = 0; HP.App.traffic.up = 0;
        HP.App.traffic._d = 0; HP.App.traffic._u = 0;
        HP.App.send('ls /home/lwgat | head -5\r');          // 真发一条命令 → 远端真吐数据
        for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 1200)); HP.App.sampleTraffic(); }
        return { 采样条数: HP.App.traffic.samples.length, 下行: HP.App.traffic.down, 上行: HP.App.traffic.up };
      });
      await page.evaluate(() => HP.App.openTrafficDialog());
      await 等小窗(page, 8000);
      const 读 = await 小窗读(page);
      await 关小窗(page);
      return { 计数, 抬头: 读 && 读.抬头, 柱数: 读 && 读.柱数, 图例: 读 && 读.图例, 合计: 读 && 读.合计, 按钮: 读 && 读.按钮 };
    });

    await 步(out, '⑧终端与断开', async () => {
      const 终端 = await page.evaluate(() => {
        const t = HP.App.term; const b = t.buffer.active; const 行 = [];
        for (let i = Math.max(0, b.length - 40); i < b.length; i++) { const l = b.getLine(i); 行.push(l ? l.translateToString(true) : ''); }
        return { 总行: b.length, 末几行: 行.filter((x) => x.trim()).slice(-8) };
      });
      await page.evaluate(() => { try { HP.App.disconnect ? HP.App.disconnect() : HP.App.transport.close(); } catch (e) { } });
      await page.waitForTimeout(1500);
      return { 终端, 断开后状态: await page.evaluate(() => HP.App.state) };
    });

    return out;
  }
};
