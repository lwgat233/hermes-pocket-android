/* F-HERM-4 判据：能知道系统提示词（远端**真存过**的那一份）
 * 读回来的事实：解析出的份数/字符数/hash、行上的摘要、小窗正文长度、翻页拿到的**下一段**、
 *               以及"远端取不到"时是否如实显示（不假装有一份）。
 */
const 真实样本 = '@@STAT 20|21891|17658\n@@HASH 84bab0584d4b\n@@TOTAL 21732\n' +
  '@@HEAD You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply\n@@TEXT\n' +
  'You are Hermes Agent, built by Nous Research. 这是正文开头。';

const 关掉小窗 = (page) => page.evaluate(() => {
  document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
});

export default {
  name: 'F-HERM-4 系统提示词可见（来源 state.db）',

  check: async (page) => {
    const out = {};
    /* ① 纯函数解析：喂**真实**输出（从本机 state.db 取到的那一份格式） */
    out.解析 = await page.evaluate((raw) => HP.Remote.parsePrompt(raw), 真实样本);
    out.解析_坏数据 = await page.evaluate(() => HP.Remote.parsePrompt('@@ERR 打不开 state.db: no such file or directory'));

    /* ② 界面：Hermes 栏目里出现「系统提示词」这一行 */
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      window.__promptText = 'You are Hermes Agent, built by Nous Research.\n' + Array.from({ length: 400 }, (_, i) => '第 ' + i + ' 行提示词内容').join('\n');
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(1200);
    out.行 = await page.evaluate(() => {
      const r = document.querySelector('#tab-hermes [data-testid="remote-prompt"]');
      if (!r) return null;
      return {
        标题: r.querySelector('.ri-t').textContent,
        次行: r.querySelector('.ri-s').textContent,
        右列: r.querySelector('.ri-r').textContent,
        标题字号: getComputedStyle(r.querySelector('.ri-t')).fontSize,
        行高: Math.round(r.getBoundingClientRect().height)
      };
    });

    /* ③ 点行 → 小窗：抬头写清范围、来源写清在哪、正文就是那一段 */
    await page.evaluate(() => document.querySelector('#tab-hermes [data-testid="remote-prompt"]').click());
    await page.waitForTimeout(900);
    out.小窗 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      if (!d) return null;
      const pre = d.querySelector('.sheet-pre');
      return {
        抬头: d.querySelector('.sheet-t').textContent,
        字段: [...d.querySelectorAll('.sheet-body .field')].map((f) => f.querySelector('label').textContent + '=' + f.querySelector('.val').textContent),
        正文长度: pre ? pre.textContent.length : 0,
        正文开头: pre ? pre.textContent.slice(0, 40) : '',
        按钮: [...d.querySelectorAll('button')].map((b) => b.textContent.trim())
      };
    });

    /* ④ 点「看更多」→ 必须拿到**下一段**（首字不等于上一段首字），不是把第一段再显示一遍 */
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('button')].find((b) => /看更多/.test(b.textContent)).click();
    });
    await page.waitForTimeout(900);
    out.看更多 = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const pre = d.querySelector('.sheet-pre');
      return { 抬头: d.querySelector('.sheet-t').textContent, 正文开头: pre ? pre.textContent.slice(0, 20) : '', 正文长度: pre ? pre.textContent.length : 0 };
    });
    await 关掉小窗(page);

    /* ⑤ 翻到末尾时按钮变成「已到底」（不骗人） */
    const 总长 = await page.evaluate(() => (window.__promptText || '').length);
    out.底部 = await page.evaluate(async (total) => {
      HP.App.closePanel && HP.App.closePanel();
      await HP.Panels.openPromptSheet({ ok: true, offset: 1, chars: 1200, total, files: 20, hash: 'abc', head: 'x', text: '第一段' }, total - 10);
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      return { 抬头: d.querySelector('.sheet-t').textContent, 按钮: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    }, 总长);
    await 关掉小窗(page);

    /* ⑥ 远端取不到（没有 python3 / 打不开库）时：行上如实说"取不到"，点行不弹小窗 */
    await page.evaluate(() => {
      window.__promptErr = true;
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(1200);
    const 取不到前 = await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length);
    await page.evaluate(() => { const r = document.querySelector('#tab-hermes [data-testid="remote-prompt"]'); if (r) r.click(); });
    await page.waitForTimeout(600);
    out.取不到 = await page.evaluate((n) => ({
      次行: (document.querySelector('#tab-hermes [data-testid="remote-prompt"] .ri-s') || {}).textContent || '',
      小窗数没增加: document.querySelectorAll('#stage .hp-dialog').length === n,
      提示: (document.getElementById('toast') || {}).textContent || ''
    }), 取不到前);

    out.结论 = {
      解析出份数与长度: out.解析.ok && out.解析.files === 20 && out.解析.total === 21732 && out.解析.maxChars === 21891,
      解析出hash与开头: out.解析.hash === '84bab0584d4b' && /built by Nous Research/.test(out.解析.head),
      坏数据如实报错: out.解析_坏数据.ok === false && /打不开 state.db/.test(out.解析_坏数据.err),
      行渲染合规: !!out.行 && out.行.标题 === '系统提示词' && parseFloat(out.行.标题字号) >= 14 && out.行.行高 >= 44,
      行上写清份数与长度: /20 份/.test(out.行.次行) && new RegExp(out.行.右列.replace(/[^0-9]/g, '')).test(out.行.右列),
      小窗抬头写清范围: /1–1200 \/ \d+ 字符/.test(out.小窗.抬头),
      小窗来源写清在哪: out.小窗.字段.some((x) => /state\.db · system_prompts/.test(x)),
      正文是那一段: out.小窗.正文长度 >= 1180 && out.小窗.正文长度 <= 1200 && /built by Nous/.test(out.小窗.正文开头),
      看更多真的取下一段: /1201–2400/.test(out.看更多.抬头) && out.看更多.正文开头 !== out.小窗.正文开头 && out.看更多.正文长度 > 0,
      到底了就说到底: /已到底/.test(out.底部.按钮.join(' ')),
      取不到时如实说: /取不到/.test(out.取不到.次行) && out.取不到.小窗数没增加 === true
    };
    return out;
  }
};
