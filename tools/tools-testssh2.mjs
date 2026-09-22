#!/usr/bin/env node
/**
 * Hermes Pocket — 用于验证「公钥自动装到服务器」的假 SSH 服务器
 *
 * 为什么需要它：真 sshd 在这个环境里是 `PasswordAuthentication no`，也没法给系统账号设密码
 * （那是改用户账号，不该做）。而 ssh-copy-id 这条路必须走**密码认证**，
 * 所以这里用 Node 的 ssh2 起一个独立服务器：
 *   · 密码认证：固定口令
 *   · 公钥认证：读 `$HOME/.ssh/authorized_keys`（HOME 指向 /tmp 下的沙箱目录）
 *   · exec 通道：真的用 `sh -c` 在沙箱 HOME 里跑命令
 * 这样安装器写出来的 authorized_keys 能被这台服务器立刻用上，整条链路是真的。
 *
 * 用法: node tools/testssh2.mjs --port 2223 --home /tmp/hpk-fakehome --password TESTPASS-PLACEHOLDER
 */
import ssh2 from '../bridge/node_modules/ssh2/lib/index.js';
const { Server } = ssh2;
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = parseInt(get('--port', '2223'), 10);
const HOME = get('--home', '/tmp/hpk-fakehome');
const PASSWORD = get('--password', 'TESTPASS-PLACEHOLDER');
const USER = get('--user', 'lwgat');
const HOSTKEY = get('--hostkey', '/tmp/hpk-fakehome/host_ed25519');

fs.mkdirSync(HOME, { recursive: true });
if (!fs.existsSync(HOSTKEY)) {
  // ssh2 不认 Node crypto 导出的 PKCS8 ed25519 PEM，直接用 ssh-keygen 生成 OpenSSH 格式的主机密钥
  const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', HOSTKEY, '-C', 'hpk-testssh2'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('[testssh2] 生成主机密钥失败:', r.stderr || r.error);
    process.exit(4);
  }
}

const authKeysFile = path.join(HOME, '.ssh', 'authorized_keys');
const readAuthorized = () => {
  try { return fs.readFileSync(authKeysFile, 'utf8'); } catch (e) { return ''; }
};

const server = new Server({ hostKeys: [fs.readFileSync(HOSTKEY)] }, (client) => {
  console.log('[testssh2] 有客户端连入');
  let authedUser = null;

  client.on('authentication', (ctx) => {
    if (ctx.username !== USER) return ctx.reject(['password', 'publickey']);
    if (ctx.method === 'password') {
      if (ctx.password === PASSWORD) { authedUser = ctx.username; console.log('[testssh2] 密码认证通过'); return ctx.accept(); }
      console.log('[testssh2] 密码错误：收到 ' + (ctx.password === undefined ? 'undefined' : String(ctx.password).length + ' 字符') + '，期望 ' + PASSWORD.length + ' 字符');
      return ctx.reject(['password']);
    }
    if (ctx.method === 'publickey') {
      const dataB64 = ctx.key.data.toString('base64');
      const lines = readAuthorized().split('\n').filter((l) => l.trim());
      // 不同实现对 ctx.key.data 是否含算法前缀不一致，两种都比一遍
      const matched = lines.find((l) => {
        const b64 = (l.split(/\s+/)[1] || '');
        if (!b64) return false;
        if (b64 === dataB64) return true;
        try {
          const buf = Buffer.from(b64, 'base64');
          return buf.includes(ctx.key.data) || ctx.key.data.includes(buf);
        } catch (e) { return false; }
      });
      if (matched) {
        if (ctx.signature) { authedUser = ctx.username; console.log('[testssh2] 公钥认证通过'); return ctx.accept(); }
        return ctx.accept();   // 无签名 = 询问这把钥匙行不行，行就让它签名
      }
      console.log('[testssh2] 公钥不在 authorized_keys 里: algo=' + ctx.key.algo + ' data64=' + dataB64.slice(0, 24) +
        ' 已登记=' + lines.map((l) => (l.split(/\s+/)[1] || '').slice(0, 24)).join(','));
      return ctx.reject(['password', 'publickey']);
    }
    return ctx.reject(['password', 'publickey']);
  });

  client.on('ready', () => {
    console.log('[testssh2] 认证完成，会话就绪');
    client.on('session', (accept) => {
      const session = accept();
      // 必须接受 pty 请求：jsch 的 setPtyType 会发 pty-req，
      // 没人接就会被拒 → 客户端报 “failed to send channel request”
      session.on('pty', (acceptPty, rejectPty, info) => {
        console.log('[testssh2] pty-req', JSON.stringify(info));
        if (acceptPty) acceptPty();
      });
      session.on('window-change', (acceptWc) => { if (acceptWc) acceptWc(); });
      session.on('exec', (accept, reject, info) => {
        const stream = accept();
        console.log('[testssh2] exec:', info.command.slice(0, 90));
        const p = spawn('/bin/sh', ['-c', info.command], { env: { ...process.env, HOME, PATH: process.env.PATH || '/usr/bin:/bin' } });
        p.stdout.on('data', (d) => stream.stdout.write(d));
        p.stderr.on('data', (d) => stream.stderr.write(d));
        p.on('close', (code) => { stream.exit(code || 0); stream.end(); });
      });
      session.on('shell', (accept) => {
        const stream = accept();
        stream.write('testssh2 shell ready (HOME=' + HOME + ')\r\n$ ');
        stream.on('data', (d) => { if (String(d).trim() === 'exit') stream.exit(0), stream.end(); });
      });
    });
  });
  client.on('error', (e) => console.log('[testssh2] 客户端错误:', e.message));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[testssh2] 监听 127.0.0.1:${PORT}  用户=${USER}  密码=${PASSWORD}  HOME=${HOME}`);
  console.log(`[testssh2] authorized_keys = ${authKeysFile}（当前 ${readAuthorized().split('\n').filter((l) => l.trim()).length} 行）`);
});
