/* F-SESS-10 判据：主机指纹提示 + 「是不是每次连接都上传公钥」
 *
 * 用户的原话：「连接总是说新建立连接，是每次都会上传 key 还是什么原因」。
 * 这里把两件事分别**数出来**（不是"看着没事"）：
 *   ① 同一台**已信任**主机（known=true，同类型，指纹一致）连上来时，界面上不该有任何提示；
 *      首次 / 指纹变了 / 新密钥类型这三种，必须各弹一次确认框并各发一条通知。
 *   ② 密码登录的主机：第一次连接会调一次 `key.install`；装好并验证通过后主机被切成密钥登录，
 *      **第二次连接不该再调**。
 */
const fingerprint = 'SHA256:AbCdEf1234567890';

/* 期望文案（字符串字面量，只用来比对话框里有没有这些字样） */
const firstConnectHint = '首次连接';
const storedFingerprintHint = '已保存的指纹';

const push = (page, obj) => page.evaluate((o) => window.__push(o), obj);
const clearCalls = (page) => page.evaluate(() => { window.__calls = {}; });
const getCalls = (page) => page.evaluate(() => window.__calls || {});
const closeAllDialogs = (page) => page.evaluate(() => {
  const cancelLabel = '取消';
  const noLabel = '否';
  let n = 0;
  [...document.querySelectorAll('#stage .hp-dialog')].forEach((d) => {
    const btns = [...d.querySelectorAll('button')];
    const cancel = btns.find((b) => b.textContent.includes(cancelLabel) || b.textContent.includes(noLabel)) || btns[btns.length - 1];
    if (cancel) { cancel.click(); n++; }
  });
  return n;
});

export default {
  name: 'F-SESS-10 主机指纹提示 / 是否每次上传公钥',

  check: async (page) => {
    const out = {};
    await page.evaluate(() => {
      if (HP.App.closePanel) HP.App.closePanel();
      HP.App.hostId = 'h1';
      HP.App.host = { id: 'h1', name: '测试主机', host: '127.0.0.1', port: 22, user: 'lwgat', auth: 'key', keyId: 'k1' };
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
    });

    /* ① 已信任主机（指纹一致）：不该有任何提示 */
    await clearCalls(page);
    await push(page, { t: 'hostkey', host: '127.0.0.1', port: 22, algo: 'ssh-ed25519', fingerprint: fingerprint, storedFingerprint: fingerprint, known: true, changed: false, newType: false });
    await page.waitForTimeout(500);
    out.trustedHost = { calls: await getCalls(page), dialogs: await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length) };

    /* ② 首次连接（known=false）→ 弹框 + 一条通知 */
    await closeAllDialogs(page);
    await clearCalls(page);
    await push(page, { t: 'hostkey', host: '127.0.0.1', port: 22, algo: 'ssh-ed25519', fingerprint: fingerprint, storedFingerprint: '', known: false, changed: false, newType: false });
    await page.waitForTimeout(500);
    out.firstConnect = {
      'calls': await getCalls(page),
      'dialogText': await page.evaluate(() => { const d = [...document.querySelectorAll('#stage .hp-dialog')].pop(); return d ? d.textContent.replace(/\s+/g, ' ').slice(0, 90) : null; })
    };

    /* ③ 指纹变了 → 弹框 + 通知，文案要带"已保存的指纹" */
    await closeAllDialogs(page);
    await clearCalls(page);
    await push(page, { t: 'hostkey', host: '127.0.0.1', port: 22, algo: 'ssh-ed25519', fingerprint: 'SHA256:NEW999', storedFingerprint: fingerprint, known: true, changed: true, newType: false });
    await page.waitForTimeout(500);
    out.fingerprintChanged = {
      'calls': await getCalls(page),
      'dialogText': await page.evaluate(() => { const d = [...document.querySelectorAll('#stage .hp-dialog')].pop(); return d ? d.textContent.replace(/\s+/g, ' ').slice(0, 90) : null; })
    };

    /* ④ 新密钥类型 → 弹框 + 通知 */
    await closeAllDialogs(page);
    await clearCalls(page);
    await push(page, { t: 'hostkey', host: '127.0.0.1', port: 22, algo: 'ssh-rsa', fingerprint: 'SHA256:RSA123', storedFingerprint: '', known: true, changed: false, newType: true });
    await page.waitForTimeout(500);
    out.newKeyType = { calls: await getCalls(page), dialogs: await page.evaluate(() => document.querySelectorAll('#stage .hp-dialog').length) };
    await closeAllDialogs(page);

    /* ⑤ 密码登录的主机：连接两次，数 key.install 的次数
       （注意：connect() 会**重新从 host.list 取一次新鲜主机配置**，所以先把"密码登录"存回去） */
    await page.evaluate(async () => {
      const l = await HP.App.rpc('host.list');
      const h = l.find((x) => x.id === 'h1') || { id: 'h1' };
      Object.assign(h, { name: '测试主机', host: '127.0.0.1', port: 22, user: 'lwgat', auth: 'password', keyId: 'k1', startCmd: '' });
      await HP.App.rpc('host.save', { host: h });
      HP.App.host = h;
      window.__tmuxRaw = 'no server running on /tmp/tmux-1000/default\n';
    });
    await clearCalls(page);
    await page.evaluate(() => HP.App.connect('h1'));
    await page.waitForTimeout(2600);          // 装公钥是连接后 1.5s 触发
    const firstCalls = await getCalls(page);
    out.firstConnection = {
      'keyInstallCount': firstCalls['key.install'] || 0,
      'authAfterInstall': await page.evaluate(async () => { const l = await HP.App.rpc('host.list'); const h = l.find((x) => x.id === 'h1'); return h ? h.auth : '(没有主机)'; })
    };
    await clearCalls(page);
    await page.evaluate(() => HP.App.connect('h1'));
    await page.waitForTimeout(2600);
    const secondCalls = await getCalls(page);
    out.secondConnection = { keyInstallCount: secondCalls['key.install'] || 0 };

    out.verdict = {
      'trustedHostSilent': (out.trustedHost.calls['app.notify'] || 0) === 0 && out.trustedHost.dialogs === 0,
      'firstConnectAsks': (out.firstConnect.calls['app.notify'] || 0) >= 1 && String(out.firstConnect.dialogText || '').includes(firstConnectHint),
      'fingerprintChangeAsks': (out.fingerprintChanged.calls['app.notify'] || 0) >= 1 && String(out.fingerprintChanged.dialogText || '').includes(storedFingerprintHint),
      'newKeyTypeAsks': (out.newKeyType.calls['app.notify'] || 0) >= 1 && out.newKeyType.dialogs >= 1,
      'firstTimeInstallsKey': out.firstConnection.keyInstallCount === 1,
      'switchesToKeyAuth': out.firstConnection.authAfterInstall === 'key',
      'secondTimeNoInstall': out.secondConnection.keyInstallCount === 0
    };
    return out;
  }
};
