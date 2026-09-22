/* F-HERM-4 判据：能知道系统提示词（远端**真存过**的那一份）
 * 读回来的事实：解析出的份数/字符数/hash、行上的摘要、小窗正文长度、翻页拿到的**下一段**、
 *               以及"远端取不到"时是否如实显示（不假装有一份）。
 */
const realSample = '@@STAT 20|21891|17658\n@@HASH 84bab0584d4b\n@@TOTAL 21732\n' +
  '@@HEAD You are Hermes Agent, built by Nous Research. Be direct: match the length of your reply\n@@TEXT\n' +
  'You are Hermes Agent, built by Nous Research. 这是正文开头。';

/* 断言要匹配的界面文案（正则源串）：中文集中在此，与界面上的文案对照 */
const TEXT = {
  more: '看更多',
  promptErr: '打不开 state.db',
  fileCount: '20 份',
  charRange: '1–1200 \\/ \\d+ 字符',
  atEnd: '已到底',
  unavailable: '取不到',
  sampleLineSuffix: ' 行提示词内容'
};

const closeDialog = (page) => page.evaluate(() => {
  document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
});

export default {
  name: 'F-HERM-4 系统提示词可见（来源 state.db）',

  check: async (page) => {
    const out = {};
    /* ① 纯函数解析：喂**真实**输出（从本机 state.db 取到的那一份格式） */
    out.parse = await page.evaluate((raw) => HP.Remote.parsePrompt(raw), realSample);
    out.parseBadData = await page.evaluate(() => HP.Remote.parsePrompt('@@ERR 打不开 state.db: no such file or directory'));

    /* ② 界面：Hermes 栏目里出现「系统提示词」这一行 */
    const promptBody = 'You are Hermes Agent, built by Nous Research.\n' +
      Array.from({ length: 400 }, (_, i) => '第 ' + i + TEXT.sampleLineSuffix).join('\n');
    await page.evaluate((body) => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      window.__promptText = body;
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    }, promptBody);
    await page.waitForTimeout(1200);
    out.row = await page.evaluate(() => {
      const r = document.querySelector('#tab-hermes [data-testid="remote-prompt"]');
      if (!r) return null;
      return {
        'title': r.querySelector('.ri-t').textContent,
        'sub': r.querySelector('.ri-s').textContent,
        'right': r.querySelector('.ri-r').textContent,
        'titleSize': getComputedStyle(r.querySelector('.ri-t')).fontSize,
        'rowHeight': Math.round(r.getBoundingClientRect().height)
      };
    });

    /* ③ 点行 → 小窗：抬头写清范围、来源写清在哪、正文就是那一段 */
    await page.evaluate(() => document.querySelector('#tab-hermes [data-testid="remote-prompt"]').click());
    await page.waitForTimeout(900);
    out.dialog = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      if (!d) return null;
      const pre = d.querySelector('.sheet-pre');
      return {
        'heading': d.querySelector('.sheet-t').textContent,
        'fields': [...d.querySelectorAll('.sheet-body .field')].map((f) => f.querySelector('label').textContent + '=' + f.querySelector('.val').textContent),
        'bodyLen': pre ? pre.textContent.length : 0,
        'bodyHead': pre ? pre.textContent.slice(0, 40) : '',
        'buttons': [...d.querySelectorAll('button')].map((b) => b.textContent.trim())
      };
    });

    /* ④ 点「看更多」→ 必须拿到**下一段**（首字不等于上一段首字），不是把第一段再显示一遍 */
    await page.evaluate((more) => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('button')].find((b) => new RegExp(more).test(b.textContent)).click();
    }, TEXT.more);
    await page.waitForTimeout(900);
    out.more = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const pre = d.querySelector('.sheet-pre');
      return { heading: d.querySelector('.sheet-t').textContent, bodyHead: pre ? pre.textContent.slice(0, 20) : '', bodyLen: pre ? pre.textContent.length : 0 };
    });
    await closeDialog(page);

    /* ⑤ 翻到末尾时按钮变成「已到底」（不骗人） */
    const totalLen = await page.evaluate(() => (window.__promptText || '').length);
    out.bottom = await page.evaluate(async (total) => {
      HP.App.closePanel && HP.App.closePanel();
      await HP.Panels.openPromptSheet({ ok: true, offset: 1, chars: 1200, total, files: 20, hash: 'abc', head: 'x', text: '第一段' }, total - 10);
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      return { heading: d.querySelector('.sheet-t').textContent, buttons: [...d.querySelectorAll('button')].map((b) => b.textContent.trim()) };
    }, totalLen);
    await closeDialog(page);

    /* ⑥ 远端取不到（没有 python3 / 打不开库）时：行上如实说"取不到"，点行不弹小窗 */
    await page.evaluate(() => {
      window.__promptErr = true;
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(1200);
    const dialogsBefore = await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length);
    await page.evaluate(() => { const r = document.querySelector('#tab-hermes [data-testid="remote-prompt"]'); if (r) r.click(); });
    await page.waitForTimeout(600);
    out.unavailable = await page.evaluate((n) => ({
      'sub': (document.querySelector('#tab-hermes [data-testid="remote-prompt"] .ri-s') || {}).textContent || '',
      'dialogCountUnchanged': document.querySelectorAll('#stage .hp-dialog').length === n,
      'toast': (document.getElementById('toast') || {}).textContent || ''
    }), dialogsBefore);

    out.verdict = {
      'filesAndTotal': out.parse.ok && out.parse.files === 20 && out.parse.total === 21732 && out.parse.maxChars === 21891,
      'hashAndHead': out.parse.hash === '84bab0584d4b' && /built by Nous Research/.test(out.parse.head),
      'badDataReported': out.parseBadData.ok === false && new RegExp(TEXT.promptErr).test(out.parseBadData.err),
      'rowRendersOk': !!out.row && out.row.title === '系统提示词' && parseFloat(out.row.titleSize) >= 14 && out.row.rowHeight >= 44,
      'rowShowsFilesAndTotal': new RegExp(TEXT.fileCount).test(out.row.sub) && new RegExp(out.row.right.replace(/[^0-9]/g, '')).test(out.row.right),
      'dialogHeadingRange': new RegExp(TEXT.charRange).test(out.dialog.heading),
      'dialogSourceShown': out.dialog.fields.some((x) => /state\.db · system_prompts/.test(x)),
      'bodyIsSegment': out.dialog.bodyLen >= 1180 && out.dialog.bodyLen <= 1200 && /built by Nous/.test(out.dialog.bodyHead),
      'moreFetchesNextSegment': /1201–2400/.test(out.more.heading) && out.more.bodyHead !== out.dialog.bodyHead && out.more.bodyLen > 0,
      'bottomSaysEnd': new RegExp(TEXT.atEnd).test(out.bottom.buttons.join(' ')),
      'unavailableReported': new RegExp(TEXT.unavailable).test(out.unavailable.sub) && out.unavailable.dialogCountUnchanged === true
    };
    return out;
  }
};
