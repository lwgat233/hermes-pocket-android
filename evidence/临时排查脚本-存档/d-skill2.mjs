/* 复现 t-skill 第 ④ 步：长样本 + 追加中文 → 看桥收到的 b64（原样）与解出的文本 */
const 样本 = '---\nname: tmp-x\ndescription: 试试下载 ✅\n---\n\n# 标题\n\n正文一行（中文）/ emoji ✅\n第二行\n';

export default {
  name: 'debug: 复现回写字节',
  check: async (page) => {
    const out = {};
    await page.evaluate((txt) => {
      window.__skillText = txt;
      window.__wroteSkill = null;
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
    // 追加前，先把"编辑框里的原值"和"期望的最终值"算出来（都在页面里算，排除 node 侧差异）
    out.追加前 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      return { 长度: ta.value.length, 尾巴: ta.value.slice(-10), b64长度: HP.Remote.b64enc(ta.value).length };
    });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      ta.value = ta.value + '新加的一行\n';
      window.__期望 = ta.value;
      window.__期望b64 = HP.Remote.b64enc(ta.value);
    });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.btnrow button')].find((b) => /回写/.test(b.textContent)).click();
    });
    await page.waitForFunction('window.__wroteSkill !== null', null, { timeout: 8000 }).catch(() => {});
    out.结果 = await page.evaluate(() => {
      const w = window.__wroteSkill;
      return {
        '桥收到字节数': w ? w.size : null,
        '桥收到文本尾巴': w ? w.text.slice(-16) : null,
        '期望文本尾巴': window.__期望.slice(-16),
        '桥收到文本与期望一致': w ? (w.text === window.__期望) : null,
        '期望b64尾巴': window.__期望b64.slice(-16)
      };
    });
    return out;
  }
};
