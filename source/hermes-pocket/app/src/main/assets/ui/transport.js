/* Hermes Pocket — 传输层
 * ===========================================================================
 * 同一套 JSON 协议跑在两种管道上：
 *   1) native  —— Android WebView 内的原生 SSH 客户端（WebMessagePort 或
 *                 @JavascriptInterface 桥），App 自己持有 TCP 连接和私钥；
 *   2) ws      —— WebSocket 到 bridge/server.mjs，用于桌面浏览器调试 / 把
 *                 NAS 上的 tmux 会话共享给任何浏览器。
 *
 * 协议（每条一个 JSON 对象，二进制的终端字节一律 base64）：
 *   上行  {t:"...", id?}            id 存在即期待一条 {t:"res", id} 应答
 *   下行  {t:"res", id, ok, data} | {t:"err", id, msg}
 *   事件  {t:"state"|"data"|"hostkey"|"metrics"|"title"|"log", ...}
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  /**
   * 稳健的布尔解析。偏好项和主机字段的布尔值可能来自三种写法：
   *   · 真布尔 true/false（设置面板的勾选框存的就是这个）
   *   · 字符串 'true'/'false'（旧数据、脚本写入、原生侧序列化）
   *   · 数字 1/0
   * 直接写 `!!pref('x', false)` 会在值是字符串 'false' 时判成 true ——
   * 设置项会「反着来」或干脆失灵，而且极难定位。一律走这里。
   */
  HP.truthy = function (v, def) {
    if (v === undefined || v === null || v === '') return !!def;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    return !!def;
  };

  /* ----------------------------------------------------------- base64 */

  const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64L = (() => { const t = new Int16Array(256).fill(-1); for (let i = 0; i < 64; i++) t[B64C.charCodeAt(i)] = i; return t; })();

  HP.b64encode = function (bytes) {
    let out = '';
    const n = bytes.length;
    for (let i = 0; i < n; i += 3) {
      const b0 = bytes[i], b1 = i + 1 < n ? bytes[i + 1] : 0, b2 = i + 2 < n ? bytes[i + 2] : 0;
      out += B64C[b0 >> 2] + B64C[((b0 & 3) << 4) | (b1 >> 4)] +
        (i + 1 < n ? B64C[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
        (i + 2 < n ? B64C[b2 & 63] : '=');
    }
    return out;
  };

  HP.b64decode = function (str) {
    const clean = str.replace(/[^A-Za-z0-9+/]/g, '');
    const n = clean.length;
    const out = new Uint8Array((n * 3) >> 2);
    let p = 0;
    for (let i = 0; i < n; i += 4) {
      const a = B64L[clean.charCodeAt(i)], b = B64L[clean.charCodeAt(i + 1)];
      const c = i + 2 < n ? B64L[clean.charCodeAt(i + 2)] : 0;
      const d = i + 3 < n ? B64L[clean.charCodeAt(i + 3)] : 0;
      out[p++] = (a << 2) | (b >> 4);
      if (i + 2 < n) out[p++] = ((b & 15) << 4) | (c >> 2);
      if (i + 3 < n) out[p++] = ((c & 3) << 6) | d;
    }
    return out.subarray(0, p);
  };

  HP.enc = new TextEncoder();
  HP.dec = new TextDecoder('utf-8');
  /** 把用户输入的 JS 字符串变成给 PTY 的 base64 */
  HP.b64FromText = (s) => HP.b64encode(HP.enc.encode(s));

  /* ------------------------------------------------------- transport 基类 */

  class Transport {
    constructor(name) {
      this.name = name;
      this.alive = false;
      this._seq = 0;
      this._pending = new Map();
      this._events = new Map();
      this.onState = null;      // (state, detail) => void
      this.onClose = null;      // () => void
    }

    /* --- 子类实现 --- */
    _open() { throw new Error('not implemented'); }
    _send(text) { throw new Error('not implemented'); }
    close() { }

    /* --- 公共 API --- */
    open() { this.alive = true; try { return this._open(); } catch (e) { this.alive = false; this._emit('error', { msg: String(e && e.message || e) }); throw e; } }

    send(obj) { if (this.alive) this._send(JSON.stringify(obj)); }

    /** 发一条请求并等应答 */
    rpc(type, payload, timeout = 12000) {
      const rid = ++this._seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this._pending.delete(rid); reject(new Error('超时: ' + type)); }, timeout);
        this._pending.set(rid, { resolve, reject, timer });
        // ⚠ 关联字段用 `_rid` 而不是 `id`：像 key.reveal / key.delete / host.delete 这类接口，
        //    载荷自己就带一个 `id`（业务字段，指密钥/主机 id）。两个命名空间混用会互相覆盖 ——
        //    写在前面会被业务 id 顶掉（请求认不出来，永远不回包，只能等超时）；
        //    写在后面又会把业务 id 顶掉（找不到对象）。所以关联字段必须独立命名。
        this.send(Object.assign({}, payload || {}, { t: type, _rid: rid }));
      });
    }

    on(type, fn) {
      if (!this._events.has(type)) this._events.set(type, []);
      this._events.get(type).push(fn);
      return this;
    }

    _emit(type, msg) {
      const hs = this._events.get(type);
      if (hs) for (const h of hs) { try { h(msg); } catch (e) { console.error(e); } }
    }

    /** 子类把收到的原始字符串喂进来 */
    _incoming(raw) {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg == null) return;

      if (msg._rid && (msg.t === 'res' || msg.t === 'err')) {
        const p = this._pending.get(msg._rid);
        if (!p) return;
        this._pending.delete(msg._rid);
        clearTimeout(p.timer);
        if (msg.t === 'err') p.reject(new Error(msg.msg || 'unknown error'));
        else p.resolve(msg.data);
        return;
      }
      if (msg.t === 'state') this.onState && this.onState(msg.state, msg);
      this._emit(msg.t, msg);
    }

    _die(detail) {
      if (!this.alive) return;
      this.alive = false;
      for (const [, p] of this._pending) { clearTimeout(p.timer); p.reject(new Error('连接已断开')); }
      this._pending.clear();
      this.onState && this.onState('disconnected', detail || {});
      this.onClose && this.onClose();
    }
  }

  /* ------------------------------------------- 1) Android 原生桥 */

  class NativeTransport extends Transport {
    constructor() {
      super('native');
      const wm = window.HermesPocket;                 // WebViewCompat.addWebMessageListener
      const ji = window.PocketNative;                 // @JavascriptInterface 兜底
      if (wm && typeof wm.postMessage === 'function') {
        this.mode = 'webmessage';
        this._wm = wm;
        wm.onmessage = (e) => this._incoming(typeof e.data === 'string' ? e.data : String(e.data));
      } else if (ji && typeof ji.send === 'function') {
        this.mode = 'jsi';
        this._ji = ji;
      } else {
        throw new Error('原生桥不可用');
      }
    }
    _open() { this.send({ t: 'hello', proto: HP.PROTO }); }
    _send(text) {
      if (this.mode === 'webmessage') this._wm.postMessage(text);
      else this._ji.send(text);
    }
    close() { try { this.send({ t: 'bye' }); } catch (e) { } this._die(); }
  }

  /** 原生侧主动回调（JavascriptInterface 模式用） */
  HP.recv = function (raw) { HP.transport && HP.transport._incoming(raw); };

  /* ------------------------------------------- 2) WebSocket 桥 */

  class WsTransport extends Transport {
    constructor(url) { super('ws'); this.url = url; this.ws = null; }
    _open() {
      const ws = this.ws = new WebSocket(this.url);
      ws.onopen = () => { this._opened = true; this.send({ t: 'hello', proto: HP.PROTO, client: 'web' }); };
      ws.onmessage = (e) => this._incoming(e.data);
      ws.onerror = () => this._emit('error', { msg: 'WebSocket 错误' });
      ws.onclose = (e) => this._die({ reason: 'socket closed', code: e.code });
    }
    _send(text) { if (this.ws && this.ws.readyState === 1) this.ws.send(text); }
    close() { this.alive = false; try { this.ws && this.ws.close(); } catch (e) { } }
  }

  /* ----------------------------------------------------------- 工厂 */

  HP.PROTO = 1;

  HP.createTransport = function (opts) {
    opts = opts || {};
    if (HP.hasNative()) return new NativeTransport();
    if (opts.wsUrl) return new WsTransport(opts.wsUrl);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return new WsTransport(proto + '//' + location.host + '/ws');
  };

  HP.hasNative = function () {
    const wm = window.HermesPocket, ji = window.PocketNative;
    return !!(wm && typeof wm.postMessage === 'function') || !!(ji && typeof ji.send === 'function');
  };

  HP.Transport = Transport;
})();
