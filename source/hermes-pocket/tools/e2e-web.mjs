#!/usr/bin/env node
/**
 * Hermes Pocket — 协议级端到端测试（不起浏览器/模拟器）
 * 覆盖：密钥导入 → 主机保存 → hostkey TOFU → 会话建立 → 输入回显 →
 *       window-change 生效（stty size）→ TUI 备用屏序列到达 → 断开
 *
 *   node tools/e2e-web.mjs            # 自行拉起 testsshd + bridge
 *   node tools/e2e-web.mjs --keep     # 保留现场（把 bridge 留在前台）
 */
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import WebSocket from '../bridge/node_modules/ws/index.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CFG = '/tmp/hpk-e2e-cfg';
const PORT = 8771;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail !== undefined && detail !== '' ? '   ' + detail : ''}`);
}

/* --------------------------------------------------------------- 环境 */

console.log('— 准备测试环境');

/* 护栏：记录宿主自己的 tmux 服务器状态。测试全程不允许它发生变化 ——
   裸 tmux 调用会打到同一个 socket，而 Hermes CLI 就住在 `tmux new -s hermes` 里。 */
const HOST_SOCK = `/tmp/tmux-${process.getuid ? process.getuid() : 1000}/default`;
const sockStat = () => { try { const s = fs.statSync(HOST_SOCK); return `${s.ino}:${s.ctimeMs}`; } catch (e) { return 'absent'; } };
const hostSockBefore = sockStat();

execFileSync(path.join(__dirname, 'testssh.sh'), ['start'], { stdio: 'inherit' });
const info = JSON.parse(execFileSync(path.join(__dirname, 'testssh.sh'), ['info'], { encoding: 'utf8' }));
fs.rmSync(CFG, { recursive: true, force: true });

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge', 'server.mjs'), '--port', String(PORT)], {
  'env': : Object.assign({}, process.env, { HPK_CFG: CFG }),
  'stdio': : ['ignore', 'pipe', 'pipe']
});
bridge.stdout.on('data', (d) => process.env.HPK_VERBOSE && process.stdout.write('[bridge] ' + d));
bridge.stderr.on('data', (d) => process.stderr.write('[bridge!] ' + d));
await sleep(900);

/* --------------------------------------------------------------- 客户端 */

class Client {
  constructor() { this.seq = 0; this.pending = new Map(); this.events = []; this.sid = null; }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
      this.ws.on('open', res);
      this.ws.on('error', rej);
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        this.events.push(m);
        if (m._rid && (m.t === 'res' || m.t === 'err')) {
          const p = this.pending.get(m._rid); if (!p) return;
          this.pending.delete(m._rid);
          m.t === 'err' ? p.rej(new Error(m.msg)) : p.res(m.data);
        }
        if (m.t === 'hostkey') this.onHostKey && this.onHostKey(m);
        if (m.t === 'data') this.sid = m.sessionId;
      });
    });
  }
  rpc(t, extra = {}, timeout = 15000) {
    const rid = ++this.seq;
    return new Promise((res, rej) => {
      const to = setTimeout(() => { this.pending.delete(rid); rej(new Error('超时 ' + t)); }, timeout);
      this.pending.set(rid, { res: (v) => { clearTimeout(to); res(v); }, rej: (e) => { clearTimeout(to); rej(e); } });
      // 关联字段用 `_rid` 而不是 `id`：`id` 是业务字段（密钥/主机 id），混用会互相覆盖
      this.ws.send(JSON.stringify(Object.assign({}, extra, { t, _rid: rid })));
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  /** 收齐一段时间的输出 */
  async collect(ms) { const t0 = this.events.length; await sleep(ms); return this.events.slice(t0); }
  out() { return this.events.filter((e) => e.t === 'data').map((e) => Buffer.from(e.data, 'base64').toString('utf8')).join(''); }
}

const c = new Client();
await c.connect();
console.log('— 协议流程');

/* 1. 导入密钥 */
const priv = fs.readFileSync(path.join(info.dir, 'clientEd25519'), 'utf8');
const key = await c.rpc('key.import', { name: 'e2e-client', privatePem: priv });
check('密钥导入', !!key.id && /Ed25519/i.test(key.algo), `${key.algo} ${key.fingerprint}`);
check('密钥列表回读指纹', (await c.rpc('key.list'))[0].fingerprint === key.fingerprint);

/* 2. 保存主机 */
await c.rpc('host.save', {
  'host': : { name: 'e2e-testsshd', host: '127.0.0.1', port: info.port, user: info.user, auth: 'key', keyId: key.id, keepalive: 10, autoReconnect: true }
});
const hosts = await c.rpc('host.list');
check('主机保存并回读', hosts.length === 1 && hosts[0].port === info.port);

/* 3. 建立会话 + TOFU */
let hostkeyEv = null;
c.onHostKey = (m) => { hostkeyEv = m; c.send({ t: 'hostkey.answer', fingerprint: m.fingerprint, accept: true }); };
const opened = await c.rpc('session.open', { hostId: hosts[0].id });
c.sid = opened.sessionId;
await sleep(1200);
check('会话建立', !!opened.sessionId, opened.sessionId);
check('hostkey 首次为未知并已信任', !!hostkeyEv && hostkeyEv.known === false, hostkeyEv && hostkeyEv.fingerprint);
check('known_hosts 已落盘', !!JSON.parse(fs.readFileSync(path.join(CFG, 'known_hosts.json'), 'utf8'))['127.0.0.1:' + info.port]);

/* 4. 输入回显 */
c.send({ t: 'session.write', sessionId: c.sid, data: Buffer.from('echo E2E_MARKER_$((20+22))\r').toString('base64') });
await sleep(1500);
check('命令回显 E2E_MARKER_42', c.out().includes('e2EMARKER_42'));

/* 5. window-change 真的生效 —— 用 tmux 自己报的尺寸作为独立口径
 *
 * ⚠ tmux 的 socket 是「按用户」的（/tmp/tmux-$UID/default），而测试 sshd 用的是
 *   同一个 uid/HOME。裸跑 `tmux` / `tmux kill-server` 会打到**宿主自己**的 tmux
 *   服务器上 —— 而 Hermes CLI 就跑在 `tmux new -s hermes` 里，结果就是 kill-server
 *   把当前会话连同工具调用一起 SIGHUP 掉。
 *    所以：测试里一切 tmux 调用必须带 -L <独立socket>，永不碰默认 socket。
 */
const TMUX = 'tmux -L hpk-e2e -f /dev/null';

c.send({ t: 'session.resize', sessionId: c.sid, cols: 97, rows: 41 });
await sleep(500);
c.events.length = 0;
c.send({ t: 'session.write', sessionId: c.sid, data: Buffer.from("stty size\r").toString('base64') });
await sleep(1200);
check('stty size 返回 41 97', /41 97/.test(c.out()), JSON.stringify(c.out().slice(-60)));

/* 6. 真 TUI：备用屏 + 鼠标模式序列 */
c.events.length = 0;
c.send({ t: 'session.write', sessionId: c.sid, data: Buffer.from("printf '\\033[?1049h\\033[?1002h\\033[?1006h'\r").toString('base64') });
await sleep(1200);
const raw = c.out();
check('TUI 备用屏序列 \\x1b[?1049h 到达前端', raw.includes('\x1b[?1049h'));
check('鼠标模式序列 \\x1b[?1002h/1006h 到达前端', raw.includes('\x1b[?1002h') && raw.includes('\x1b[?1006h'));

/* 7. 真 tmux（备用屏 + 真在画东西）—— 只动 -L hpk-e2e 这个独立 socket */
c.events.length = 0;
c.send({ t: 'session.write', sessionId: c.sid, data: Buffer.from(`${TMUX} new -As e2e "sleep 300"\r`).toString('base64') });
await sleep(3000);
const tm = c.out();
const plain = tm.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b[()][A-Z0-9]/g, '');
check('tmux 进入备用屏', tm.includes('\x1b[?1049h'));
check('tmux 隐藏光标（全屏 TUI 特征）', tm.includes('\x1b[?25l'));
check('tmux 真的绘制了状态栏（会话名 e2e 可见）', /\[e2e\]/.test(tm), JSON.stringify(plain.replace(/\s+/g, ' ').slice(0, 90)));

/* 独立口径验证「尺寸真的传到了远端」：从**宿主进程**（另一个会话、同一个隔离 socket）
   去问那个刚 attach 上来的 tmux 客户端自己的尺寸。
   detached 会话不继承 PTY 尺寸，所以只能这样问已 attach 的客户端。
   高度是 40 不是 41：tmux 的状态栏占掉一行，窗口高 = 客户端高 - 1。 */
let tmuxSize = '';
try {
  tmuxSize = execFileSync('tmux', ['-L', 'hpk-e2e', 'display', '-p', '-t', 'e2e', '#{window_width}x#{window_height}'], { encoding: 'utf8' }).trim();
} catch (e) { tmuxSize = 'ERR:' + e.message; }
check('远端 tmux 见到的窗口尺寸 = 97x40（97 宽 + 41 行减状态栏）', tmuxSize === '97x40', tmuxSize);

c.send({ t: 'session.write', sessionId: c.sid, data: Buffer.from(`${TMUX} kill-session -t e2e 2>/dev/null\r`).toString('base64') });
await sleep(800);

/* 8b. 载荷自带 id 的接口（回归）：关联字段若与业务字段同名会互相覆盖 */
const pem = await c.rpc('key.reveal', { id: key.id }, 15000).catch((e) => ({ err: e.message }));
check('key.reveal（载荷含业务 id）能拿到私钥', typeof pem === 'string' && /BEGIN/.test(pem),
  typeof pem === 'string' ? 'len=' + pem.length : 'err=' + pem.err);

/* 8. 密码永远不回传 */
const leak = JSON.stringify(hosts).match(/passwordSealed|"password"/);
check('host.list 不回传口令字段', !leak);

/* 9. 关闭 */
c.send({ t: 'session.close', sessionId: c.sid });
await sleep(500);
const state = c.events.filter((e) => e.t === 'state').map((e) => e.state);
check('关闭后进入 disconnected', state.includes('disconnected'), state.join(','));

/* 10. 护栏：宿主 tmux 服务器必须毫发无损 */
check('未触碰宿主 tmux 默认 socket', sockStat() === hostSockBefore, `${HOST_SOCK} ${hostSockBefore} → ${sockStat()}`);

/* 11. 清理隔离 socket（attach 之后 PTY 里是 tmux 的窗格，命令进不到 shell，
       所以从宿主侧关掉这个只属于测试的服务器） */
try { execFileSync('tmux', ['-L', 'hpk-e2e', 'kill-server']); } catch (e) { }
let leftover = '';
try { leftover = execFileSync('tmux', ['-L', 'hpk-e2e', 'list-sessions'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (e) { leftover = ''; }
check('测试 tmux 服务器已清干净', leftover === '', leftover);

/* --------------------------------------------------------------- 汇总 */

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 通过`);
if (bad.length) { console.log('失败项: ' + bad.map((b) => b.name).join(' | ')); }

if (process.argv.includes('--keep')) { console.log('保留现场，Ctrl-C 退出'); }
else { bridge.kill('sIGTERM'); }
process.exit(bad.length ? 1 : 0);
