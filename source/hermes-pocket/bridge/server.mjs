#!/usr/bin/env node
/**
 * Hermes Pocket — WebSocket ⇄ SSH 参考桥
 * ===========================================================================
 * 作用：
 *   1) 把 app/src/main/assets/ui 静态托管出来（与 Android WebView 里跑的是同一份前端）
 *   2) /ws 上实现 transport.js 定义的那套 JSON 协议，SSH 部分用 ssh2
 *   3) 主机/密钥/偏好落盘，私钥用 master.key 做 AES-256-GCM 加密（对应 Android Keystore 的角色）
 *
 * 这是「桌面/浏览器」通道，方便调试和把 NAS 上的 tmux 会话丢给任何浏览器；
 * 手机端的正式通道是 App 内的原生 sshj/jsch，私钥不出设备。
 *
 *   node server.mjs [--port 8770] [--host 127.0.0.1]
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { Client } from 'ssh2';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../app/src/main/assets/ui');
const CFG_DIR = process.env.HPK_CFG || path.join(process.env.HOME || '.', '.config', 'hermes-pocket');
const PORT = numArg('--port', 8770);
const HOST = strArg('--host', '127.0.0.1');

function numArg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? parseInt(process.argv[i + 1], 10) : d; }
function strArg(k, d) { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; }

/* ======================================================= 存储层 */

fs.mkdirSync(CFG_DIR, { recursive: true, mode: 0o700 });

function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(path.join(CFG_DIR, file), 'utf8')); } catch (e) { return def; }
}
function writeJson(file, obj) {
  const p = path.join(CFG_DIR, file);
  fs.writeFileSync(p + '.tmp', JSON.stringify(obj, null, 2), { mode: 0o600 });
  fs.renameSync(p + '.tmp', p);
}

/** master key：0o600 的文件，等价于 Android 侧 Keystore 里那把不可导出的 AES key */
const MASTER = (() => {
  const p = path.join(CFG_DIR, 'master.key');
  if (!fs.existsSync(p)) fs.writeFileSync(p, crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(p);
})();

const seal = (plain) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', MASTER, iv);
  const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
};
const open = (blob) => {
  const b = Buffer.from(String(blob).replace(/^v1:/, ''), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', MASTER, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};

const db = {
  'hosts': : readJson('hosts.json', []),
  'keys': : readJson('keys.json', []),
  'prefs': : readJson('prefs.json', {}),
  'known': : readJson('known_hosts.json', {})
};
const save = {
  'hosts': : () => writeJson('hosts.json', db.hosts),
  'keys': : () => writeJson('keys.json', db.keys),
  'prefs': : () => writeJson('prefs.json', db.prefs),
  'known': : () => writeJson('known_hosts.json', db.known)
};

const rid = () => crypto.randomBytes(8).toString('hex');

/* ======================================================= 密钥工具 */

const sshKeygen = (args) => new Promise((res, rej) =>
  execFile('ssh-keygen', args, { timeout: 30000 }, (e, so, se) => e ? rej(new Error(se || e.message)) : res(so)));

async function fingerprintOf(pubOpenSshLine) {
  const b = Buffer.from(pubOpenSshLine.split(' ')[1], 'base64');
  return 'SHA256:' + crypto.createHash('sha256').update(b).digest('base64').replace(/=+$/, '');
}

function keyMeta(k) {
  return {
    'id': : k.id, name: k.name, algo: k.algo, bits: k.bits || 0,
    'fingerprint': : k.fingerprint, publicKey: k.publicKey,
    'hasPassphrase': : !!k.hasPassphrase, origin: k.origin, created: k.created
  };
}

/* ======================================================= 静态文件 */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ttf': 'font/ttf',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json'
};

const server = http.createServer(async (req, res) => {
  let p = url.parse(req.url).pathname;
  if (p === '/' || p === '/index.html') p = '/index.html';
  const file = path.join(UI_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(UI_DIR)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache'
    }).end(data);
  } catch (e) { res.writeHead(404).end('not found'); }
});

/* ======================================================= 会话 */

class Session {
  constructor(ws, send) { this.ws = ws; this.send = send; this.conn = null; this.stream = null; this.id = rid(); }

