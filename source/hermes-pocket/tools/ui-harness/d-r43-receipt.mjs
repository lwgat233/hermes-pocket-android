/* R-43 定位探针：App 状态行「已发出（未确认）」—— 拿**四种真实回执形状**喂桥，看 App 各显示什么。
 *   A 现状真形状：平台 CLI 输出人话 ⇒ Bridge 解析失败 ⇒ {delivered:null, raw:{raw:"#N 已记入并投给 X（投递成功）", cmd:"say ..."}}
 *   B 甲案（平台给真回执 JSON）：{delivered:true, ms:1491, attempts:2, confirmed:1, raw:{...}}
 *   C 没投成：{delivered:false, raw:{error:"没有会话"}}
 *   D 乙案（App 认 confirmed、平台不给 delivered）：{delivered:null, confirmed:1, raw:{...confirmed:1}}
 * 结论只看：状态行文本 + data-state。
 * 只读不写：不改工程文件、不动平台数据。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs d-r43-receipt.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FX = process.env.HP_FIXTURES || path.resolve(HERE, '../../../../evidence/R40-定位-20260924/fixtures');
const read = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const ROLES = read('roles-json.json');
const SESS = read('sessions-json.json');

export default {
  name: 'R-43 定位：四种回执形状下 App 状态行各显示什么',

  check: async (page) => {
    await page.setViewportSize({ width: 393, height: 778 });
    const out = {};

    await page.evaluate(({ ROLES, SESS }) => {
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.__case = null;
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { /* 非 JSON 原样走 */ }
        if (m && m.t === 'talk.roles') { setTimeout(() => reply(m._rid, ROLES), 3); return; }
        if (m && m.t === 'talk.sessions') { setTimeout(() => reply(m._rid, SESS), 3); return; }
        if (m && m.t === 'talk.say' && window.__case) { setTimeout(() => reply(m._rid, window.__case), 5); return; }
        return orig(t);
      };
    }, { ROLES, SESS });

    await page.evaluate(async () => { HP.App.showBoard('talk'); await HP.Talk.refreshRoles(); await HP.Talk.openRole('home.maid'); await new Promise((r) => setTimeout(r, 800)); });

    const run = async (label, payload) => {
      const r = await page.evaluate(async (payload) => {
        window.__case = payload;
        HP.Talk.sends = []; HP.Talk.sendSeq = 0;
        const p = HP.Talk.send('home.maid', 'private', '探针：' + (payload.__tag || '?'));
        await Promise.race([p, new Promise((r2) => setTimeout(r2, 1500))]);
        await new Promise((r2) => setTimeout(r2, 500));
        const rows = [...document.querySelectorAll('[data-testid="talk-sendrow"]')];
        const last = rows[rows.length - 1];
        const s0 = HP.Talk.sends[HP.Talk.sends.length - 1];
        return {
          状态行原文: last ? last.innerText.replace(/\n+/g, ' ').trim() : null,
          data_state: last ? last.getAttribute('data-state') : null,
          内存态: s0 ? { state: s0.state, ms: s0.ms, msApprox: s0.msApprox, note: s0.note } : null
        };
      }, payload);
      out[label] = r;
      return r;
    };

    /* A 现状真形状（平台 CLI 人话 ⇒ Bridge 兜底包装） */
    await run('A_现状真形状（平台输出人话、Bridge 兜底）', {
      __tag: 'A', to: 'home.maid', kind: 'private', delivered: null,
      raw: { raw: '#1290 已记入并投给 home.maid（投递成功）', cmd: 'say --by me --role home.maid --kind private --body 探针 --topic 私信' }
    });

    /* B 甲案：平台给真回执 JSON */
    await run('B_甲案（平台给真回执 JSON）', {
      __tag: 'B', to: 'home.maid', kind: 'private', delivered: true, ms: 1491, attempts: 2, confirmed: 1,
      raw: { id: 1290, to: 'home.maid', delivered: true, ms: 1491, attempts: 2, confirmed: 1 }
    });

    /* C 没投成 */
    await run('C_没投成', {
      __tag: 'C', to: 'home.maid', kind: 'private', delivered: false,
      raw: { id: 1291, to: 'home.maid', delivered: false, error: '没有会话' }
    });

    /* D 乙案：平台只给 confirmed，不给 delivered */
    await run('D_乙案（只认 confirmed、平台不给 delivered）', {
      __tag: 'D', to: 'home.maid', kind: 'private', delivered: null, confirmed: 1,
      raw: { id: 1292, to: 'home.maid', confirmed: 1, ms: 1491, attempts: 2 }
    });

    /* 结论读数：App 读的是哪几个字段 */
    out.E_App读的字段 = {
      talk_js: 'bridged = (r.delivered !== undefined) ? r.delivered : (raw.delivered !== undefined ? raw.delivered : null)（talk.js:1327-1328）',
      ms: 'const ms = (r.ms != null) ? r.ms : (raw.ms != null ? raw.ms : null)（talk.js 同段）',
      中性态: 'bridged === null ⇒ state="unconfirmed" ⇒ 文案「已发出（未确认）」（talk.js:1206/1345-1347）'
    };
    return out;
  }
};
