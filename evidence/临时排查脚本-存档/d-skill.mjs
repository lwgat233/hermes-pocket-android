/* 追一追：编辑框里的中文追加，是"哪一跳"把它弄坏的 */
const 样本 = '---\nname: tmp-x\n---\n中文一行 ✅\n';

export default {
  name: 'debug: skill 回写链路上的字节',
  check: async (page) => {
    const out = {};
    await page.evaluate((txt) => {
      window.__skillText = txt;
      window.__log = [];
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    }, 样本);
    await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector('#tab-hermes [data-skill]').click());
    await page.waitForTimeout(900);
    out.读回来的 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      return d ? d.querySelector('.sheet-pre').textContent.slice(0, 40) : null;
    });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.btnrow button')].find((b) => /编辑并回写/.test(b.textContent)).click();
    });
    await page.waitForTimeout(700);
    out.编辑框原值 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      return d.querySelector('textarea.sheet-area').value.slice(0, 40);
    });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      ta.value = ta.value + '新加的一行\n';
    });
    out.追加后 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      const 应 = HP.Remote.b64enc(ta.value);
      return {
        '尾巴': ta.value.slice(-20),
        '尾巴是不是对': ta.value.endsWith('新加的一行\n'),
        '我算的b64尾巴': 应.slice(-24),
        '长度': ta.value.length
      };
    });
    out.桥收到的 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.btnrow button')].find((b) => /回写/.test(b.textContent)).click();
      return new Promise((res) => setTimeout(() => {
        const w = window.__wroteSkill;
        res(w ? { 尾巴: w.text.slice(-20), 字节数: w.size } : null);
      }, 1200));
    });
    return out;
  }
};
