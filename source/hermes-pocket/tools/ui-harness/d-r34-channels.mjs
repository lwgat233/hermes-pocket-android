/* R-34（App 频道面板没显示角色「接入频道」）定位探针：用**平台真实 roles-json 回包**喂桥，量
 *   ① 频道页角色卡上一行现在显示什么（名称/副行/标签）；
 *   ② 点角色弹出的信息窗有哪几行、值是什么；
 *   ③ 「频道（N）」折叠区展开显示什么；
 *   ④ 全页面里有没有「接入频道」这几个字（有没有明确标注）。
 * 只读不写：不改工程文件。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r34-channels.mjs
 * 夹具：evidence/R34-定位-20260924/fixtures/{roles-json,sessions-json}.json（平台真实回包）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R34-定位-20260924/fixtures');
const ROLES = JSON.parse(fs.readFileSync(path.join(FX, 'roles-json.json'), 'utf8'));
const SESS = JSON.parse(fs.readFileSync(path.join(FX, 'sessions-json.json'), 'utf8'));

export default {
  name: 'R-34 定位：角色「接入频道」在面板里现在怎么显示',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    /* 0. 用平台真实回包喂桥（只在页面里拦，工程不动），然后走真路径刷一次 */
    out.桥注入 = await page.evaluate(({ ROLES, SESS }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        return orig(t);
      };
      return { 真实roles夹具: !!(ROLES && ROLES.scenes), 角色数: (ROLES.scenes || []).reduce((n, s) => n + (s.roles || []).length, 0) };
    }, { ROLES, SESS });

    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); HP.Talk.render(); });
    await page.waitForTimeout(900);

    /* ① 频道页（角色列表）真路径 */
    out.频道页角色卡 = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.tk-rolecard')];
      return cards.map((c) => ({
        角色: c.getAttribute('data-role'),
        第一行: (c.querySelector('.row1 .name') || {}).textContent || '',
        副行: (c.querySelector('.sub') || {}).textContent || '',
        标签: [...c.querySelectorAll('.tags .tk-tag')].map((t) => t.textContent),
        标签行存在: !!c.querySelector('.tags'),
        卡片高: Math.round(c.getBoundingClientRect().height)
      }));
    });

    out.页面上有没有这些字 = await page.evaluate(() => {
      const t = document.body.innerText || '';
      return { 含_接入频道: t.includes('接入频道'), 含_能接入: t.includes('能接入'), 含_未接: t.includes('未接'), 含_qqbot: t.includes('qqbot') };
    });

    /* ② 点角色 → 信息窗（真路径 openRoleSheet） */
    const sheet = async (role) => {
      await page.evaluate((r) => HP.Talk.openRoleSheet(r), role);
      await page.waitForTimeout(400);
      const d = await page.evaluate(() => {
        const card = document.querySelector('#tk-sheet .tk-sheetcard');
        if (!card) return { 缺失: true };
        const rows = [...card.querySelectorAll('.tk-sheetrow')].map((r) => ({
          键: (r.querySelector('.tk-k') || {}).textContent || '',
          值: (r.querySelector('.tk-v') || {}).textContent || ''
        }));
        return { 行: rows, 文本: card.innerText.replace(/\n+/g, ' | ').slice(0, 320) };
      });
      await page.evaluate(() => HP.Talk.closeSheet());
      await page.waitForTimeout(200);
      return d;
    };
    out.信息窗_home_maid = await sheet('home.maid');
    out.信息窗_pipeline_author = await sheet('pipeline.author');

    /* ③ 「频道（N）」折叠区 */
    out.频道区 = await page.evaluate(async () => {
      const t = document.querySelector('#tk-channels-toggle');
      if (!t) return { 缺失: true };
      const 折叠时 = t.innerText.replace(/\n+/g, ' ').trim();
      t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      const box = document.querySelector('#tk-channels');
      const 展开 = box ? [...box.children].map((c) => c.innerText.replace(/\n+/g, ' ').trim()) : null;
      return { 折叠时, 展开 };
    });

    out.源码位置 = {
      '角色卡-标签循环': 'talk.js:522-529（.tags/.tk-tag，逐个 channel 一个无标注标签）',
      '信息窗-能接入行': 'talk.js:826（[\'能接入\', channels.join(\'、\') || \'（无）\']）',
      '频道区-顶层注册表': 'talk.js:366-384（this.channels ← roles-json 顶层 channels）',
      '桥-取数': 'Bridge.kt:708（talk.roles → talk.py roles-json）',
      '刷新入口': 'talk.js:195-203 refreshRoles()'
    };
    return out;
  }
};
