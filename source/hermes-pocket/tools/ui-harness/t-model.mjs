/* F-HERM-5 判据：看 / 改远端模型（改前备份、改后读回校验、可还原）
 * 读回来的事实：解析出的模型与候选、行上的值、小窗里的可编辑字段、写回时桥收到的参数、
 *               写回后行上的值有没有变、只读时是否如实报错、没改时是否真的不发请求。
 */
/* 界面文案（期望值，不能改；提到常量位置，免得落进正则字面量/调用实参） */
const TEXT = {
  writeBack: '写回并校验',                 // 小窗动作按钮
  undoLast: '还原上次',                    // 小窗动作按钮
  modelNamePrefix: '模型名',               // 字段 label 的前缀
  parseErrPattern: '打不开 config.yaml',   // 原正则 /打不开 config.yaml/（`.` 是通配，故用 RegExp）
  changedTo: '已改为 deepseek-v4-pro',
  verifyOk: '读回校验通过',
  restoredTo: '已还原到 deepseek-v4-flash',
  writeFailed: '写回失败',
  unchanged: '和现在一样'
};
const RE_PARSE_ERR = new RegExp(TEXT.parseErrPattern);

const realSample = '@@PATH /home/lwgat/.hermes/config.yaml\n@@W 1\n@@MODEL deepseek-v4-flash\n' +
  '@@PROVIDER deepseek\n@@BASE https://api.deepseek.com/v1\n' +
  '@@CAND deepseek-v4-pro,deepseek-flash\n@@BAKS config.yaml.hpk-bak-20260921-120000';

/** 点小窗下排的某个动作（按文案找；文案从 Node 侧传进去，页里不必再写一遍中文） */
const tapSheetButton = (page, label) => page.evaluate((text) => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  [...d.querySelectorAll('.btnrow button')].find((b) => b.textContent.includes(text)).click();
}, label);

const closeSheets = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));
const readSheet = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return null;
  return {
    title: d.querySelector('.sheet-t').textContent,
    fields: [...d.querySelectorAll('.sheet-body .field')].map((f) => ({
      label: f.querySelector('label').textContent,
      editable: !!f.querySelector('input'),
      value: (f.querySelector('input') || f.querySelector('.val') || {}).value ?? (f.querySelector('.val') || {}).textContent
    })),
    candidates: [...d.querySelectorAll('.sheet-choice button')].map((b) => b.textContent.trim()),
    buttons: [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim())
  };
});
const readRow = (page) => page.evaluate(() => {
  const r = document.querySelector('#tab-hermes [data-testid="remote-model"]');
  return r ? { title: r.querySelector('.ri-t').textContent, right: r.querySelector('.ri-r').textContent, sub: r.querySelector('.ri-s').textContent } : null;
});

