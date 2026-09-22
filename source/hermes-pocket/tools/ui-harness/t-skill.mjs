/* F-HERM-3 判据：skill 读原文（带 sha256）→ 下载到手机 → 编辑并回写（先对账、改前备份、读完校验）
 * 里头的 sha256 全是**真算**的（页面侧 WebCrypto、驱动侧 node crypto），所以"两侧一致"是真对账。
 */
import crypto from 'node:crypto';

const sample = '---\nname: tmp-x\ndescription: 试试下载 ✅\n---\n\n# 标题\n\n正文一行（中文）/ emoji ✅\n第二行\n';
const sampleSha = crypto.createHash('sha256').update(Buffer.from(sample, 'utf8')).digest('hex');
/* 断言要匹配的界面文案（正则源串 / 按钮名）：中文集中在此，与界面上的文案对照 */
const TEXT = {
  unreadable: '读不到',
  remotePath: '远端路径',
  sizeAndSha: '字节数 \\/ sha256',
  matchRemote: '与远端一致',
  savedToPhone: '已存到手机',
  addedLine: '新加的一行',
  writtenBack: '已回写',
  newSha: '新 sha',
  backupSkill: '备份 SKILL\\.md\\.hpk-bak',
  sameAsOpened: '和打开时一样',
  writeBackFailed: '回写失败',
  changed: '已变',
  skillReadFailed: '读技能失败',
  saveToPhoneFailed: '存到手机失败',
  mismatched: '对不上',
  btnDownload: '下载到手机',
  btnEditAndWriteBack: '编辑并回写',
  btnWriteBack: '回写',
};

const dialogCount = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length);
const closeDialog = (page) => page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()));
const readDialog = (page) => page.evaluate(() => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  if (!d) return null;
  return {
    'heading': d.querySelector('.sheet-t').textContent,
    'fields': [...d.querySelectorAll('.sheet-body .field')].map((f) => ({
      label: f.querySelector('label').textContent,
      'value': ((f.querySelector('input') || f.querySelector('textarea') || f.querySelector('.val') || {}).value
        ?? (f.querySelector('.val') || {}).textContent)
    })),
    'hasBody': !!d.querySelector('.sheet-pre'),
    'bodyHead': (d.querySelector('.sheet-pre') || {}).textContent?.slice(0, 30) || '',
    'hasEditor': !!d.querySelector('textarea.sheet-area'),
    'editorHead': (d.querySelector('textarea.sheet-area') || {}).value?.slice(0, 20) || '',
    'buttons': [...d.querySelectorAll('.btnrow button')].map((b) => b.textContent.trim())
  };
});
const clickButton = (page, re) => page.evaluate((r) => {
  const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
  [...d.querySelectorAll('.btnrow button')].find((b) => new RegExp(r).test(b.textContent)).click();
}, re);
const toast = (page) => page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
const openSkill = async (page) => {
  await page.evaluate(() => {
    document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove());
    HP.App.openBoard('hermes');
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const r = document.querySelector('#tab-hermes [data-skill]');
    if (r) r.click();
  });
  await page.waitForTimeout(900);
};