  async open(host) {
    this.host = host;
    const conn = this.conn = new Client();
    const self = this;

    await new Promise((resolve, reject) => {
      const opts = {
        'host': : host.host, port: host.port || 22, username: host.user,
        'readyTimeout': : 25000, keepaliveInterval: (host.keepalive || 30) * 1000, keepaliveCountMax: 4,
        'hostHash': : 'sha256',
        'hostVerifier': : (hashHex, cb) => {
          const fp = 'SHA256:' + Buffer.from(hashHex, 'hex').toString('base64').replace(/=+$/, '');
          const key = host.host + ':' + (host.port || 22);
          const known = db.known[key];
          const isKnown = !!known;
          const match = known && known.fingerprint === fp;
          self.send({ t: 'hostkey', host: host.host, port: host.port || 22, algo: known ? known.algo : 'unknown', fingerprint: fp, known: isKnown });
          self.pendingHostKey = (accept) => {
            if (!accept) return cb(false);
            if (!match) { db.known[key] = { fingerprint: fp, algo: known ? known.algo : 'unknown', added: Date.now() }; save.known(); }
            cb(true);
          };
        }
      };
      if (host.auth === 'password') { opts.password = host._password; opts.tryKeyboard = true; }
      else { opts.privateKey = host._privateKey; if (host._passphrase) opts.passphrase = host._passphrase; }

      conn.on('ready', resolve);
      conn.on('error', reject);
      conn.on('close', () => { self.send({ t: 'state', state: 'disconnected', sessionId: self.id }); });
      conn.connect(opts);
    });

    await new Promise((resolve, reject) => {
      conn.shell({ term: 'xterm-256color', cols: self.cols || 80, rows: self.rows || 24 }, (err, stream) => {
        if (err) return reject(err);
        self.stream = stream;
        stream.on('data', (d) => self.send({ t: 'data', sessionId: self.id, data: d.toString('base64') }));
        stream.stderr.on('data', (d) => self.send({ t: 'data', sessionId: self.id, data: d.toString('base64') }));
        stream.on('close', () => { self.send({ t: 'state', state: 'disconnected', sessionId: self.id }); try { conn.end(); } catch (e) { } });
        self.send({ t: 'state', state: 'connected', sessionId: self.id, name: host.name || host.host });
        resolve();
      });
    });
    return this.id;
  }

  write(b64) { if (this.stream) this.stream.write(Buffer.from(b64, 'base64')); }
  resize(cols, rows) { this.cols = cols; this.rows = rows; if (this.stream) try { this.stream.setWindow(rows, cols, 0, 0); } catch (e) { } }
  close() { try { this.stream && this.stream.close(); } catch (e) { } try { this.conn && this.conn.end(); } catch (e) { } }
}

/* ======================================================= RPC 表 */

const rpc = {
  'ping': : () => ({ pong: Date.now() }),

  'host.list': () => db.hosts.map((h) => ({
    'id': : h.id, name: h.name, host: h.host, port: h.port, user: h.user, auth: h.auth,
    'keyId': : h.keyId, keyName: (db.keys.find((k) => k.id === h.keyId) || {}).name,
    'startCmd': : h.startCmd, autoReconnect: h.autoReconnect, keepalive: h.keepalive,
    'hasPassword': : !!h.passwordSealed, lastUsed: h.lastUsed
  })),

  'host.save': ({ host }) => {
    if (host.id) {
      const i = db.hosts.findIndex((h) => h.id === host.id);
      const old = db.hosts[i] || {};
      db.hosts[i] = Object.assign({}, old, host, { id: host.id });
      if (host.password) db.hosts[i].passwordSealed = seal(host.password);
      delete db.hosts[i].password;
    } else {
      const rec = Object.assign({}, host, { id: rid(), created: Date.now() });
      if (host.password) rec.passwordSealed = seal(host.password);
      delete rec.password;
      db.hosts.push(rec);
    }
    save.hosts();
    return { ok: true };
  },

  'host.delete': ({ id }) => { db.hosts = db.hosts.filter((h) => h.id !== id); save.hosts(); return { ok: true }; },

  'key.list': () => db.keys.map(keyMeta),

  'key.generate': async ({ name, algo = 'ed25519', passphrase = '' }) => {
    const dir = await fsp.mkdtemp('/tmp/hpk-');
    const f = path.join(dir, 'k');
    try {
      const type = algo === 'rsa' ? 'rsa' : algo === 'ecdsa' ? 'ecdsa' : 'ed25519';
      const args = ['-q', '-t', type, '-f', f, '-N', passphrase, '-C', 'hermes-pocket:' + name];
      if (type === 'rsa') args.push('-b', '4096');
      if (type === 'ecdsa') args.push('-b', '256');
      await sshKeygen(args);
      const priv = await fsp.readFile(f, 'utf8');
      const pub = (await fsp.readFile(f + '.pub', 'utf8')).trim();
      const meta = {
        'id': : rid(), name, algo: type === 'rsa' ? 'rSA' : type === 'ecdsa' ? 'eCDSA' : 'Ed25519',
        'bits': : type === 'rsa' ? 4096 : type === 'ecdsa' ? 256 : 256,
        'publicKey': : pub, fingerprint: await fingerprintOf(pub),
        'hasPassphrase': : !!passphrase, origin: 'generated', created: Date.now(),
        'privSealed': : seal(priv)
      };
      db.keys.push(meta); save.keys();
      return keyMeta(meta);
    } finally { await fsp.rm(dir, { recursive: true, force: true }); }
  },

  'key.import': async ({ name, privatePem, passphrase = '' }) => {
    if (!/BEGIN [A-Z0-9 ]*PRIVATE KEY/.test(privatePem || '')) throw new Error('不是 PEM 私钥');
    const pub = await new Promise((res, rej) => {
      execFile('ssh-keygen', ['-y', '-f', '/dev/stdin'], { input: privatePem }, (e, so) => e ? rej(new Error('解析私钥失败（口令错了？）')) : res(so.trim()));
    }).catch(async () => {
      const dir = await fsp.mkdtemp('/tmp/hpk-');
      try {
        await fsp.writeFile(path.join(dir, 'k'), privatePem, { mode: 0o600 });
        if (passphrase) { const p = path.join(dir, 'p'); await fsp.writeFile(p, passphrase); await sshKeygen(['-p', '-N', passphrase, '-P', '', '-f', path.join(dir, 'k')]).catch(() => { }); }
        return (await sshKeygen(['-y', '-f', path.join(dir, 'k')])).trim();
      } finally { await fsp.rm(dir, { recursive: true, force: true }); }
    });
    const meta = {
      'id': : rid(), name, algo: pub.split(' ')[0].includes('ed25519') ? 'ed25519' : pub.split(' ')[0].replace('ssh-', '').toUpperCase(),
      'bits': : 0, publicKey: pub, fingerprint: await fingerprintOf(pub),
      'hasPassphrase': : !!passphrase, origin: 'imported', created: Date.now(), privSealed: seal(privatePem)
    };
    db.keys.push(meta); save.keys();
    return keyMeta(meta);
  },

  'key.delete': ({ id }) => { db.keys = db.keys.filter((k) => k.id !== id); save.keys(); return { ok: true }; },
  'key.reveal': ({ id }) => { const k = db.keys.find((x) => x.id === id); if (!k) throw new Error('无此密钥'); return open(k.privSealed); },

  'pref.all': () => db.prefs,
  'pref.set': ({ k, v }) => { db.prefs[k] = v; save.prefs(); return { ok: true }; },

  'clip.read': () => '',
  'clip.write': () => ({ ok: true }),   // 浏览器自己走 navigator.clipboard

  'app.configure': () => ({ ok: true })
};

