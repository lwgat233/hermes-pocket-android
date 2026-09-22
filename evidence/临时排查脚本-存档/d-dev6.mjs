/* 收尾排查 + 补齐设备复验：
 *  ① 先把可能还开着的「信任并保存」主机指纹小窗按掉（真 UI 路径，自己的测试主机）
 *  ② 打印技能行 data-skill 的**原文**（那段路径里的反斜杠到底是谁加的）
 *  ③ 直接调一次 skill.read（用干净路径），把原始回包打出来
 *  ④ 真跑：下载到手机 / 编辑并回写（临时技能）
 */
const 窗数 = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length);
const 关小窗 = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));
const 等小窗 = async (page, ms = 15000) => {
  for (let i = 0; i < ms / 500; i++) { if (await 窗数(page)) return true; await page.waitForTimeout(500); }
  return false;
};
const 等元素 = async (page, sel, ms = 15000) => {
  for (let i = 0; i < ms / 500; i++) { if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true; await page.waitForTimeout(500); }
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
  return { 抬头: t('.sheet-t'), 字段, 有正文: !!d.querySelector('.sheet-pre'), 有编辑框: !!d.querySelector('textarea.sheet-area'),
    '按钮': [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim()) };
});
const 点按钮 = (page, re) => page.evaluate((r) => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return false;
  const b = [...d.querySelectorAll('.btnrow button')].find((x) => new RegExp(r).test(x.textContent));
  if (b) b.click();
  return !!b;
}, re);
const 提示 = (page) => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');

/**
 * 确保连着：走**用户真会走的那条路** —— 主机栏目 → 点主机卡片 → 菜单「连接」。
 * 断线之后重连能不能成，就是在验刚修的那条（修之前这里会卡在「传输未就绪」）。
 */
const 确保连接 = async (page, 会话名) => {
  const 之前 = await page.evaluate(() => HP.App.state);
  if (之前 === 'connected') return { 之前, 动作: '本来就连着', 之后: 之前 };
  if (会话名) await page.evaluate((n) => { HP.Sessions.sel = n; HP.Sessions.at = 0; }, 会话名);
  await page.evaluate(() => HP.App.openBoard('hosts'));
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const c = document.querySelector('#tab-hosts .card[data-host]'); if (c) c.click(); });
  await page.waitForTimeout(900);
  const 点了 = await page.evaluate(() => {
    const it = [...document.querySelectorAll('#ctxmenu button, #ctxmenu .ctx-item, #ctxmenu div')].find((b) => /连接/.test(b.textContent || ''));
    if (it) { it.click(); return true; }
    return false;
  });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    if (await page.evaluate(() => HP.App.state) === 'connected') break;
  }
  return { 之前, 动作: '主机卡片 → 连接', 点了菜单: 点了, 之后: await page.evaluate(() => HP.App.state), 提示: await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '') };
};

export default {
  name: '真机·技能路径排查 + 下载/回写',
  check: async (page) => {
    const out = {};

    /* ⓪ 确保已连接（断过之后重连 —— 修好的那条路） */
    out.确保连接 = await 确保连接(page, 'hpk-verify');

    /* ① 按掉主机指纹小窗（如果有） */
    out.指纹小窗 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      if (!d) return '没有小窗';
      const b = [...d.querySelectorAll('.btnrow button')].find((x) => /信任并保存/.test(x.textContent));
      if (b) { b.click(); return '按了「信任并保存」'; }
      return '不是指纹小窗：' + d.textContent.slice(0, 40);
    });
    await page.waitForTimeout(1500);

    /* ② 技能行里那个 data-skill 的原文 + 反斜杠计数 */
    await page.evaluate(() => HP.App.openBoard('hermes'));
    await 等元素(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]', 25000);
    out.技能行 = await page.evaluate(() => {
      const r = document.querySelector('#tab-hermes [data-skill*="hpk-verify-tmp"]');
      if (!r) return null;
      const v = r.getAttribute('data-skill');
      const d = r.dataset.skill;
      return {
        '属性原文': v, dataset: d,
        '属性里反斜杠数': (v.match(/\\/g) || []).length,
        'dataset里反斜杠数': (d.match(/\\/g) || []).length,
        '逐字符': [...v].slice(0, 40).join('|')
      };
    });
    out.列出的rel_来自hermes接口 = await page.evaluate(async () => {
      const info = await HP.App.rpc('hermes.info', {}, 20000);
      const s = (info.skills || []).find((x) => /hpk-verify-tmp/.test(x.rel || x.path || ''));
      return s ? { rel: s.rel, path: s.path, 反斜杠数: ((s.path || '') .match(/\\/g) || []).length } : '没找到';
    });

    /* ③ 直接调 skill.read（干净路径），看回包原文 */
    out.直调 = await page.evaluate(async () => {
      const 试 = async (p) => {
        try { const r = await HP.App.rpc('skill.read', { path: p }, 20000); return String(r && r.raw !== undefined ? r.raw : JSON.stringify(r)).slice(0, 200); }
        catch (e) { return '抛错: ' + String(e.message); }
      };
      return { 干净路径: await 试('skills/hpk-verify-tmp/SKILL.md'), 带反斜杠: await 试('skills\\/hpk-verify-tmp\\/SKILL.md') };
    });

    /* ④ 下载到手机（点技能行 → 小窗 → 下载） */
    out.下载 = { 小窗: null, 提示: '' };
    await 点(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]');
    if (await 等小窗(page, 20000)) {
      out.下载.小窗 = await 小窗读(page);
      out.下载.点了 = await 点按钮(page, '下载到手机');
      await page.waitForTimeout(9000);
      out.下载.提示 = await 提示(page);
      out.下载.小窗还剩 = await 窗数(page);
    }
    await 关小窗(page);

    /* ⑤ 编辑并回写 */
    out.回写 = { 编辑小窗: null, 提示: '' };
    await 点(page, '#tab-hermes [data-skill*="hpk-verify-tmp"]');
    if (await 等小窗(page, 20000)) {
      out.回写.点了编辑 = await 点按钮(page, '编辑并回写');
      if (await 等元素(page, '#stage textarea.sheet-area', 12000)) {
        out.回写.编辑小窗 = await 小窗读(page);
        await page.evaluate(() => {
          const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
          const ta = d && d.querySelector('textarea.sheet-area');
          if (ta) ta.value = ta.value.replace('原始内容', '设备复验改过这一行');
        });
        out.回写.点了回写 = await 点按钮(page, '回写');
        await page.waitForTimeout(10000);
        out.回写.提示 = await 提示(page);
      }
    }
    await 关小窗(page);
    return out;
  }
};