export default {
  name: 'F-HERM-5 远端模型：看 / 改 / 还原',

  check: async (page) => {
    const out = {};
    /* ① 纯函数解析（喂本机真实输出格式） */
    out.parse = await page.evaluate((raw) => HP.Remote.parseModel(raw), realSample);
    out.parseBadData = await page.evaluate(() => HP.Remote.parseModel('@@ERR 打不开 config.yaml'));

    /* ② 行：Hermes 栏目里出现「模型」一行，右列是当前模型 */
    await page.evaluate(() => {
      window.__modelName = 'deepseek-v4-flash';
      window.__modelRaw = () => '@@PATH /home/lwgat/.hermes/config.yaml\n@@W 1\n@@MODEL ' + window.__modelName +
        '\n@@PROVIDER deepseek\n@@BASE https://api.deepseek.com/v1\n@@CAND deepseek-v4-pro,deepseek-flash\n@@BAKS config.yaml.hpk-bak-20260921-120000';
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0;
      HP.App.openBoard('hermes');
    });
    await page.waitForTimeout(1400);
    out.row = await readRow(page);

    /* ③ 点行 → 小窗：可编辑字段 + 候选 + 三个动作 */
    await page.evaluate(() => document.querySelector('#tab-hermes [data-testid="remote-model"]').click());
    await page.waitForTimeout(900);
    out.sheet = await readSheet(page);

    /* ④ 点候选项 → 填进输入框（不是直接写） */
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.sheet-choice button')].find((b) => b.textContent.trim() === 'deepseek-v4-pro').click();
    });
    out.inputAfterPick = await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      return d.querySelector('.sheet-input').value;
    });

    /* ⑤ 点「写回并校验」→ 桥收到 set（参数要对）+ 小窗关 + 行上的值变成新模型 */
    await page.evaluate(() => { window.__calls = {}; });
    await tapSheetButton(page, TEXT.writeBack);
    await page.waitForTimeout(1800);
    out.writeBack = {
      bridgeCalls: await page.evaluate(() => window.__calls),
      sheetsLeft: await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length),
      toast: await page.evaluate(() => (document.getElementById('toast') || {}).textContent || ''),
      row: await readRow(page)
    };

    /* ⑥ 还原 → 桥收到 undo + 行上的值回到原模型 */
    await page.evaluate(() => document.querySelector('#tab-hermes [data-testid="remote-model"]').click());
    await page.waitForTimeout(800);
    await page.evaluate(() => { window.__calls = {}; });
    await tapSheetButton(page, TEXT.undoLast);
    await page.waitForTimeout(1600);
    out.undo = {
      bridgeCalls: await page.evaluate(() => window.__calls),
      toast: await page.evaluate(() => (document.getElementById('toast') || {}).textContent || ''),
      row: await readRow(page)
    };
    await closeSheets(page);

    /* ⑦ 只读 / 写不进去：如实报错，小窗不关、值不变 */
    await page.evaluate(() => { window.__modelWriteFail = true; });
    await page.evaluate(() => document.querySelector('#tab-hermes [data-testid="remote-model"]').click());
    await page.waitForTimeout(800);
    await page.evaluate((text) => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      d.querySelector('.sheet-input').value = 'some-other-model';
      [...d.querySelectorAll('.btnrow button')].find((b) => b.textContent.includes(text)).click();
    }, TEXT.writeBack);
    await page.waitForTimeout(1200);
    out.writeFail = {
      toast: await page.evaluate(() => (document.getElementById('toast') || {}).textContent || ''),
      sheetOpen: await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length > 0),
      inputValue: await page.evaluate(() => { const d = [...document.querySelectorAll('#stage .hp-dialog')].pop(); return d ? d.querySelector('.sheet-input').value : null; })
    };

    /* ⑧ 没改就点写回：不该发请求（别拿"看起来成功"糊过去） */
    await page.evaluate(() => { window.__modelWriteFail = false; });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      d.querySelector('.sheet-input').value = window.__modelName;
    });
    await page.evaluate(() => { window.__calls = {}; });
    await page.evaluate((text) => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      [...d.querySelectorAll('.btnrow button')].find((b) => b.textContent.includes(text)).click();
    }, TEXT.writeBack);
    await page.waitForTimeout(900);
    out.unchangedSubmit = { bridgeCalls: await page.evaluate(() => window.__calls), toast: await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '') };
    await closeSheets(page);

    out.verdict = {
      parseModelAndCandidates: out.parse.ok && out.parse.model === 'deepseek-v4-flash' && out.parse.provider === 'deepseek' &&
        out.parse.candidates.length === 2 && out.parse.writable === true && out.parse.backups.length === 1,
      badDataReportsError: out.parseBadData.ok === false && RE_PARSE_ERR.test(out.parseBadData.err),
      rowShowsCurrentModel: !!out.row && out.row.title === '模型' && out.row.right === 'deepseek-v4-flash' && /deepseek/.test(out.row.sub),
      sheetHasEditableField: !!out.sheet && out.sheet.fields.some((f) => f.editable && f.label.indexOf(TEXT.modelNamePrefix) === 0 && f.value === 'deepseek-v4-flash'),
      sheetHasCandidatesAndThreeActions: out.sheet.candidates.join(',') === 'deepseek-v4-pro,deepseek-flash' && out.sheet.buttons.join('/') === '写回并校验/还原上次/关闭',
      candidateTapFillsOnly: out.inputAfterPick === 'deepseek-v4-pro',
      writeBackSendsCorrectArgs: (out.writeBack.bridgeCalls['hermes.model.set'] || 0) === 1,
      writeBackClosesSheet: out.writeBack.sheetsLeft === 0,
      writeBackShowsVerifyToast: out.writeBack.toast.includes(TEXT.changedTo) && out.writeBack.toast.includes(TEXT.verifyOk),
      writeBackUpdatesRow: !!out.writeBack.row && out.writeBack.row.right === 'deepseek-v4-pro',
      undoSendsRequest: (out.undo.bridgeCalls['hermes.model.undo'] || 0) === 1,
      undoRestoresRow: !!out.undo.row && out.undo.row.right === 'deepseek-v4-flash' && out.undo.toast.includes(TEXT.restoredTo),
      writeFailReportsError: out.writeFail.toast.includes(TEXT.writeFailed) && out.writeFail.sheetOpen === true && out.writeFail.inputValue === 'some-other-model',
      unchangedSubmitsNothing: (out.unchangedSubmit.bridgeCalls['hermes.model.set'] || 0) === 0 && out.unchangedSubmit.toast.includes(TEXT.unchanged)
    };
    return out;
  }
};
