/* 定位到底哪一跳坏了：对比"页面发出去的 b64"和"页面自己算的期望 b64" */
const 样本 = '---\nname: tmp-x\ndescription: 试试下载 ✅\n---\n\n# 标题\n\n正文一行（中文）/ emoji ✅\n第二行\n';

export default {
  name: 'debug: 出站 b64 vs 期望 b64',
  check: async (page) => {
    const out = {};
    await page.evaluate((txt) => {
      window.__skillText = txt;
      window.__wroteSkill = null;
      // 抓出站原文（真实边界：HermesPocket.postMessage）
      window.__out = [];
      const wm = window.HermesPocket;
      const orig = wm.postMessage.bind(wm);
      wm.postMessage = (t) => { window.__out.push(t); return orig(t); };
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    }, 样本);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector('#tab-hermes [data-skill]').click());
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.btnrow button')].find((b) => /编辑并回写/.test(b.textContent)).click();
    });
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      ta.value = ta.value + '新加的一行\n';
      window.__期望 = ta.value;
      window.__期望b64 = HP.Remote.b64enc(ta.value);
      window.__期望字节 = new TextEncoder().encode(ta.value).length;
    });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.btnrow button')].find((b) => /回写/.test(b.textContent)).click();
    });
    await page.waitForFunction('window.__wroteSkill !== null', null, { timeout: 8000 }).catch(() => {});
    out.比对 = await page.evaluate(() => {
      const msg = window.__out.map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
        .filter((m) => m && m.t === 'skill.write').pop();
      const b64 = msg ? String(msg.b64 || '') : '';
      return {
        '出站b64长度': b64.length,
        '期望b64长度': String(window.__期望b64).length,
        '出站b64尾巴': b64.slice(-16),
        '期望b64尾巴': String(window.__期望b64).slice(-16),
        '出站和期望一致': b64 === window.__期望b64,
        '期望字节数': window.__期望字节,
        '出站b64能解回来的字节数': atob(b64.replace(/\s+/g, '')).length,
        '期望b64能解回来的字节数': atob(String(window.__期望b64).replace(/\s+/g, '')).length,
        '期望文本长度': window.__期望.length,
        '桥收到字节数': window.__wroteSkill ? window.__wroteSkill.size : null
      };
    });
    return out;
  }
};
