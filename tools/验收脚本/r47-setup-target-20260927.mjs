/* R47 终端回车复测 · 建靶机通路（用 App 自己的 rpc；私钥不出示，只落公钥）
 * 跑法： node tools/ui-harness/dev-probe.mjs <本文件>
 * 结果：把新生成的公钥写进 /tmp/r47probe-sshd/authorized_keys（只打印指纹），并保存一条主机记录。
 */
import { execSync } from 'node:child_process';
export default {
  name: 'r47-setup-target',
  check: async (page) => {
    await page.waitForTimeout(800);
    const r = await page.evaluate(async () => {
      const A = window.HP.App;
      const out = {};
      try {
        const keys = await A.rpc('key.list');
        out.keysBefore = (keys || []).map((k) => ({ id: k.id, name: k.name, fp: (k.fingerprint || '').slice(0, 24), origin: k.origin }));
      } catch (e) { out.keysErr = String(e.message || e); }
      try {
        const meta = await A.rpc('key.generate', { name: 'r47probe', algo: 'ed25519', passphrase: '' }, 30000);
        out.gen = { fingerprint: meta.fingerprint, pubHead: String(meta.publicKey).slice(0, 24), pubTail: String(meta.publicKey).slice(-12), lines: String(meta.publicKey).split('\n').length };
        out.pubForFile = meta.publicKey;
      } catch (e) { out.genErr = String(e.message || e); }
      return out;
    });
    const out = { keysBefore: r.keysBefore, gen: r.gen, genErr: r.genErr, keysErr: r.keysErr };
    if (r.pubForFile) {
      const fs = await import('node:fs');
      const pem = String(r.pubForFile).trim();
      const ok = /^(ssh-ed25519|ssh-rsa|ecdsa-)/.test(pem);
      if (ok && !pem.includes('PRIVATE')) { fs.appendFileSync('/tmp/r47probe-sshd/authorized_keys', pem + '\n'); out.wroteAuthorized = true; }
      else out.wroteAuthorized = false;
      try { out.fpOfWritten = execSync(`ssh-keygen -lf /tmp/r47probe-sshd/authorized_keys`).toString().trim(); } catch (e) { out.fpOfWritten = String(e.message); }
    }
    // 保存主机记录：10.0.2.2:2222（模拟器到宿主 loopback 的固定地址）
    const saved = await page.evaluate(async () => {
      const A = window.HP.App;
      const keys = await A.rpc('key.list');
      const k = (keys || []).find((x) => x.name === 'r47probe');
      const hosts = await A.rpc('host.list').catch(() => []);
      const old = (hosts || []).find((h) => h.name === '靶机-r47');
      if (old) await A.rpc('host.delete', { id: old.id });
      const res = await A.rpc('host.save', { host: { name: '靶机-r47', host: '10.0.2.2', port: 2222, user: 'lwgat', auth: 'key', keyId: k ? k.id : '', startCmd: 'bash -l', keepalive: 30, autoReconnect: false } });
      const after = await A.rpc('host.list');
      return { hostSaveRes: res === undefined ? 'undefined' : res, hosts: (after || []).map((h) => ({ id: h.id, name: h.name, host: h.host, port: h.port, user: h.user, keyId: h.keyId, startCmd: h.startCmd })) };
    });
    Object.assign(out, saved);
    return out;
  }
};