export default {
  name: 'F-HERM-3 skill：下载到手机 / 编辑并回写',

  check: async (page) => {
    const out = {};
    /* ① 纯函数：base64 往返（中文/emoji/换行）+ 解析真实格式 */
    out.roundTrip = await page.evaluate((txt) => ({
      'same': HP.Remote.b64dec(HP.Remote.b64enc(txt)) === txt,
      'empty': HP.Remote.b64dec(HP.Remote.b64enc('')) === ''
    }), sample);
    out.parse = await page.evaluate((txt) => {
      const bytes = new TextEncoder().encode(txt);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const raw = '@@SIZE ' + bytes.length + '\n@@SHA 死'.replace('死', '') + 'abc\n@@B64\n' + btoa(bin);
      const r = HP.Remote.parseSkill(raw);
      return { ok: r.ok, size: r.size, sha: r.sha, bodySame: r.text === txt, bodyLen: r.text.length };
    }, sample);
    out.parseBadData = await page.evaluate(() => HP.Remote.parseSkill('@@ERR 读不到: 文件不存在'));

    /* ② 技能行点开 → 小窗（路径 + 字节数/sha + 正文 + 三个动作） */
    await page.evaluate((txt) => {
      window.__skillText = txt;
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.Panels._hermesCache = null; HP.Panels._hermesAt = 0; HP.Panels._savedSkill = null;
      window.__calls = {};
    }, sample);
    await openSkill(page);
    out.dialog = await readDialog(page);
    out.dialogBytes = await page.evaluate((txt) => new TextEncoder().encode(txt).length, sample);

    /* ③ 下载到手机：桥收到的 name/b64 要对，提示里要写清存到哪、和远端一致不一致 */
    await page.evaluate(() => { window.__calls = {}; });
    await clickButton(page, TEXT.btnDownload);
    await page.waitForTimeout(1500);
    out.download = {
      'toast': await toast(page),
      'bridgeCalls': await page.evaluate(() => window.__calls),
      'savedFile': await page.evaluate((txt) => {
        const f = window.__savedFile || null;
        if (!f) return null;
        const bin = atob(f.b64); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return { name: f.name, size: u.length, sha: f.sha, contentSame: new TextDecoder().decode(u) === txt };
      }, sample),
      'dialogsLeft': await dialogCount(page)
    };
    /* ③b 再点开：小窗里应多一行「已存到手机」 */
    await openSkill(page);
    out.afterSavedReopen = await readDialog(page);
    await closeDialog(page);

    /* ④ 编辑并回写：编辑框里是全文；改一行 → 回写（带打开时的 sha）→ 提示新 sha 与备份 */
    await openSkill(page);
    await clickButton(page, TEXT.btnEditAndWriteBack);
    await page.waitForTimeout(700);
    out.editDialog = await readDialog(page);
    await page.evaluate(() => { window.__calls = {}; });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      ta.value = ta.value + '新加的一行\n';
    });
    await clickButton(page, TEXT.btnWriteBack);
    await page.waitForTimeout(1600);
    out.writeBack = {
      'toast': await toast(page),
      'bridgeCalls': await page.evaluate(() => window.__calls),
      'writtenSkill': await page.evaluate(() => window.__wroteSkill || null),
      'dialogsLeft': await dialogCount(page)
    };

    /* ⑤ 没改就点回写：不该发请求 */
    await openSkill(page);
    await clickButton(page, TEXT.btnEditAndWriteBack);
    await page.waitForTimeout(700);
    await page.evaluate(() => { window.__calls = {}; });
    await clickButton(page, TEXT.btnWriteBack);
    await page.waitForTimeout(700);
    out.clickedWithoutEdit = { toast: await toast(page), bridgeCalls: await page.evaluate(() => window.__calls) };

    /* ⑥ 远端被别处改了：老表单再回写必须被拒（不静默覆盖） */
    await page.evaluate(() => { window.__skillSha = 'f'.repeat(64); });
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('#stage .hp-dialog')].pop();
      const ta = d.querySelector('textarea.sheet-area');
      ta.value = ta.value + '又改一行\n';
    });
    await page.evaluate(() => { window.__calls = {}; });
    await clickButton(page, TEXT.btnWriteBack);
    await page.waitForTimeout(1200);
    out.remoteChanged = { toast: await toast(page), dialogStillOpen: (await dialogCount(page)) > 0 };
    await closeDialog(page);

    /* ⑦ 读不到：如实提示，不弹空窗 */
    await page.evaluate(() => { window.__skillErr = true; });
    await page.evaluate(() => { document.querySelectorAll('#stage .hp-dialog').forEach((d) => d.remove()); });
    await page.evaluate(() => { window.__calls = {}; });
    await page.evaluate(() => document.querySelector('#tab-hermes [data-skill]').click());
    await page.waitForTimeout(900);
    out.unavailable = { toast: await toast(page), dialogCount: await dialogCount(page) };
    await page.evaluate(() => { window.__skillErr = false; });

    /* ⑧ 存不进手机：如实报错，不装成功 */
    await page.evaluate(() => { window.__saveFail = true; });
    await openSkill(page);
    await clickButton(page, TEXT.btnDownload);
    await page.waitForTimeout(1200);
    out.saveFailed = { toast: await toast(page), dialogStillOpen: (await dialogCount(page)) > 0 };
    await page.evaluate(() => { window.__saveFail = false; window.__saveShaMismatch = true; });
    await clickButton(page, TEXT.btnDownload);
    await page.waitForTimeout(1200);
    out.savedButMismatch = { toast: await toast(page) };
    await page.evaluate(() => { window.__saveShaMismatch = false; });
    await closeDialog(page);

    out.verdict = {
      'base64RoundTripSafe': out.roundTrip.same && out.roundTrip.empty,
      'sizeAndBody': out.parse.ok && out.parse.size === new TextEncoder().encode(sample).length && out.parse.bodySame,
      'badDataReported': out.parseBadData.ok === false && new RegExp(TEXT.unreadable).test(out.parseBadData.err),
      'dialogShowsSkillAndSource': !!out.dialog && out.dialog.heading === 'demo-skill' &&
        out.dialog.fields.some((f) => new RegExp(TEXT.remotePath).test(f.label) && /test\/demo-skill\/SKILL\.md/.test(f.value)) &&
        out.dialog.hasBody && /---/.test(out.dialog.bodyHead),
      'dialogShowsSizeAndSha': out.dialog.fields.some((f) => new RegExp(TEXT.sizeAndSha).test(f.label) && f.value.indexOf(String(out.dialogBytes) + ' 字节 · ' + sampleSha.slice(0, 12)) === 0),
      'dialogThreeActions': out.dialog.buttons.join('/') === '下载到手机/编辑并回写/关闭',
      'downloadSentRequest': (out.download.bridgeCalls['local.save'] || 0) === 1,
      'savedFileNameAndBody': !!out.download.savedFile && /^demo-skill\.md$/.test(out.download.savedFile.name) &&
        out.download.savedFile.contentSame && out.download.savedFile.size === new TextEncoder().encode(sample).length,
      'savedShaMatchesRemote': out.download.savedFile.sha === sampleSha,
      'downloadToastPathAndMatch': /Download\/hermes-skills\/demo-skill\.md/.test(out.download.toast) && new RegExp(TEXT.matchRemote).test(out.download.toast),
      'dialogClosedAfterDownload': out.download.dialogsLeft === 0,
      'reopenShowsSaved': !!out.afterSavedReopen && out.afterSavedReopen.fields.some((f) => new RegExp(TEXT.savedToPhone).test(f.label) && /Download\/hermes-skills/.test(f.value)),
      'editorHasFullText': !!out.editDialog && out.editDialog.hasEditor && /^---\nname: tmp-x/.test(out.editDialog.editorHead),
      'writeBackSentRequest': (out.writeBack.bridgeCalls['skill.write'] || 0) === 1,
      'writeBackShaIsOpened': !!out.writeBack.writtenSkill && out.writeBack.writtenSkill.path === 'test/demo-skill/SKILL.md',
      'writeBackContentEdited': !!out.writeBack.writtenSkill && new RegExp(TEXT.addedLine).test(out.writeBack.writtenSkill.text),
      'writeBackToastShaAndBackup': new RegExp(TEXT.writtenBack).test(out.writeBack.toast) && new RegExp(TEXT.newSha).test(out.writeBack.toast) && new RegExp(TEXT.backupSkill).test(out.writeBack.toast),
      'dialogClosedAfterWriteBack': out.writeBack.dialogsLeft === 0,
      'noChangeNoRequest': (out.clickedWithoutEdit.bridgeCalls['skill.write'] || 0) === 0 && new RegExp(TEXT.sameAsOpened).test(out.clickedWithoutEdit.toast),
      'remoteChangedRejectsOverwrite': new RegExp(TEXT.writeBackFailed).test(out.remoteChanged.toast) && new RegExp(TEXT.changed).test(out.remoteChanged.toast) && out.remoteChanged.dialogStillOpen === true,
      'unavailableNoEmptyDialog': new RegExp(TEXT.skillReadFailed).test(out.unavailable.toast) && out.unavailable.dialogCount === 0,
      'saveFailReported': new RegExp(TEXT.saveToPhoneFailed).test(out.saveFailed.toast) && out.saveFailed.dialogStillOpen === true,
      'mismatchNotSuccess': new RegExp(TEXT.saveToPhoneFailed).test(out.savedButMismatch.toast) && new RegExp(TEXT.mismatched).test(out.savedButMismatch.toast)
    };
    return out;
  }
};