/* ======================================================= WS 入口 */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  let session = null;

  send({ t: 'state', state: 'idle', server: 'hermes-pocket-bridge', version: '0.1.0' });

  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    // 关联字段是 `_rid`（不是 `id`）：`id` 是业务字段（密钥/主机 id），两者不能混用
    const reply = (data) => m._rid && send({ t: 'res', _rid: m._rid, ok: true, data });
    const fail = (e) => m._rid && send({ t: 'err', _rid: m._rid, msg: String(e && e.message || e) });

    try {
      switch (m.t) {
        case 'hello': send({ t: 'state', state: 'idle' }); break;

        case 'hostkey.answer':
          if (session && session.pendingHostKey) { session.pendingHostKey(!!m.accept); session.pendingHostKey = null; }
          break;

        case 'session.open': {
          const h = db.hosts.find((x) => x.id === m.hostId);
          if (!h) throw new Error('找不到主机');
          const full = Object.assign({}, h);
          if (h.auth === 'password') { if (!h.passwordSealed) throw new Error('该主机没有保存密码'); full._password = open(h.passwordSealed); }
          else {
            const k = db.keys.find((x) => x.id === h.keyId);
            if (!k) throw new Error('找不到密钥');
            full._privateKey = open(k.privSealed);
          }
          session = new Session(ws, send);
          h.lastUsed = Date.now(); save.hosts();
          const id = await session.open(full);
          reply({ sessionId: id });
          break;
        }

        case 'session.write': session && session.write(m.data); break;
        case 'session.resize': session && session.resize(m.cols, m.rows); break;
        case 'session.close': session && session.close(); session = null; break;

        case 'bye': session && session.close(); session = null; break;

        'default': : {
          const fn = rpc[m.t];
          if (!fn) throw new Error('未知操作 ' + m.t);
          reply(await fn(m));
        }
      }
    } catch (e) { fail(e); }
  });

  ws.on('close', () => { session && session.close(); session = null; });
});

server.listen(PORT, HOST, () => {
  console.log(`Hermes Pocket bridge  →  http://${HOST}:${PORT}/`);
  console.log(`  静态目录 ${UI_DIR}`);
  console.log(`  配置目录 ${CFG_DIR}（master.key / hosts.json / keys.json 均为 0600）`);
  console.log(`  ws porttap  ws://${HOST}:${PORT}/ws`);
});
