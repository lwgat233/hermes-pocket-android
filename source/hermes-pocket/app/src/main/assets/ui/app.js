/* Hermes Pocket — 主程序
 * ===========================================================================
 * 职责：终端实例、视口/软键盘适配、会话生命周期（含自动重连）、
 *       触摸手势 → 鼠标/滚动/平移、composer、面板与状态栏联动。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});
  const $ = (id) => document.getElementById(id);

  HP.FONT = '"JetBrainsMono Nerd Font","JetBrains Mono","Noto Sans Mono","DejaVu Sans Mono","Droid Sans Mono",monospace';

  /* —— 打包信息（由 tools/stamp-build.py 从 assets/build-info.json 盖进来，别手改这一段）—— */
  HP.BUILD = "unified-20260921c";
  HP.BUILDINFO = {"acceptance": "t-composer.mjs（14 条）+ 全部 20 个驱动", "appName": "Hermes Pocket", "builtAt": "2026-09-22 00:35 CST", "entry": "dev.hermes.pocket.MainActivity", "feature": "取消自动回车（写入不带 \\r；回车只由键条 ⏎ 显式发）", "featureId": "R-21,R-24", "note": "装上去先看设置面板「构建版本」这一行；本版起：输入框「写入」只把内容送进终端、不替用户按回车。", "packageId": "dev.hermes.pocket", "project": "hermes-pocket", "testVersion": "unified-20260921c"};
  /* —— 打包信息结束 —— */

  const THEME = {
    background: '#080c11', foreground: '#c8d3e0', cursor: '#1de9b6', cursorAccent: '#080c11',
    selectionBackground: '#264f4a',
    black: '#0b0f14', red: '#ff6b6b', green: '#33d17a', yellow: '#ffd166',
    blue: '#8ab4f8', magenta: '#c792ea', cyan: '#1de9b6', white: '#c8d3e0',
    brightBlack: '#5a6b7d', brightRed: '#ff8a8a', brightGreen: '#5be08f', brightYellow: '#ffe08a',
    brightBlue: '#a9c8ff', brightMagenta: '#dbb4f5', brightCyan: '#5df0cf', brightWhite: '#eaf1f8'
  };

  const App = {
    /* ---------------------------------------------------------- 状态 */
    transport: null, term: null, fit: null, watcher: null,
    sessionId: null, host: null, prefs: {},
    state: 'idle', panX: 0, panEnabled: false,
    reconnect: { timer: null, attempt: 0, active: false },
    ping: { timer: null, last: 0 },

    /* ======================================================= 启动 */

    async boot() {
      this.mark('开始');
      this.syncViewport();
      // ⚠ 次序很重要：**先建通道，再读偏好**。
      //   偏好全走 RPC（native 的 Store / bridge），通道没起来时 rpcRaw 直接 reject，
      //   以前这里先 loadPrefs() → 落进 catch → 只读 localStorage 那点兜底值 →
      //   每次冷启动**所有设置都回到默认**（字体、回滚缓冲、省电、通知开关…），
      //   而设置面板随后又从桥里读到真值 —— 面板显示的和终端实际生效的成了两回事。
      await this.connectTransport();
      this.mark('通道就绪');
      await this.loadPrefs();
      this.mark('偏好就绪');
      await loadTermFont(this);
      this.mark('字体就绪');

      this.watcher = new HP.TuiWatcher();
      // 注意签名：watcher 是 onChange(kind, watcher, data) —— 三个参数，别看错位
      this.watcher.onChange = (kind, _w, data) => this.onTermMode(kind, data);

      // 聊天状态机：状态一变就刷顶栏那一行字；压缩/结束在**前台**只弹个小提示（后台走通知）
      HP.ChatState.onchange = (s) => {
        this.renderChatState();
        if (!document.hidden && (s === '压缩中' || s === '已结束')) this.toast('聊天状态：' + s, 1800);
      };

      this.term = new Terminal({
        fontFamily: HP.FONT,
        fontSize: this.pref('fontSize', 13),
        lineHeight: 1.15,
        letterSpacing: 0,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: parseInt(this.pref('scrollback', 5000), 10),
        allowProposedApi: true,
        customGlyphs: true,
        drawBoldTextInBrightColors: true,
        convertEol: false,
        scrollOnUserInput: true,
        smoothScrollDuration: 0,
        rightClickSelectsWord: true,
        theme: THEME
      });
      this.fit = new FitAddon.FitAddon();
      this.term.loadAddon(this.fit);
      try { this.term.loadAddon(new Unicode11Addon.Unicode11Addon()); this.term.unicode.activeVersion = '11'; }
      catch (e) { console.warn('unicode11 不可用', e); }
      try { this.term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch (e) { }
      this.term.open($('termsizer'));
      this.mark('终端可显示');

      // 键盘输入也要受「Ctrl / Alt 锁定」影响 ——
      // 之前这里是无条件 `send(d)`，于是：点键条上的 Ctrl（亮起来）→ 在键盘上敲 b、d，
      // 发出去的是普通 `bd` 而不是 `C-b d`，tmux 的 detach 就永远按不出来，
      // 而且那个 Ctrl 会一直亮着不消。手机上没有硬件 Ctrl 键，这条路是唯一的办法。
      this.term.onData((d) => {
        const mods = HP.Keybar.mods;
        if (mods.ctrl || mods.alt) {
          // 一次送来多个字符（输入法候选）时，只对**第一个**字符套修饰键，其余原样发
          const head = d.slice(0, 1), rest = d.slice(1);
          this.send(HP.buildSeq(head, { ctrl: !!mods.ctrl, alt: !!mods.alt }) + rest);
          HP.Keybar.mods.ctrl = HP.Keybar.mods.alt = false;
          HP.Keybar.syncAll();
          return;
        }
        this.send(d);
      });
      this.term.onTitleChange((t) => this.setTitle(t));
      this.term.onResize(({ cols, rows }) => {
        $('tb-geom').textContent = cols + '×' + rows;
        if (this.sessionId) this.pushResize(cols, rows);
      });
      this.term.attachCustomKeyEventHandler((e) => {
        // 硬件键盘：Ctrl/Alt 组合交给 xterm 原生处理；只拦「Ctrl+Shift+V 粘贴」
        if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) { this.paste(); return false; }
        return true;
      });

      HP.Keybar.render({
        send: (d) => this.send(d),
        get appKeys() { return App.watcher && App.watcher.appKeys; },
        act: (a) => this.keyAction(a),
        focus: () => this.term.focus()
      });

      this.bindChrome();
      this.bindGestures();
      this.bindComposer();
      this.initTraffic();

      this.applySettings();
      this.resetGeometry();
      this.initViewport();
      // 命令是否跑完了（启发式）：每秒看一眼有没有"静下来且回到提示符"
      // 句柄存下来 —— 省电（息屏/后台）时要停掉，别让每秒一次的定时器把 CPU 拽醒
      this._tickTimer = setInterval(() => { try { this.trackCommandTick(); } catch (e) { } try { this.tickChatState(); } catch (e) { } }, 1000);
      this.initPower();

      // 通道已经在 boot 开头建好（那时才读得到偏好，见那里的注释）
      HP.Panels.load().then(() => { HP.Panels.renderAll(); this.mark('面板就绪'); this.bootReport(); });
      this.welcome();
    },

    /* ---------------------------------------------------------- 启动打点 */
    /* 用户报过「加载完 skill 之后还要等很久才出聊天界面」—— 没有读数就说不清那几秒花在哪。
       这里把启动各阶段的时间记下来（读的是 performance.now()，同一把尺子），
       `HP.BOOT` 里能直接读到；终端可显示**不等**面板与远端读取，那是"能开始打字"的时刻。 */
    mark(name) { (this._boot = this._boot || {})[name] = Math.round(performance.now()); },
    bootReport() {
      const b = this._boot || {};
      HP.BOOT = b;
      const ks = Object.keys(b);
      console.log('[boot] ' + ks.map((k) => k + '=' + b[k] + 'ms').join('  '));
      return b;
    },

    pref(k, def) { const v = this.prefs[k]; return v === undefined || v === '' ? def : v; },
    num(k, def) { const n = parseInt(this.pref(k, def), 10); return isNaN(n) ? def : n; },
    /** 布尔偏好：统一走 HP.truthy，别用 !!pref(...)（字符串 'false' 会被判成 true） */
    bool(k, def) { return HP.truthy(this.prefs[k], def); },

    /**
     * 改一条偏好 —— **全项目唯一的写入口**（界面、手势、对话框都走这里）。
     *
     * 为什么非要收在一处：以前设置面板改的是 `HP.Panels.prefs`、终端读的是 `App.prefs`，
     * 同一份设置两个真身 —— 改完**当场不生效**（字号那种就是），冷启动两边又各读各的。
     * 现在：内存里只有 App.prefs 一份，落盘只走 pref.set，派生动作（几何/键条/流量）统一在这里触发。
     */
    async setPref(k, v, opts) {
      const val = (v === undefined || v === null) ? '' : String(v);
      this.prefs[k] = val;
      try { await this.rpc('pref.set', { k, v: val }); }
      catch (e) { localStorage.setItem('hp.' + k, val); }   // 通道没起来时只兜底存本地
      if (HP.Panels && HP.Panels.syncPrefInputs) HP.Panels.syncPrefInputs(k);
      if (!opts || opts.apply !== false) this.applySettings();
      return val;
    },

    async loadPrefs() {
      try { this.prefs = (await this.rpcRaw('pref.all')) || {}; }
      catch (e) {
        this.prefs = {};
        HP.Panels.S.forEach((s) => {
          const v = localStorage.getItem('hp.' + s.k);
          if (v !== null) this.prefs[s.k] = s.type === 'bool' ? v === 'true' : v;
        });
      }
      HP.Geom.baseFont = this.num('fontSize', 13);
    },

    /* ======================================================= 视口 / 几何 */

    syncViewport() {
      const vv = window.visualViewport;
      const h = vv ? vv.height : window.innerHeight;
      const t = vv ? vv.offsetTop : 0;
      document.documentElement.style.setProperty('--vh', h + 'px');
      document.documentElement.style.setProperty('--vtop', t + 'px');
    },

    /**
     * 键条/输入框要**跟键盘动画同步**上浮，不能等。
     *
     * 做法：把「跟着键盘走」和「重排终端」拆开——
     *   · visualViewport 的 resize/scroll 每一帧都触发，回调里**只改 CSS 变量**（改个变量开销可忽略，
     *     不做任何布局查询）→ 键条当帧就跟着键盘动画上移，没有等待感；
     *   · 真正昂贵的 term.resize() 单独防抖，等键盘动画停下来再重排一次
     *     —— 否则每帧重排终端会卡成幻灯片。
     * 以前是 focus/blur 后 setTimeout 250ms 才动，所以肉眼能看到键条"先不动、过一会儿才跳上来"。
     */
    initViewport() {
      const vv = window.visualViewport;
      const follow = () => { this.syncViewport(); this.fitChrome(); this.scheduleGeometry(); };
      if (vv) {
        vv.addEventListener('resize', follow);
        vv.addEventListener('scroll', follow);   // 有些机型键盘弹出只报 scroll 不报 resize
      }
      window.addEventListener('resize', follow);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { this.syncViewport(); this.fitChrome(); this.resetGeometry(); this.pingOnce(); }
      });
      this.syncViewport();

      // ---- 看门狗：光靠事件不够 ----
      // 实测（WebView + CDP）存在这种情况：visualViewport.height 和 innerHeight 都变了，
      // 却**不派发任何 resize/scroll 事件**（vvResize=0, winResize=0）。
      // 那样 --vh 会一直是旧值，键盘弹起后键条就停在屏幕外 —— 用户看到的就是
      // 「界面不跟着刷新」和「推荐的键位消失了」。所以再加一层极轻的自检：
      // 每帧只读两个数字，变了才动布局（读数字开销可忽略，不做布局查询）。
      const watch = () => {
        const v = window.visualViewport;
        const h = v ? v.height : window.innerHeight;
        const t = v ? v.offsetTop : 0;
        if (this._lastVh === undefined || Math.abs(h - this._lastVh) > 0.5 || Math.abs(t - (this._lastVt || 0)) > 0.5) {
          this._lastVh = h; this._lastVt = t;
          this.syncViewport(); this.fitChrome();
          this.scheduleGeometry();          // 终端重排仍然防抖，避免每帧重排卡顿
        }
        this._watchRaf = requestAnimationFrame(watch);
      };
      this._lastVh = vv ? vv.height : window.innerHeight;
      this._lastVt = vv ? vv.offsetTop : 0;
      this._watchFn = watch;                  // 存下来：省电时可以取消，亮屏再续上
      this._watchRaf = requestAnimationFrame(watch);
    },

    /** 键盘动画期间连续触发时，只在它停下来之后重排一次终端 */
    scheduleGeometry(delay) {
      clearTimeout(this._geomT);
      this._geomT = setTimeout(() => { this.syncViewport(); this.fitChrome(); this.resetGeometry(); },
        delay === undefined ? 120 : delay);
    },

    /**
     * 进/出沉浸（全屏）模式 —— 只有这一个入口，进出都**强制重算几何**：
     * 顶栏/键条的显示状态一变，终端可用高度、列数行数、以及"点在哪儿算 chrome"全都跟着变；
     * 以前是调用点各自 `setTimeout(resetGeometry, 60)`，只算一拍，且顶栏高度是缓存的 ——
     * 用户报的"退出全屏后 ☰ 和上下滑动都没反应"就是这类过期状态最典型的表现。
     */
    toggleImmersive() {
      const on = !document.body.classList.contains('immersive');
      document.body.classList.toggle('immersive', on);
      this._chromeTop = null;                       // 缓存立刻作废
      [0, 120, 400].forEach((ms) => setTimeout(() => { try { this.resetGeometry(); } catch (e) { } }, ms));
      this.toast(on ? '沉浸模式：只留终端与输入框（返回键 / 长按终端菜单可退出）' : '已退出沉浸模式');
      return on;
    },

    resetGeometry() {
      if (!this.term) return;
      const g = HP.Geom.apply(this.term, this.fit, this.watcher);
      if (!g) return;
      this.panEnabled = g.pan;
      this.term.options.fontSize = g.fontSize;
      this.clampPan();
      // 顶栏高度缓存起来给 fitChrome 用（避免键盘动画期间每帧都去量）
      this._chromeTop = $('topbar').classList.contains('hidden') ? 0 : $('topbar').getBoundingClientRect().height;
      this.fitChrome();       // 空间不够时先保住键条，再去算几何
      // 超出屏幕时给个明确的记号，别让用户以为是显示坏了
      $('tb-geom').textContent = g.cols + '×' + g.rows + (g.pan ? ' ⟷' : '');
      $('tb-geom').title = g.pan
        ? `终端比屏幕宽 ${g.cols - (g.fitCols || g.cols)} 列，可左右滑动（长按终端 →「⇔ 窗口大小」可调）`
        : '终端宽度已适配屏幕';
      if (this.sessionId) this.pushResize(g.cols, g.rows);
    },

    /**
     * 只有尺寸**真的变了**才告诉远端。
     *
     * 重复发同一个尺寸的代价远不止一次 IPC：远端每收到一次 window-change 就会
     * 收到 SIGWINCH，TUI（tmux / Hermes / vim）要**整屏重画**一遍。
     * 实测点一次「发送」会连发 3 次 48×33（尺寸压根没变），
     * 用户看到的就是"点了发送之后终端要等一会儿才更新"。
     * 这里做一次去重，同一个 (会话, 列, 行) 只发一次。
     */
    pushResize(cols, rows) {
      if (!this.sessionId || !this.transport) return;
      const last = this._lastResize;
      if (last && last[0] === this.sessionId && last[1] === cols && last[2] === rows) return;
      this._lastResize = [this.sessionId, cols, rows];
      this.transport.send({ t: 'session.resize', sessionId: this.sessionId, cols, rows });
    },

    onTermMode(kind, data) {
      const w = this.watcher;

      // ---- 事件通知（在改布局之前先处理，和布局无关）----
      if (kind === 'bell') this.notifyEvent('bell', '终端响铃', (this.host ? (this.host.name || this.host.host) + ' · ' : '') + '远端发出了响铃（常见于命令跑完/出错）');
      else if (kind === 'notify' && data) this.notifyEvent('osc', data.title, data.body, true);
      else if (kind === 'cmdend' && data && this.busySince) {
        // 远端装了 OSC 133 shell 集成 → 精确知道命令结束与退出码
        const secs = Math.round((Date.now() - this.busySince) / 1000);
        const cmd = (this.busyCmd || '').slice(0, 80);
        this.busySince = 0; this.busyCmd = '';
        if (secs >= 3) {
          this.notifyEvent('done', `命令已完成（${secs} secs）`,
            (cmd ? '$ ' + cmd + '\n' : '') + ((data.code === null || data.code === undefined) ? '' : '退出码 ' + data.code));
        }
      }

      HP.Keybar.setTui(w.alt);
      // 进/出备用屏（TUI）时，滚动入口要跟着换（普通缓冲看行数，TUI 只能看"往外发了几格滚轮"）
      this.updateScrollChip();
      const badge = $('tb-badge');
      badge.classList.toggle('tui', w.alt);
      this.renderChatState();          // 顶栏一行字：模式 + 聊天状态（运行中/压缩中/已结束）
      this.resetGeometry();
    },

    /* ======================================================= 传输 / 会话 */

    async connectTransport() {
      const t = HP.createTransport();
      this.transport = t;
      t.onState = (s, m) => this.onState(s, m);
      t.onClose = () => this.onState('disconnected', {});
      t.on('data', (m) => this.onData(m));
      t.on('hostkey', (m) => this.onHostKey(m));
      t.on('metrics', (m) => {
        // 原生侧 socket 级计数（下行/上行/连接时长），详情对话框里和 JS 这份并列显示
        if (this.traffic) this.traffic.native = { down: m.bytesIn || 0, up: m.bytesOut || 0, uptimeMs: m.uptimeMs || 0 };
        if (m.rtt != null && $('tb-rtt')) $('tb-rtt').textContent = m.rtt + 'ms';
      });
      t.on('event', (m) => this.onEventLine(m.line || ''));
      t.on('eventstate', (m) => this.onEventState(m));
      try { t.open(); }
      catch (e) { this.toast('传输层不可用: ' + e.message); }
      // 这条只在**本次运行第一次**建通道时说 —— 每次连接都弹一句"通道就绪"就是噪声
      //（用户报的「连接总是说…」里，除了指纹提醒，这句也贡献了一部分）。
      if (!this._readySaid) {
        this._readySaid = true;
        this.toast(HP.hasNative() ? '原生 SSH 通道就绪' : 'WebSocket 通道就绪');
      }
    },

    rpcRaw(type, payload, timeout) {
      if (!this.transport || !this.transport.alive) return Promise.reject(new Error('传输未就绪'));
      return this.transport.rpc(type, payload, timeout);
    },
    rpc(type, payload, timeout) { return this.rpcRaw(type, payload, timeout); },

    onState(s, m) {
      this.state = s;
      const dot = $('dot');
      dot.className = s;
      if (s === 'connected') {
        this.reconnect.attempt = 0;
        this.stopReconnectCountdown();
        this.startPing();
        this.startEventChannel();     // 独立连接的文件事件通道（和终端会话互不影响）
        this.checkNotifyPermission(); // 没通知权限 = 通知被系统静默丢掉，必须主动提醒
        // 断线重连回来：走**同一条启动流程** —— 有 tmux 就 attach 回去（原会话原样还在），
        // 没有才建。以前是无脑重跑启动命令，会在原会话之外再建一个（用户 log 第 6 条点名要"有就不管"）。
        if (this._hadConnected && this.bool('rerunStartCmd', true)) {
          setTimeout(() => this.bootstrapSessions('重连'), 600);
        } else if (!this._hadConnected) {
          setTimeout(() => this.bootstrapSessions('首次连接'), 700);
        }
        this._hadConnected = true;
      } else if (s === 'connecting') {
        this.setTitle(m && m.name ? '连接 ' + m.name + '…' : '连接中…');
      } else if (s === 'reconnecting') {
        this.setTitle('重连中…');
      } else if (s === 'disconnected' || s === 'error') {
        this.stopPing();
        if (s === 'error') {
          dot.className = 'error';
          const msg = (m && m.msg) || '';
          this.toast('错误: ' + msg);
          // 连接失败要主动叫人：手机放在桌上时，"静默失败" = 回来只看到一片黑
          this.notifyEvent('attention', 'SSH 连接失败', `${this.host ? (this.host.name || this.host.host) : ''}\n${msg}`, true);
        } else {
          this.notifyEvent('conn', 'SSH 连接已断开', (this.host ? (this.host.name || this.host.host) : '') + '\n正在自动重连…');
        }
        this.scheduleReconnect();
      }
      if (s === 'connected' || s === 'connecting') this.writeHint(s, m);
    },

    /* ======================================== 终端事件通知（命令完成/需要授权） */

    /**
     * 统一出口。原生侧还会再按「App 是否在前台」过滤一次：
     * 用户正盯着屏幕时不弹通知（除非 urgent），放到桌上时才弹。
     */
    notifyEvent(kind, title, body, urgent) {
      const gate = {
        bell: 'notifyBell', osc: 'notifyOsc', done: 'notifyCommandDone',
        attention: 'notifyAttention', conn: 'notifyConn',
        // 文件事件通道：kind 带类型后缀，让同类事件在通知栏里**互相替换**而不是越堆越多
        'agent-auth': 'notifyAttention',      // 需要授权 → 沿用「需要授权」那个开关
        'agent-done': 'notifyAgent',
        'agent-info': 'notifyAgent'
      }[kind];
      if (gate && !this.bool(gate, kind !== 'conn')) return;
      if (!HP.hasNative()) return;
      this.rpc('app.notify', { kind, title, body: String(body || ''), urgent: !!urgent }, 8000)
        .then((r) => {
          // 前台时普通通知按设计**不发**（用户正看着屏幕，弹系统通知是噪音）——
          // 但"什么都不发生"会让人以为根本没通知：改成在应用内浮一条。
          if (r && r.posted === false && r.foreground && !urgent) {
            this.toast(String(title || '') + (body ? '：' + String(body) : ''), 3200);
          }
        })
        .catch(() => { });
    },

    /** 点通知回到 App：把终端滚到底、让画面对得上"刚发生的事" */
    onNotifyTap(kind) {
      this.scrollToBottom();
      this.toast('来自通知：' + kind);
      return 'ok';
    },

    /** 原生回调：用户在系统权限弹窗里选完了（授权成功就立刻自测一条） */
    onNotifyPermission(ok) {
      this.toast(ok ? '通知权限已授权 ✓' : '还没授权 —— 可在系统「设置 → 通知」里自己打开');
      if (ok) this.notifyEvent('test', '通知已就绪', '以后远端有事，我就这样叫你', true);
      try { HP.Panels.refreshNotifyState(); } catch (e) { }
      return 'ok';
    },

    /**
     * 通知权限自检。
     *
     * 没权限时系统的行为是**静默丢弃**（不报错），用户只会觉得"没收到" ——
     * 所以必须主动查、主动说清楚、并给一个一键去授权的入口。
     * @param interactive false 时只检查、不弹框
     * @returns 是否已授权
     */
    async checkNotifyPermission(interactive) {
      if (!HP.hasNative()) return true;
      const st = await this.rpc('app.notification.state').catch(() => null);
      if (!st || st.granted) return true;
      if (interactive === false) return false;
      const ok = await this.confirm(
        '还没有「通知」权限。\n\n' +
        '没有权限时，所有通知都会被系统**静默丢掉** —— 不报错、不提示，你只会觉得"没收到"。\n\n' +
        '现在去授权？',
        '去授权'
      ).catch(() => false);
      if (ok) this.rpc('app.permission.request').catch(() => { });
      return false;
    },

    /**
     * 命令耗时的**启发式**检测（不需要远端做任何配置）：
     *   用户按下回车 → 记为开始；输出静下来 2.5 secs && 末行像提示符 → 认为跑完；
     *   只有耗时超过 10 秒才通知（短命令不值得打扰）。
     * 远端若装了 OSC 133 shell 集成，那条路是**精确**的，会优先用。
     */
    trackCommandTick() {
      if (!this.busySince) return;
      if (this.watcher.alt) return;                      // TUI 里判断不了，交给 OSC/BEL
      const now = Date.now();
      const quiet = now - (this.lastDataAt || 0);
      const elapsed = now - this.busySince;
      if (quiet < 2500 || elapsed < 10000) return;
      const line = this.lastVisibleLine();
      if (!line || !/[$#%>]\s*$/.test(line)) return;      // 末行不像提示符 → 可能还在跑
      const secs = Math.round(elapsed / 1000);
      const cmd = (this.busyCmd || '').slice(0, 80);
      this.busySince = 0; this.busyCmd = '';
      this.notifyEvent('done', `命令已完成（${secs} secs）`, (cmd ? '$ ' + cmd + '\n' : '') + (line.trim().slice(0, 120) || ''));
    },

    lastVisibleLine() {
      const b = this.term.buffer.active;
      // 注意：不能只看缓冲**末尾**几行 —— clear 之后内容在顶部、下面全是空行，
      // 只看末尾就会拿到空串（这个坑在别的测试里也踩过）。
      // 从光标所在行往上找最后一行有内容的。
      const end = Math.min(b.length - 1, (b.baseY || 0) + (b.cursorY || 0));
      for (let i = end; i >= 0 && i > end - 80; i--) {
        const l = b.getLine(i);
        const s = l ? l.translateToString(true) : '';
        if (s.trim()) return s;
      }
      return '';
    },

    writeHint(s, m) {
      const w = this.watcher;
      if (s === 'connected' && w.title) this.setTitle(w.title);
    },

    async connect(hostId) {
      try {
        this.hostId = hostId;
        // 取一次**新鲜的**主机配置：面板缓存可能是旧的（刚在别处改过 startCmd / 密钥等），
        // 用旧数据会出现"明明配了启动命令却不执行"这种莫名其妙的现象。
        let h = null;
        try {
          const list = await this.rpc('host.list');
          h = (Array.isArray(list) ? list : (list && list.hosts) || []).find((x) => x && x.id === hostId) || null;
        } catch (e) { }
        this.host = h || (HP.Panels.hosts || []).find((x) => x && x.id === hostId);
        this._tuiScrollAsked = false;      // 新连接重新允许问一次"要不要开 tmux 鼠标"
        this._lastResize = null;           // 新会话的尺寸去重记录也要清掉
        this.resetTraffic();               // 流量统计也按会话重新开始（累计值保留）
        this.renderSeq = 0;                // 新会话：渲染水位归零
        this.rxSeq = 0;
        this._hadConnected = false;
        HP.Sessions.at = 0;              // 新连接：会话清单要重新读一遍
        // 传输层断过之后（网络掉线 / 远端重启 / 手动断开）对象还在但已经不活了：
        // 直接 rpc 只会得到「传输未就绪」，用户看到的就是"点了连接没反应"。
        // 这里先把它重新打开 —— 「🔌 重新连接」走的是同一条路，两个入口行为要一致。
        if (this.transport && !this.transport.alive) {
          try { this.transport.open(); } catch (e) { this.toast('传输层重开失败: ' + e.message); }
        }
        const r = await this.rpc('session.open', { hostId });
        this.sessionId = r.sessionId;
        this.reconnect.attempt = 0;
        this.setTitle((this.host && (this.host.name || this.host.host)) || hostId);
        // 「进哪个会话」交给启动流程（HP.Sessions.bootstrap，在 onState('connected') 里跑一次）：
        // 有 tmux 就不管它、直接 attach；没有才按主机的启动命令建。**永不 kill**。
        // 用密码登录成功后，顺手把公钥装到服务器（下次就能改用密钥登录）
        if (this.host && this.host.auth === 'password' && this.host.keyId && this.bool('autoInstallKey', true)) {
          setTimeout(() => this.installKeyToServer(true).catch(() => { }), 1500);
        }
      } catch (e) { this.toast('打开会话失败: ' + e.message); }
    },

    onData(m) {
      const bytes = HP.b64decode(m.data);
      // 亮屏补渲染期间收到的事件先攒着：必须**先渲染完落盘的那一段**，再放它们进来，
      // 否则顺序会乱（新数据插到旧数据前面）。
      if (this._flushBuf) { this._flushBuf.push(m); return; }
      this.renderChunk(bytes, m);
    },

    /** 把一段输出真正"渲染"出去（喂嗅探器 + 写 xterm + 记账 + 标记渲染到哪个 seq） */
    renderChunk(bytes, m) {
      // 嗅探必须在写入 xterm 之前，且要用解码后的文本
      const text = HP.dec.decode(bytes);
      // 聊天状态机的唯一输入：**真实渲染出来的文本**（解码一次，别重复解码）
      try { HP.ChatState.feed(text); } catch (e) { }
      this.watcher.feed(text);
      this.term.write(bytes);
      if (m && typeof m.seq === 'number' && m.seq > 0) this.renderSeq = m.seq;
      this.bytesIn = (this.bytesIn || 0) + bytes.length;
      // 下行统计：这里数的是"实际送进终端渲染的字节"。
      // 原生侧（Ssh.kt）另有一份 socket 级计数（跟着 metrics 事件过来）——
      // 两者之差就是回前台补发（环形缓冲 since）补了多少，详情里两个都列出来。
      if (this.traffic) { this.traffic.down += bytes.length; this.traffic.evt++; }
      // 记住渲染到哪一段了。切后台时 WebView 会被冻结，事件可能投递不到，
      // 回来就用这个 seq 找原生侧要漏掉的输出（Termux 永不丢输出，我们也得做到）。
      if (typeof m.seq === 'number' && m.seq > 0) this.rxSeq = m.seq;
      this.lastDataAt = Date.now();
      this.scheduleScrollChip();
    },

    /**
     * 回到前台：重新量视口与几何、把冻结期间漏掉的输出补上、补一次心跳。
     * 由原生 MainActivity.onResume 显式调用（WebView 的冻结状态不可靠，不能指望事件自己到）。
     */
    async onAppResume() {
      const v = window.visualViewport;
      this._lastVh = v ? v.height : window.innerHeight;   // 让看门狗重新对齐基准
      this._lastVt = v ? v.offsetTop : 0;
      this.syncViewport();
      this.fitChrome();
      this.scheduleGeometry(0);
      await this.resyncOutput();
      this.pingOnce();
      return 'resumed';
    },

    onAppPause() {
      this.pausedAt = Date.now();
      return 'paused';
    },

    /** 拉取原生侧环形缓冲里 seq 之后的输出并补渲染 */
    async resyncOutput(quiet) {
      if (!this.sessionId || !HP.hasNative()) return 0;
      let r;
      // 用**渲染水位**（renderSeq）而不是"收到的水位"：万一有些数据到了但没渲染
      //（比如省电期间、或事件投递失败），这里会把它们一起补上。
      try { r = await this.rpc('session.since', { from: this.renderSeq || 0 }, 8000); } catch (e) { return 0; }
      if (!r || !r.chunks || !r.chunks.length) return 0;
      let n = 0;
      for (const c of r.chunks) {
        if (!c || !c.data) continue;
        const bytes = HP.b64decode(c.data);
        this.renderChunk(bytes, c);
        n += bytes.length;
      }
      if (typeof r.seq === 'number') this.rxSeq = r.seq;
      if (!quiet) {
        if (r.lost) this.toast(`补回了 ${n} 字节输出（更早的部分已被缓冲覆盖）`);
        else this.toast(`补回了切后台期间漏掉的 ${n} 字节输出`);
      }
      return n;
    },

    /**
     * 竖向空间不够时**优先保住键条和终端**。
     *
     * 之前输入框最高 132px，加顶栏 40 + 键条 97 = 269px；键盘一弹起剩下的高度不够，
     * 就把键条整个挤出屏幕（实测可视高 240px 时键条底边在 281px，整条看不见）——
     * 用户看到的就是「推荐的键位有时候消失了」。键条是主要输入手段，必须最后被牺牲。
     */
    fitChrome() {
      if (!this.term) return;
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const top = this._chromeTop || ($('topbar').getBoundingClientRect().height);
      const kb = $('keybar').classList.contains('hidden') ? 0 : ($('keybar').getBoundingClientRect().height);
      const MIN_STAGE = 110;                      // 终端至少留这么多
      const ta = $('cinput'), cp = $('composer');
      if (cp.classList.contains('hidden')) { ta.style.maxHeight = ''; return; }
      const avail = vh - top - kb - MIN_STAGE;
      if (avail < 40) {
        // 实在没地方：收起输入框，保住键条（点「✎输入」随时能再打开）
        cp.classList.add('hidden');
        if (!this._cpAutoHidden) { this._cpAutoHidden = true; this.toast('空间不够，已收起输入框（键条优先）'); }
        return;
      }
      const cap = Math.min(132, Math.max(38, avail));
      if (ta.style.maxHeight !== cap + 'px') { ta.style.maxHeight = cap + 'px'; this.growComposer(); }
      // 空间回来了就把自动收起的输入框还回去
      if (this._cpAutoHidden && avail >= 60) {
        this._cpAutoHidden = false;
        cp.classList.remove('hidden');
      }
    },

    send(data) {
      if (!data) return;
      if (!this.sessionId) { this.toast('还没有连接'); return; }
      // 上行字节统计（发往远端的原始字节，按 UTF-8 算）
      if (this.traffic && typeof data === 'string') this.traffic.up += HP.enc.encode(data).length;
      // 命令耗时跟踪：按下回车视为"开始跑一条命令"（末行内容也记下来，通知里带上）
      if (data.indexOf('\r') >= 0 || data.indexOf('\n') >= 0) {
        this.busySince = Date.now();
        this.lastDataAt = Date.now();
        this.busyCmd = String(data).replace(/[\r\n].*$/s, '').trim();
      }
      this.transport.send({ t: 'session.write', sessionId: this.sessionId, data: HP.b64FromText(data) });
    },

    /* ------------------------------------------------ 自动重连 + 心跳 */

    scheduleReconnect() {
      // 原生模式下重连由 Kotlin 的 SshSession 负责（它能复用同一个 sessionId，
      // 且 WebView 被系统冻结时依然能自愈）。这里再排一次会变成两条连接打架。
      if (HP.hasNative()) { $('tb-badge').textContent = '原生层自愈中…'; return; }
      if (!this.host || !HP.truthy(this.host.autoReconnect, false)) return;
      if (this.reconnect.timer) return;
      const base = this.num('reconnectDelay', 3);
      const delay = Math.min(60, base * Math.pow(1.7, this.reconnect.attempt));
      this.reconnect.attempt++;
      let left = Math.round(delay);
      $('tb-badge').textContent = left + 's 后重连';
      this.reconnect.timer = setInterval(() => {
        left--;
        if (left <= 0) {
          clearInterval(this.reconnect.timer); this.reconnect.timer = null;
          $('tb-badge').textContent = '重连中…';
          this.reconnectNow();
        } else $('tb-badge').textContent = left + 's 后重连';
      }, 1000);
    },

    stopReconnectCountdown() {
      if (this.reconnect.timer) { clearInterval(this.reconnect.timer); this.reconnect.timer = null; }
    },

    async reconnectNow() {
      if (!this.transport) return;
      this.onState('reconnecting', {});
      try {
        if (!this.transport.alive) { this.transport.open(); }
        if (this.host) await this.connect(this.host.id);
      } catch (e) { this.scheduleReconnect(); }
    },

    startPing() {
      this.stopPing();
      this.ping.timer = setInterval(() => this.pingOnce(), 20000);
    },
    stopPing() { if (this.ping.timer) { clearInterval(this.ping.timer); this.ping.timer = null; } },
    async pingOnce() {
      if (this.state !== 'connected') return;
      const t0 = performance.now();
      try {
        await this.rpc('ping', {}, 8000);
        this.lastRtt = Math.round(performance.now() - t0);
        $('tb-rtt').textContent = this.lastRtt + 'ms';
      } catch (e) { /* 心跳失败由 state 事件兜底 */ }
    },

    /* ------------------------------------------------ 主机密钥校验 */

    onHostKey(m) {
      const title = `${m.host}:${m.port}`;
      // 「需要人来做决定」的提醒 —— 手机放桌上时必须能叫到人（前台时原生侧会自动抑制）。
      // ⚠ 这句**只能放在真要人决定的那些分支里**：以前它写在函数开头，于是**每次连接**（包括同一台
      //   已信任主机、指纹一致的情况）都会推一条「首次连接，需要确认主机指纹」——
      //   用户看到的就是「连接总是说新建立连接」（登记 R-10）。所以现在按分支发。
      const notifyAttention = (t) => this.notifyEvent('attention', t, `${title}\n${m.algo}\n${m.fingerprint}`);

      // ① 同一种密钥类型，但指纹和已存的不一样 —— 这才真的是「指纹变了」，要警惕
      if (m.changed) {
        const msg = `${title}\n密钥类型 ${m.algo}\n\n已保存的指纹：\n${m.storedFingerprint}\n\n` +
          `本次收到的指纹：\n${m.fingerprint}\n\n` +
          `同一类型的密钥指纹发生变化：可能是服务器重装/重建过主机密钥，\n` +
          `也可能真的有人在中间。确认是你自己换过服务器再继续。`;
        notifyAttention('主机指纹变了，需要你确认');
        this.confirm(msg, '更新指纹并重连').then((ok) => {
          this.transport.send({ t: 'hostkey.answer', fingerprint: m.fingerprint, accept: !!ok });
          if (ok) {
            this.toast('已更新指纹，正在重连…');
            setTimeout(() => this.connect(this.hostId), 250);
          } else {
            this.toast('已取消 —— 连接中止（指纹不匹配）');
          }
        });
        return;
      }

      // ② 已知主机，但服务器这次提供了「另一种密钥类型」—— 正常现象，不是警报。
      //    真实 SSH 也是每种类型各记一行；以前这里会被误判成「指纹发生变更」。
      if (m.newType) {
        const msg = `${title}\n\n这台主机你以前信任过，但服务器这次提供的是另一种密钥类型：\n${m.algo}\n` +
          `指纹 ${m.fingerprint}\n\n（例如以前是 ecdsa、现在是 ed25519，属于正常。）\n是否信任并记录这一种？`;
        notifyAttention('服务器提供了另一种密钥类型');
        this.confirm(msg, '信任并记录').then((ok) => {
          this.transport.send({ t: 'hostkey.answer', fingerprint: m.fingerprint, accept: !!ok });
          if (!ok) this.toast('已取消 —— 不记录这种密钥类型');
        });
        return;
      }

      // ③ 已知主机 + 同一密钥类型 + 指纹一致 → **连提醒都不发**（这才是"什么都不用问"）。
      //    留一条日志便于核对"这次到底走没走确认"。
      if (m.known) {
        console.log('[hostkey] 已知主机 · 指纹一致 · 无需确认', title, m.algo, m.fingerprint);
        return;
      }

      // ④ 全新主机：TOFU 首次
      notifyAttention('首次连接，需要确认主机指纹');
      const msg = `${title}\n算法 ${m.algo}\n指纹 ${m.fingerprint}\n\n首次连接，是否信任并记住？`;
      this.confirm(msg, '信任并保存').then((ok) => {
        this.transport.send({ t: 'hostkey.answer', fingerprint: m.fingerprint, accept: !!ok });
        if (!ok) this.toast('已取消 —— 不保存指纹');
      });
    },

    /** 清掉某台主机已保存的指纹（服务器重装过、想重新 TOFU 时用） */
    async forgetHostKey() {
      if (!this.host) { this.toast('先连一台主机'); return; }
      const key = `${this.host.host}:${this.host.port || 22}`;
      const keys = await this.rpc('hostkey.keys', { key }).catch(() => ({}));
      const lines = Object.keys(keys || {}).map((a) => `${a}\n  ${keys[a]}`).join('\n') || '（没有记录）';
      const ok = await this.confirm(`要忘掉 ${key} 已保存的主机指纹吗？\n\n现有记录：\n${lines}\n\n忘掉之后，下次连接会重新走「首次信任」。`, '忘掉');
      if (ok) {
        await this.rpc('hostkey.forget', { key }).catch(() => { });
        this.toast('已清除该主机指纹');
      }
    },

    /* ------------------------------------------------ 把公钥装到服务器（ssh-copy-id） */

    /**
     * 把当前主机的公钥追加到服务器的 ~/.ssh/authorized_keys。
     *
     * 原生侧装完会用**密钥真连一次**验证；只有验证通过才把主机切成密钥登录 ——
     * 否则万一没装上，用户就再也连不进去了。
     */
    async installKeyToServer(silent) {
      if (!this.host) { if (!silent) this.toast('先连一台主机'); return; }
      const keyId = this.host.keyId || '';
      if (!keyId) {
        if (!silent) this.toast('这台主机还没选密钥：长按主机 → 编辑 → 选一把密钥');
        return;
      }
      if (!silent) this.toast('正在把公钥装到服务器…（会重连一次去写入并验证）');
      let r;
      try { r = await this.rpc('key.install', { hostId: this.host.id, keyId }, 60000); }
      catch (e) { if (!silent) this.toast('安装失败: ' + e.message); return; }
      if (!r || !r.ok) { if (!silent) this.toast('安装失败: ' + ((r && r.msg) || '未知原因')); return; }

      if (r.verified && this.host.auth !== 'key') {
        // 验证通过 → 切成密钥登录
        const h = Object.assign({}, this.host, { auth: 'key', keyId });
        try { await this.rpc('host.save', { host: h }); } catch (e) { /* 切不过去也不影响已装好的公钥 */ }
        this.host = h;
        HP.Panels.load(true).then(() => HP.Panels.renderAll()).catch(() => { });
        this.notifyEvent('done', '公钥已装到服务器', `${h.name || h.host}\n已用密钥登录验证通过，主机已切换为密钥登录`);
        this.toast(r.added ? '公钥已装到服务器并验证通过，已切换为密钥登录' : '公钥本来就在服务器上，已切换为密钥登录');
      } else {
        this.notifyEvent('done', '公钥安装结果', (r.msg || '公钥已处理'));
        this.toast(r.msg || '公钥已处理');
      }
    },


    /**
     * 手动指定发给远端的 PTY 尺寸与字号 —— 不再只有 80/100/120/160 几个固定档位。
     * 自动模式在手机上会为了塞进 80 列而缩字号，嫌小就用这里直接钉死 cols/rows/字号。
     */
    openSizeDialog() {
      if (!this.term) return;
      const g = HP.Geom;
      const curCols = this.term.cols, curRows = this.term.rows, curFont = this.term.options.fontSize;
      const cl = (v, lo, hi, def) => { const n = parseInt(v, 10); return isNaN(n) ? def : Math.max(lo, Math.min(hi, n)); };
      const FMIN = HP.Geom.minFont, FMAX = HP.Geom.maxFont;   // 6 / 48，和设置面板、双指缩放同一套
      const back = document.createElement('div');
      back.className = 'hp-dialog';
      back.style.cssText = 'position:absolute;inset:0;background:rgba(4,8,12,.86);z-index:82;display:flex;align-items:center;justify-content:center;padding:16px';
      back.innerHTML = `<div class="card" style="max-width:440px;width:100%">
          <div class="sub" style="font-size:13px;color:var(--fg)">窗口大小（发给远端的 PTY 尺寸）</div>
          <div class="field"><label>列数 cols</label>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn" data-step="cols:-10">−10</button>
              <input id="sz-cols" type="number" min="20" max="400" value="${g.mode === 'fixed' ? g.fixedCols : curCols}" style="flex:1;text-align:center">
              <button class="btn" data-step="cols:10">＋10</button>
            </div></div>
          <div class="field"><label>行数 rows（0 = 跟随屏幕高度）</label>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn" data-step="rows:-3">−3</button>
              <input id="sz-rows" type="number" min="0" max="200" value="${g.mode === 'fixed' ? g.fixedRows : 0}" style="flex:1;text-align:center">
              <button class="btn" data-step="rows:3">＋3</button>
            </div></div>
          <div class="field"><label>字号 px</label>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn" data-step="font:-1">−</button>
              <input id="sz-font" type="number" min="${FMIN}" max="${FMAX}" value="${curFont}" style="flex:1;text-align:center">
              <button class="btn" data-step="font:1">＋</button>
            </div></div>
          <div class="sub" id="sz-info" style="font-family:var(--font-mono);font-size:11px;color:var(--fg-dim);white-space:pre-line"></div>
          <div class="btnrow">
            <button class="btn primary" data-y>应用</button>
            <button class="btn" id="sz-fit">适配屏幕宽度</button>
            <button class="btn" id="sz-auto">恢复自适应</button>
            <button class="btn" data-n>取消</button>
          </div></div>`;

      const el = (id) => back.querySelector('#' + id);
      const read = () => ({
        c: cl(el('sz-cols').value, 20, 400, curCols),
        r: cl(el('sz-rows').value, 0, 200, 0),
        f: cl(el('sz-font').value, FMIN, FMAX, curFont)
      });
      const info = () => {
        const v = read();
        const fit = HP.Geom.fitColsAt(this.term, this.fit, v.f);
        const over = v.c - fit;
        el('sz-info').textContent =
          `当前 ${this.term.cols}×${this.term.rows} / ${this.term.options.fontSize}px\n` +
          `屏幕在 ${v.f}px 字号下可容纳 ${fit} 列\n` +
          `将设为 ${v.c}×${v.r > 0 ? v.r : '自动'} / ${v.f}px　` +
          (over > 0 ? `⚠ 超出屏幕 ${over} 列，要左右滑动`
            : over < 0 ? `（比屏幕窄 ${-over} 列）` : '（正好铺满屏幕宽度）');
      };
      back.addEventListener('input', info);
      back.addEventListener('click', async (e) => {
        const st = e.target.getAttribute && e.target.getAttribute('data-step');
        if (st) {
          const [what, d] = st.split(':');
          const id = what === 'cols' ? 'sz-cols' : what === 'rows' ? 'sz-rows' : 'sz-font';
          const lim = what === 'cols' ? [20, 400] : what === 'rows' ? [0, 200] : [FMIN, FMAX];
          el(id).value = cl((parseInt(el(id).value, 10) || 0) + parseInt(d, 10), lim[0], lim[1], lim[0]);
          info(); return;
        }
        // 一键铺满屏幕宽度：不再超出屏幕、不需要左右滑动
        if (e.target.id === 'sz-fit') {
          const fit = HP.Geom.fitColsAt(this.term, this.fit, read().f);
          el('sz-cols').value = String(fit);
          info(); return;
        }
        if (e.target.id === 'sz-auto') {
          await this.applyManualGeom(0, 0, 0);
          back.remove(); this.toast('已恢复自适应'); return;
        }
        if (e.target.hasAttribute('data-y')) {
          const v = read();
          await this.applyManualGeom(v.c, v.r, v.f);
          back.remove();
          const fit = HP.Geom.fitColsAt(this.term, this.fit, v.f);
          this.toast(v.c > fit ? `窗口 ${v.c}×${v.r > 0 ? v.r : '自动'}（超出屏幕 ${v.c - fit} 列，可左右滑动）`
            : `窗口 ${v.c}×${v.r > 0 ? v.r : '自动'}，字号 ${v.f}px`);
          return;
        }
        if (e.target.hasAttribute('data-n')) back.remove();
      });
      $('stage').appendChild(back);
      info();
    },

    /** cols 传 0 → 恢复自适应；否则钉死 cols/rows/字号并立刻把 resize 发给远端 */
    async applyManualGeom(cols, rows, font) {
      const g = HP.Geom;
      const save = (k, v) => this.setPref(k, v, { apply: false });   // 统一写入口（顺手落盘）
      if (!cols) {
        // 恢复自适应：字号也要还原成「进手动模式之前」那个，别把手动设的小字号留着
        const back = this.num('fontSizeManualBackup', 13) || 13;
        g.mode = 'auto'; g.fixedRows = 0;
        this.prefs.geomMode = 'auto'; this.prefs.fixedRows = '0'; this.prefs.fontSize = String(back);
        delete this.prefs.fontSizeManualBackup;
        await save('geomMode', 'auto'); await save('fixedRows', 0);
        await save('fontSize', back); await save('fontSizeManualBackup', '');
        g.baseFont = back;
      } else {
        if (!this.prefs.fontSizeManualBackup) {
          // 记下进手动模式前的字号，供「恢复自适应」还原
          const prev = this.num('fontSize', 13);
          this.prefs.fontSizeManualBackup = String(prev);
          await save('fontSizeManualBackup', prev);
        }
        g.mode = 'fixed'; g.fixedCols = cols; g.fixedRows = rows || 0;
        this.prefs.geomMode = 'fixed';
        this.prefs.fixedCols = String(cols);
        this.prefs.fixedRows = String(rows || 0);
        this.prefs.fontSize = String(font);
        g.baseFont = font;
        await save('geomMode', 'fixed'); await save('fixedCols', cols);
        await save('fixedRows', rows || 0); await save('fontSize', font);
      }
      this.applySettings();       // 会把新的 cols/rows 通过 session.resize 发给远端
      this.resetGeometry();
    },

    /* ======================================================= 手势 */

    bindGestures() {
      const stage = $('stage'), panner = $('panner');
      const pts = new Map();

      // #ctxmenu / #overlay / 弹出的确认框都挂在 #stage 里，它们上面的事件会冒泡到
      // 下面的终端手势处理里。不挡住的话：点菜单项会被当成「点了终端」→ 触发 hideCtx()
      // 把菜单关掉，click 根本落不到按钮上（用户看到的就是「弹出来了但点不动」）。
      const inChrome = (t) => !!(t && t.closest && t.closest('#ctxmenu, #overlay, #toast, .hp-dialog'));
      let mode = null;          // 'tap' | 'menu' | 'pan' | 'scroll' | 'drag' | 'pinch'
      let start = null, moved = 0, longTimer = null, lastY = 0, lastX = 0, pinchStart = 0, fontStart = 0, scrollAcc = 0;
      let drag = null;

      const cell = () => {
        const s = this.term.element.querySelector('.xterm-screen');
        if (!s) return null;
        const r = s.getBoundingClientRect();
        return { left: r.left, top: r.top, w: r.width / this.term.cols, h: r.height / this.term.rows };
      };
      const at = (x, y) => {
        const c = cell(); if (!c) return { col: 0, row: 0 };
        return {
          col: Math.max(0, Math.min(this.term.cols - 1, Math.floor((x - c.left) / c.w))),
          row: Math.max(0, Math.min(this.term.rows - 1, Math.floor((y - c.top) / c.h)))
        };
      };
      const mouseOn = () => this.bool('touchMouse', true) && this.watcher.mouseMode > 0;

      const down = (e) => {
        if (inChrome(e.target)) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 1) {
          mode = 'tap'; moved = 0;
          start = { x: e.clientX, y: e.clientY, t: Date.now() };
          lastX = e.clientX; lastY = e.clientY;
          if (this.bool('longPressMenu', true)) {
            longTimer = setTimeout(() => {
              if (moved < 12 && pts.size === 1) { mode = 'menu'; this.termMenu(e.clientX, e.clientY); }
            }, 520);
          }
          if (mouseOn()) {
            const p = at(e.clientX, e.clientY);
            drag = { active: false, p };
          }
        } else if (pts.size === 2) {
          clearTimeout(longTimer);
          const [a, b] = [...pts.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          mode = dist > 60 ? 'pinch' : 'scroll';
          pinchStart = dist; fontStart = this.term.options.fontSize;
          lastY = (a.y + b.y) / 2;
        }
      };

      const move = (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (inChrome(e.target)) { pts.delete(e.pointerId); return; }

        if (pts.size === 1) {
          moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
          if (mode === 'tap' && moved > 12) {
            clearTimeout(longTimer);
            // 单指拖动按**主导方向**分流：
            //   竖向 → 滚动回看历史（和 Termux 一样，这是最常用的手势）
            //   横向 → 平移看超宽的内容，或给 TUI 发鼠标拖动
            // 以前竖向也被归到 pan/drag，导致单指根本没法向上翻看 —— 用户点名的缺陷。
            const dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
            if (dy > dx) {
              mode = 'scroll';
              scrollAcc = 0;
              lastY = e.clientY;
            } else {
              mode = mouseOn() ? 'drag' : (this.panEnabled ? 'pan' : 'tap');
            }
            if (mode === 'drag' && drag) {
              drag.active = true;
              const p = at(start.x, start.y);
              this.send(HP.mouseSeq(0, p.col, p.row, true, this.watcher.sgr, { ctrl: false }));
            } else if (mode === 'pan') start = { x: e.clientX, y: e.clientY };
          }
          if (mode === 'pan') {
            this.panBy(e.clientX - start.x);
            start.x = e.clientX;
          } else if (mode === 'scroll') {
            // 内容跟着手指走：手指往下拖 = 看更早的内容 = 视口往上滚
            scrollAcc += (e.clientY - lastY);
            const cell = this.cellH();
            let n = 0;
            while (scrollAcc >= cell) { n -= 1; scrollAcc -= cell; }
            while (scrollAcc <= -cell) { n += 1; scrollAcc += cell; }
            if (n) { this.doScroll(n); this.scheduleScrollChip(); }
            lastY = e.clientY;
          } else if (mode === 'drag' && drag) {
            const p = at(e.clientX, e.clientY);
            if (p.col !== drag.p.col || p.row !== drag.p.row) {
              this.send(HP.mouseSeq(32, p.col, p.row, true, this.watcher.sgr, {}));
              drag.p = p;
            }
          }
        } else if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          if (mode === 'pinch') {
            const dist = Math.hypot(a.x - b.x, a.y - b.y);
            const f = Math.round(Math.max(HP.Geom.minFont, Math.min(HP.Geom.maxFont, fontStart * (dist / (pinchStart || dist)))));
            if (f !== this.term.options.fontSize) { this.term.options.fontSize = f; this.prefs.fontSize = f; this.resetGeometry(); }
          } else {
            const y = (a.y + b.y) / 2;
            const dy = y - lastY;
            if (Math.abs(dy) > 6) {
              const lines = Math.trunc(-dy / this.cellH());
              if (lines) this.doScroll(lines);
              lastY = y;
            }
          }
        }
      };

      const up = (e) => {
        clearTimeout(longTimer);
        if (inChrome(e.target)) { pts.delete(e.pointerId); return; }
        const had = pts.delete(e.pointerId);
        if (!had) return;

        if (mode === 'tap' && moved < 12 && pts.size === 0) {
          const p = at(e.clientX, e.clientY);
          if (mouseOn()) {
            this.send(HP.mouseSeq(0, p.col, p.row, true, this.watcher.sgr, {}));
            this.send(HP.mouseSeq(0, p.col, p.row, false, this.watcher.sgr, {}));
          } else if (this.bool('tapKeyboard', false)) {
            // 放到下一拍再 focus：pointerup 之后浏览器还会按默认行为挪一次焦点（通常落到 body），
            // 当场 focus 会被它盖掉 —— 表现就是"开了开关也不弹"。
            this.wantKeyboard(true);
            setTimeout(() => { try { this.term.focus(); } catch (e) { } }, 0);
          } else {
            this.wantKeyboard(false);
            // 默认：单击终端**不弹键盘**（用户要能放心复制 / 长按 / 拖动）。
            // ① 以前这里是无条件 term.focus()，随手一点就被键盘盖掉半屏（用户点名的缺陷）；
            // ② 只判偏好还不够：xterm 的隐藏输入框会被浏览器自己点中（见 style.css 里那条 pointer-events），
            //    而且已经开着的键盘不会因为点终端而收起 —— 这里主动把焦点收回来。
            //    blur 只收键盘，**输入框里打了一半的字不会丢**。
            this.blurInputs();
          }
          this.hideCtx();
        }
        if (mode === 'drag' && drag && drag.active && pts.size === 0) {
          const p = at(e.clientX, e.clientY);
          this.send(HP.mouseSeq(0, p.col, p.row, false, this.watcher.sgr, {}));
          drag = null;
        }
        // 双指缩放结束：把字号**落盘**。以前只改了内存里的 prefs，重开 App 就回到默认字号
        // —— 用户说的「调了字体无效 / 保持不住」里就有这一条。
        if (mode === 'pinch') this.setPref('fontSize', this.term.options.fontSize, { apply: false });
        if (pts.size === 0) { mode = null; if (this.panEnabled) this.settlePan(); }
      };

      stage.addEventListener('pointerdown', down, { passive: true });
      stage.addEventListener('pointermove', move, { passive: true });
      // 焦点守卫：真手机的 WebView 在"触摸之后"还会主动把焦点给终端的隐藏输入框（pointer-events 挡不住它），
      // 结果就是点一下弹键盘。这里定死一条规矩：**没按 ⌨ 就不许它拿到焦点**，拿到了立刻收回去。
      try {
        this.term.textarea.addEventListener('focus', () => {
          if (this._kbdWanted) return;
          setTimeout(() => { try { this.term.textarea.blur(); } catch (e) { } }, 0);
        });
        this.wantKeyboard(false);      // 起步就是"不要键盘"（inputmode=none），别等第一次点终端才设
      } catch (e) { }
      stage.addEventListener('pointerup', up, { passive: true });
      stage.addEventListener('pointercancel', up, { passive: true });
      stage.addEventListener('contextmenu', (e) => { e.preventDefault(); });
      stage.addEventListener('wheel', (e) => { this.doScroll(-Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });
    },

    /** 一格文字的高度（滚动换算要用），拿不到就给个合理默认 */
    cellH() {
      const d = this.term && this.term._core && this.term._core._renderService
        ? this.term._core._renderService.dimensions : null;
      const h = d && d.css && d.css.cell && d.css.cell.height;
      return h && h > 4 ? h : 16;
    },

    /**
     * 「回到底部」胶囊：往上翻看历史时浮出来。
     * 终端里往上翻之后，新输出不会把你拉回底部（这是对的，xterm 也是这个行为），
     * 但必须给一条明显的路回去 —— 否则用户会以为"滚动卡住了"。
     */
    scheduleScrollChip() {
      clearTimeout(this._sbT);
      this._sbT = setTimeout(() => this.updateScrollChip(), 120);
    },
    updateScrollChip() {
      // 备用屏（TUI/tmux）里**本地没有历史**：`baseY - viewportY` 恒等于 0（实测 baseY=1），
      // 以前会照普通缓冲那样算出「上面还有 1 行」这种没用的字，而且给不出回程的路。
      // TUI 里只认一件事：我往外发过多少格滚轮（_tuiBack），据此给「回到最新」。
      if (this.watcher && this.watcher.alt) {
        let el = $('sb-chip');
        if (!this._tuiBack) { if (el) el.classList.add('hidden'); return; }
        if (!el) {
          el = document.createElement('button');
          el.id = 'sb-chip';
          el.className = 'sb-chip';
          el.addEventListener('click', (e) => { e.stopPropagation(); this.scrollToBottom(); });
          $('stage').appendChild(el);
        }
        el.textContent = '⇣ 回到最新（TUI 里已往上翻 ' + this._tuiBack + ' 格）';
        el.classList.remove('hidden');
        return;
      }
      const b = this.term.buffer.active;
      const up = b.baseY - b.viewportY;
      let el = $('sb-chip');
      if (!up) { if (el) el.classList.add('hidden'); return; }
      if (!el) {
        el = document.createElement('button');
        el.id = 'sb-chip';
        el.className = 'sb-chip';
        el.addEventListener('click', (e) => { e.stopPropagation(); this.scrollToBottom(); });
        $('stage').appendChild(el);
      }
      el.textContent = '⇣ 回到底部（上面还有 ' + up + ' 行）';
      el.classList.remove('hidden');
    },
    /** 一键回到最新：普通缓冲滚到底；TUI 里把之前发出去的滚轮**反向还回去**（tmux 自己会回到最新视图） */
    scrollToBottom() {
      if (this.watcher && this.watcher.alt) {
        const n = Math.min(this._tuiBack || 0, 40);
        if (!n) { this.toast('已经在最新了'); return; }
        const p = { col: Math.floor(this.term.cols / 2), row: Math.floor(this.term.rows / 2) };
        for (let i = 0; i < n; i++) this.send(HP.wheelSeq(false, p.col, p.row, this.watcher.sgr));
        this._tuiBack = 0;
        this.scheduleScrollChip();
        this.toast('已回到最新（往下发了 ' + n + ' 格）');
        return;
      }
      this.term.scrollToBottom();
      this.scheduleScrollChip();
      this.toast('已回到底部');
    },

    doScroll(lines) {
      const w = this.watcher;
      this.scheduleScrollChip();
      if (w.mouseMode > 0) {
        const p = { col: Math.floor(this.term.cols / 2), row: Math.floor(this.term.rows / 2) };
        const n = Math.min(6, Math.abs(lines));
        for (let i = 0; i < n; i++) this.send(HP.wheelSeq(lines < 0, p.col, p.row, w.sgr));
        // 记住「我在 TUI 里往上翻了几格」：TUI 本地没有历史，只能靠这个数给回程的入口
        this._tuiBack = Math.max(0, (this._tuiBack || 0) + (lines < 0 ? n : -n));
        this.scheduleScrollChip();
        return;
      }
      if (w.alt) {
        // 备用屏在**本地**是没有历史的（xterm 在 alt 屏不存 scrollback），
        // 唯一能滚的办法是把滚轮事件发给远端、由远端（tmux/分页器）自己滚。
        // 远端没开鼠标模式时滚轮事件无处可去 —— 这里不要只说"为什么"，
        // 直接给一条能一键解决的路（Android 13 起连 tmux 都能开鼠标）。
        if (!this._tuiScrollAsked) {
          this._tuiScrollAsked = true;
          this.confirm(
            'TUI（全屏界面）里没有本地历史可翻 —— 得让远端程序自己滚。\n\n' +
            '要我帮你开 tmux 鼠标吗？开了之后滑动/滚轮就能翻历史。\n' +
            '（less / htop / vim 这类本来就支持，不用开。）',
            '开启 tmux 鼠标'
          ).then((ok) => {
            if (ok) {
              this.send('tmux set -g mouse on\r');
              this.toast('已发送 tmux set -g mouse on —— 再滑一下试试', 2800);
            } else {
              this.toast('也可以点功能键条「⇞回滚」进 tmux 回滚模式，用 ↑↓ / PgUp 翻', 3000);
            }
          });
        }
        return;
      }
      this.term.scrollLines(lines);
    },

    panBy(dx) {
      const avail = $('panner').clientWidth;
      const screen = this.term.element.querySelector('.xterm-screen');
      const content = screen ? screen.clientWidth : avail;
      const max = Math.max(0, content - avail);
      if (!max) return;
      this.panX = Math.max(-max, Math.min(0, this.panX + dx));
      $('termhost').style.transform = 'translateX(' + this.panX + 'px)';
    },
    settlePan() { /* 预留：惯性滑动 */ },
    clampPan() {
      const avail = $('panner').clientWidth;
      const screen = this.term.element.querySelector('.xterm-screen');
      const content = screen ? screen.clientWidth : avail;
      const max = Math.max(0, content - avail);
      this.panX = Math.max(-max, Math.min(0, this.panX));
      $('termhost').style.transform = 'translateX(' + this.panX + 'px)';
    },

    /* ======================================================= 顶栏 / 菜单 */

    bindChrome() {
      $('btn-panel').addEventListener('click', () => this.openDrawer());
      $('btn-board-list').addEventListener('click', () => this.openDrawer());
      $('btn-drawer-close').addEventListener('click', () => this.closeDrawer());
      $('drawer-scrim').addEventListener('click', () => this.closeDrawer());
      // 顶栏的流量读数：点开详情（顺手把 RTT 刷新一下，metrics 事件会带最新计数）
      $('tb-traffic').addEventListener('pointerdown', (e) => { window.__hpKeepFocus = document.activeElement; e.preventDefault(); }, { passive: false });
      $('tb-traffic').addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const keep = window.__hpKeepFocus; window.__hpKeepFocus = null;
        this.openTrafficDialog();
        if (keep && keep.isConnected && document.activeElement !== keep) { try { keep.focus({ preventScroll: true }); } catch (er) { } }
      });
      $('btn-close-panel').addEventListener('click', () => this.closePanel());
      $('btn-immersive').addEventListener('click', () => this.toggleImmersive());
      $('btn-keys').addEventListener('click', () => {
        const kb = $('keybar');
        kb.classList.toggle('hidden');
        setTimeout(() => this.resetGeometry(), 60);
      });
      document.querySelectorAll('.tabs button').forEach((b) => {
        b.addEventListener('click', () => this.showBoard(b.dataset.tab));
      });
      document.addEventListener('pointerdown', (e) => {
        // 点在菜单里就不要关它 —— 触摸时 pointerdown 早于 click 触发，
        // 在这里无条件 hideCtx() 会让菜单项永远收不到 click（点了没反应）。
        if (e.target && e.target.closest && e.target.closest('#ctxmenu')) return;
        this.hideCtx();
      });
    },

    /* ---------------------------------------- 聊天输出状态（用户 log 第 12 条） */

    /**
     * 每秒推进一次状态机：**没有输出、且之前是"运行中/压缩中" → 判"已结束"**。
     * 状态只显示在顶栏（一行字）；要问"凭什么这么判"就用长按菜单里的「聊天状态」。
     */
    tickChatState() {
      const before = HP.ChatState.state;
      HP.ChatState.tick();
      if (HP.ChatState.state !== before) this.renderChatState();
    },

    /** 顶栏那一行字：模式 + 聊天状态（状态机的唯一显示处） */
    renderChatState() {
      const cs = HP.ChatState;
      const badge = $('tb-badge');
      if (badge) {
        const w = this.watcher ? this.watcher.describe() : '';
        const label = cs.label();
        badge.textContent = label ? (w ? w + ' · ' + label : label) : w;
        badge.title = cs.explain();
      }
      // 从"在跑/在压"掉到"已结束"：后台时给一条通知（前台不打扰，顶栏已经写着）
      if (this._lastChatState && this._lastChatState !== cs.state && cs.state === '已结束' &&
        this.bool('notifyChatState', true)) {
        this.notifyEvent('done', '聊天结束', cs.explain());
      }
      this._lastChatState = cs.state;
    },

    /* ======================================== 栏目抽屉（左侧隐藏栏）与板块 */

    /**
     * 启动流程（首次连接与断线重连都走它）：**先看远端有没有 tmux** ——
     * 有就 attach 回原会话（不新建、不重启、不杀），没有才按主机启动命令建。
    /* 会话专属的东西（输入条 + 选择键 + 发送键）：只在"当前会话"里出现，开左栏就藏起来 */
    sessionKeys(on) {
      ['tk-sayline', 'tk-saychips'].forEach((id) => {
        const e = document.getElementById(id);
        if (!e) return;
        e.style.display = on ? (id === 'tk-sayline' ? 'flex' : '') : 'none';
      });
    },

     * 读数与选择在「会话」栏目里（`#tab-sessions`）。
     */
    async bootstrapSessions(why) {
      const r = await HP.Sessions.bootstrap();
      const o = HP.Sessions;
      if (r.action === 'attach') this.toast((why || '') + '：回到会话 ' + r.name + '（远端原有 ' + r.count + ' 个，未动）', 2800);
      else if (r.action === 'create') this.toast((why || '') + '：远端没有 tmux，已新建会话 ' + r.name, 2800);
      else if (r.action === 'startCmd') this.toast((why || '') + '：已按主机启动命令进入会话', 2400);
      console.log('[sessions] 启动流程 ' + (why || '') + ' → ' + JSON.stringify(r) + '（会话数 ' + o.list.length + '）');
      HP.Panels.renderSessions();
      return r;
    },

    /**
     * 「☰」：列出**栏目**（左侧隐藏栏）。栏目由登记表 `HP.Registry` 生成 —— 加一个功能只改登记表，
     * 界面不手写栏目；没有归属 / 没挂上 / 没测的项在 `HP.Registry.check()` 里点名。
     */
    openDrawer() {
      HP.Panels.renderDrawer();
      $('drawer').classList.add('show');
      this.sessionKeys(false);   /* 开了左栏：会话里的输入条/键先收起来 */
      $('drawer-scrim').classList.remove('hidden');
      // 自检只是**开发用的**读数，不弹给用户：没连接时 Hermes 那几行本来就没渲染，
      // 以前会把"还没渲染"当成"栏目登记有问题"弹一条像错误的提示（用户报的 N-1 就是这个）。
      // 现在：没归属（登记表本身写错）才提示；没渲染的只进控制台。
      const r = HP.Registry.check();
      console.log('[registry] 自检', JSON.stringify(r));
      if (r.ungrouped.length) this.toast('栏目登记有问题：' + JSON.stringify(r.ungrouped));
    },
    closeDrawer() {
      $('drawer').classList.remove('show');
      this.sessionKeys(true);
      $('drawer-scrim').classList.add('hidden');
    },
    /**
     * 切到某个栏目 —— **只有这一处切换逻辑**（抽屉、程序跳转、隐藏的 .tabs 都走它，
     * 免得两处各写一遍然后有一处忘掉某个栏目）。
     * 特定栏目的远端读取也挂在这里，但**都不强制刷新**（要最新点页里的「刷新」）。
     */
    showBoard(tab) {
      document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
      document.querySelectorAll('.tabpage').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + tab));
      const board = (HP.Registry.boards || []).find((x) => x.tab === tab);
      const t = $('board-title');
      if (t && board) t.textContent = board.name;
      if (tab === 'hermes') HP.Panels.renderHermes();
      if (tab === 'sessions') HP.Panels.renderSessions();
      if (HP.Talk) { (tab === 'talk' || tab === 'group') ? HP.Talk.onShow(tab) : HP.Talk.onHide(); }
    },

    /** 选一个栏目 → 打开面板并切到它（.tabs 仍然存在，只是藏起来；程序里的跳转还照旧可用） */
    openBoard(id) {
      const b = HP.Registry.get(id);
      if (!b || b.status !== 'ready' || !b.tab) { this.toast('这个栏目还没做'); return; }
      HP.Registry.markRendered(id);        // 记一笔"这一栏渲染过了"（自检靠它分清"没渲染"和"挂不上"）
      this.closeDrawer();
      $('overlay').classList.remove('hidden');
      this.showBoard(b.tab);
      HP.Panels.load().then(() => HP.Panels.renderAll());
    },

    openPanel() { $('overlay').classList.remove('hidden'); HP.Panels.load().then(() => HP.Panels.renderAll()); },
    closePanel() { $('overlay').classList.add('hidden'); $('ctxmenu').classList.remove('show'); this.resetGeometry(); },

    /** 原生返回键先问这里：返回 true = 我处理了，false = 交给系统退出 */
    onBack() {
      if ($('ctxmenu').classList.contains('show')) { this.hideCtx(); return true; }
      // 动态弹出的确认框 / 明文查看层
      const extra = [...$('stage').children].filter((el) => !['panner', 'overlay', 'ctxmenu', 'toast'].includes(el.id));
      if (extra.length) { extra[extra.length - 1].remove(); return true; }
      if (!$('overlay').classList.contains('hidden')) { this.closePanel(); return true; }
      if (document.body.classList.contains('immersive')) { this.toggleImmersive(); return true; }
      return false;   // 交回原生 → 退出
    },

    ctxMenu(items) {
      const m = $('ctxmenu');
      m.innerHTML = '';
      items.forEach((it) => {
        const b = document.createElement('button');
        b.textContent = it.label;
        if (it.cls) b.className = it.cls;
        b.addEventListener('click', (e) => { e.stopPropagation(); this.hideCtx(); it.fn && it.fn(); });
        m.appendChild(b);
      });
      m.classList.add('show');
      const bar = $('topbar').offsetHeight;
      m.style.left = '10px';
      m.style.top = (bar + 8) + 'px';
      m.style.maxHeight = (window.innerHeight - bar - 40) + 'px';
    },
    hideCtx() { $('ctxmenu').classList.remove('show'); },

    termMenu(x, y) {
      const items = [
        { label: (document.activeElement === this.term.textarea ? '⌨ 收起键盘' : '⌨ 打开键盘'), fn: () => this.toggleKeyboard() },
        { label: '✎ 打开输入框（长文本/中文）', fn: () => this.keyAction('composer') },
        { label: 'ℹ 聊天状态（为什么这样判）', fn: () => this.toast(HP.ChatState.explain(), 4200) },
        { label: '⤓ 粘贴', fn: () => this.paste() },
        { label: '⇣ 回到底部 / 最新', fn: () => this.scrollToBottom() },
        { label: '⎘ 复制选中', fn: () => { const s = this.term.getSelection(); if (s) this.copy(s); else this.toast('没有选中内容'); } },
        { label: '▤ Hermes 快捷命令', fn: () => this.keyAction('hermes') },
        { label: '⛶ 沉浸模式', fn: () => this.toggleImmersive() },
        { label: '📊 流量统计（下行/上行）', fn: () => this.openTrafficDialog() },
        { label: '📡 事件通道（重启/查看）', fn: () => { this.toast('事件通道：' + (this.eventState || 'idle') + '（已收 ' + (this.eventSeen || 0) + ' 条）'); this._evWelcomed = false; this.startEventChannel(); } },
        { label: '🔔 通知自检（权限 / 测试通知）', fn: async () => {
            const ok = await this.checkNotifyPermission();
            if (!ok) return;
            const r = await this.rpc('app.notify', { kind: 'test', title: '测试通知', body: '看到这条就说明通知没问题', urgent: true }).catch(() => null);
            this.toast(r && r.posted ? '已发出测试通知（去看通知栏）' : '没发出去（被前台抑制或节流）');
          } },
        { label: '⇔ 窗口大小 / 字号…', fn: () => this.openSizeDialog() },
        { label: '⬆ 把公钥装到服务器', fn: () => this.installKeyToServer() },
        { label: '🔑 忘掉本机指纹', fn: () => this.forgetHostKey() },
        { label: '🔌 重新连接', fn: () => this.reconnectNow() },
        { label: '⚙ 设置', fn: () => this.openBoard('settings') }
      ];
      this.ctxMenu(items);
    },

    keyAction(a) {
      if (a === 'kbd') { this.toggleKeyboard(); return; }
      if (a === 'more') { HP.Keybar.toggleMore(); setTimeout(() => this.resetGeometry(), 60); return; }
      if (a === 'copyMode') { this.enterCopyMode(); return; }
      if (a === 'composer') { this.toggleComposer(true); return; }
      if (a === 'paste') { this.paste(); return; }
      if (a === 'hermes') {
        this.ctxMenu(HP.Hermes.quick.map((q) => ({
          label: q.label, fn: () => { this.send(q.send); this.toast('已发送: ' + q.label); }
        })));
        return;
      }
    },

    /* ============================================== 文件事件通道（独立 SSH） */

    /**
     * 另开一条 SSH 连接盯着服务端 home 下的**只追加文件**（`tail -F`），
     * 新增一行就调起**手机系统通知**。
     *
     * 服务端约定（见 `~/HERMES-POCKET-EVENTS.md`）：一行一条，`kind: 标题 | 正文`，
     * kind ∈ {auth, done, info}。auth 表示"在等你授权/输入"，按紧急事件处理（前台也打扰）；
     * done 表示"做完了"。格式认不出来也不会丢 —— 整行当正文发一条普通通知。
     */
    async startEventChannel() {
      if (!HP.hasNative() || !this.hostId) return;
      if (!this.bool('eventChannel', true)) return;
      const path = this.pref('eventFile', '~/hermes-pocket-events.log');
      try {
        await this.rpc('events.start', { hostId: this.hostId, path }, 25000);
        this.eventOn = true;
      } catch (e) {
        this.eventOn = false;
        this.onEventState({ state: 'error', msg: e.message, path });
      }
    },

    stopEventChannel() {
      if (!this.eventOn) return;
      this.eventOn = false;
      this.rpc('events.stop', {}, 8000).catch(() => { });
    },

    onEventState(m) {
      this.eventState = m.state || 'idle';
      const txt = {
        idle: '未启动', connecting: '连接中…', watching: '监听中', retry: '重连中…',
        error: '出错', stopped: '已停止'
      }[this.eventState] || this.eventState;
      const el = $('ev-state');
      if (el) el.textContent = txt + (this.eventState === 'watching' ? ' · ' + (m.path || '') : '');
      if (this.eventState === 'watching' && !this._evWelcomed) {
        this._evWelcomed = true;
        this.toast('事件通道已连接：' + (m.path || ''));
      }
      if (this.eventState === 'error') {
        const now = Date.now();
        if (now - (this._evErrAt || 0) > 15000) {           // 报一次就够，别刷屏
          this._evErrAt = now;
          this.toast('事件通道出错：' + (m.msg || ''));
        }
      }
    },

    /**
     * 解析一行事件。格式故意做得"手写友好"：
     *   auth: 需要你来点确认 | 远端在等你输入 sudo 密码
     *   done: 构建完成 | hermes-pocket 调试包已生成
     *   info: 只是提醒一句
     */
    parseEventLine(line) {
      const raw = String(line || '').trim();
      let kind = 'info', rest = raw;
      const m = /^([a-zA-Z]+)\s*[:：]\s*([\s\S]*)$/.exec(raw);
      if (m && ['auth', 'ask', 'done', 'info'].includes(m[1].toLowerCase())) {
        kind = m[1].toLowerCase(); rest = m[2];
      }
      const i = rest.indexOf('|');
      const title = (i >= 0 ? rest.slice(0, i) : rest).trim() || '远端事件';
      const body = (i >= 0 ? rest.slice(i + 1) : '').trim();
      return { kind: kind === 'ask' ? 'auth' : kind, title, body, raw };
    },

    onEventLine(line) {
      if (!line) return;
      const e = this.parseEventLine(line);
      this.eventSeen = (this.eventSeen || 0) + 1;
      this.lastEvent = e;
      const urgent = e.kind === 'auth';
      // 调起手机系统通知：auth = 需要授权（穿透前台），其余按普通事件
      this.notifyEvent('agent-' + (urgent ? 'auth' : (e.kind === 'done' ? 'done' : 'info')),
        e.title, e.body || e.raw, urgent);
    },

    /* ================================================================ 省电 */

    /**
     * 省电板块。
     *
     * 核心取舍：**省电 ≠ 断连**。
     *   · 待机耗电的大头是「一直握着 CPU 唤醒锁」和「每秒 / 每 20 秒的定时器反复把 CPU 拽醒」；
     *   · TCP 连接本身不要钱 —— socket 由内核维持着，我们只要停掉"自己花 CPU 的那些活"；
     *   · 亮屏回来第一件事：用既有的环形缓冲（session.since）把睡着期间漏掉的输出补回来。
     * 结果就是息屏一整夜再亮屏：连接还在、输出不丢、电也省了。
     */
    initPower() {
      this._powerSave = false;
      document.addEventListener('visibilitychange', () => this.onVisibilityChange());
      this.refreshPowerState();
    },

    /** off | screenOff | background */
    powerMode() { return this.pref('powerSave', 'screenOff'); },

    onVisibilityChange() {
      if (!document.hidden) {
        clearTimeout(this._psT);
        if (this._powerSave) this.applyPowerSave(false, '亮屏');
        else this.refreshPowerState();
        return;
      }
      const mode = this.powerMode();
      if (mode === 'off') return;
      if (mode === 'background') { this.applyPowerSave(true, '切后台'); return; }
      // screenOff：息屏（可配延迟 —— 短看一眼不该立刻掉进省电）
      const delay = Math.max(0, this.num('powerSaveDelay', 0)) * 1000;
      clearTimeout(this._psT);
      this._psT = setTimeout(() => { if (document.hidden) this.applyPowerSave(true, '息屏'); }, delay);
    },

    hostKeepalive() { return (this.host && parseInt(this.host.keepalive, 10)) || 30; },

    async applyPowerSave(on, why) {
      if (this._powerSave === on) { this.renderPowerState(); return; }
      if (!on) { await this.resumeFromPowerSave(why); return; }
      this._powerSave = true;
      this.pauseWork();
      const st = await this.rpc('app.power', {
        save: true,
        keepalive: this.hostKeepalive(),
        // ⚠ 省电时**不能把心跳关掉**：SSH/TCP 心跳是保住 NAT 映射、别让连接被中间设备
        // 悄悄掐掉的关键。用户的要求是"连接不能断"，所以这里只是**拉长**（30s → 120s），
        // 每次唤醒 CPU 的开销极小，换来的是连接真的一直在。
        keepaliveSave: 120
      }, 8000).catch(() => null);
      if (st) this._powerState = st;
      this.renderPowerState();
      this.toast('省电中（' + why + '）：后台不渲染，输出落盘缓存；连接保持', 2600);
    },

    /**
     * 亮屏/回前台：**先把省电期间攒下的输出渲染完，再恢复实时流**。
     *
     * 顺序很关键（错一步输出就会错位）：
     *   ① 先挂上"暂存"开关 —— 这期间到达的事件只入队、不渲染；
     *   ② 取走落盘缓存（此时原生还在省电状态，不会同时发事件）；
     *   ③ 关掉省电（原生恢复发事件）；
     *   ④ 把落盘的那一段渲染出去，并把渲染水位对齐到缓存覆盖的 seq；
     *   ⑤ 放行暂存的事件（丢掉 seq ≤ 水位的重复段），最后清掉暂存开关。
     */
    async resumeFromPowerSave(why) {
      if (!this.sessionId) { this._powerSave = false; this.resumeWork(); return; }
      this._flushBuf = [];
      let spill = null;
      try { spill = await this.rpc('session.spill', {}, 12000); } catch (e) { }
      const st = await this.rpc('app.power', { save: false, keepalive: this.hostKeepalive() }, 8000).catch(() => null);
      if (st) this._powerState = st;
      this._powerSave = false;
      this.resumeWork();

      let n = 0;
      if (spill && spill.bytes > 0 && spill.data) {
        try {
          const bytes = HP.b64decode(spill.data);
          this.renderChunk(bytes, null);
          n = bytes.length;
          if (typeof spill.seq === 'number' && spill.seq > 0) this.renderSeq = spill.seq;
          this.rxSeq = Math.max(this.rxSeq || 0, this.renderSeq || 0);
        } catch (e) { }
      }
      // 落盘缓存都不够长（或压根没用上）时，用环形缓冲再兜一层
      if (n === 0) { try { n = await this.resyncOutput(true); } catch (e) { } }

      const buf = this._flushBuf || [];
      this._flushBuf = null;
      for (const m of buf) {
        if (!m || !m.data) continue;
        if (typeof m.seq === 'number' && this.renderSeq && m.seq <= this.renderSeq) continue;  // 与缓存重复
        try { this.renderChunk(HP.b64decode(m.data), m); } catch (e) { }
      }
      this.scrollToBottom();
      this.renderPowerState();
      if (n > 0) {
        this.toast('已恢复（' + why + '）：补渲染了后台期间的 ' + this.fmtB(n) + ' 输出'
          + (spill && spill.truncated ? '（更早的部分超出缓存上限了）' : ''), 3200);
      } else {
        this.toast('已恢复（' + why + '）：期间没有新输出', 2000);
      }
      try { await this.rpc('session.kick', {}, 6000); } catch (e) { }
    },

    /** 停掉"只在看得见时才有意义"的活（每帧 rAF + 三个定时器） */
    pauseWork() {
      if (this._watchRaf) { cancelAnimationFrame(this._watchRaf); this._watchRaf = 0; }
      this.stopTrafficTimer();
      if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = 0; }
      this.stopPing();
      clearTimeout(this._sbT);
    },

    resumeWork() {
      if (this._watchFn && !this._watchRaf) this._watchRaf = requestAnimationFrame(this._watchFn);
      this.startTrafficTimer();
      if (!this._tickTimer) this._tickTimer = setInterval(() => { try { this.trackCommandTick(); } catch (e) { } }, 1000);
      if (this.state === 'connected') this.startPing();
      this.syncViewport(); this.fitChrome(); this.resetGeometry();
    },

    async refreshPowerState() {
      this._powerState = await this.rpc('app.power.state', {}, 6000).catch(() => null);
      this.renderPowerState();
    },

    renderPowerState() {
      const el = $('pw-state');
      if (!el) return;
      const s = this._powerState || {};
      const mode = { off: '关', screenOff: '息屏时', background: '后台+息屏' }[this.powerMode()] || this.powerMode();
      el.textContent = (this._powerSave ? '省电中' : '正常')
        + ' · 模式=' + mode
        + ' · 唤醒锁=' + (s.wakeHeld ? '持有（CPU 不会睡）' : '已释放')
        + ' · 心跳=' + (s.keepalive ? s.keepalive + 's' : '关')
        + ' · 屏幕=' + (s.interactive === false ? '灭' : '亮')
        + ' · App=' + (document.hidden ? '后台' : '前台');
    },

    /* ========================================================== 流量统计 */

    /**
     * 下行 = 远端发来、送进终端渲染的字节；上行 = 发往远端的字节。
     *
     * 统计刻意做得很轻：计数就是 `onData` / `send` 里两个整数相加，
     * 每秒采样一次算速率，顶栏那个数字**没变就不动 DOM**（终端类 App 最忌每帧碰布局）。
     * 原生侧（Ssh.kt）另有一份 socket 级计数，跟着 `metrics` 事件过来；
     * 详情里两份并列 —— 差值就是"回前台补发"补回来的量，能看出补了多少。
     */
    initTraffic() {
      this.traffic = {
        down: 0, up: 0, evt: 0, t0: Date.now(),
        _d: 0, _u: 0, _at: Date.now(),
        rateDown: 0, rateUp: 0, peakDown: 0,
        native: null,
        cum: this.num('trafficCum', 0), cumAt: Date.now(),
        // 历史：**区间**记录（每条 = 一段时间里的增量），不是总计。
        // 老版本只存了 trafficCum 一个总数（没有时间窗）—— 那种数据折不成桶，宁可不画，也不伪造一根巨柱。
        samples: this.loadTrafficSamples(), legacyCum: this.num('trafficCum', 0)
      };
      if (this._trafficTimer) clearInterval(this._trafficTimer);
      this._trafficTimer = 0;
      this.startTrafficTimer();
      this.renderTraffic();
    },

    /** 流量采样的秒表（省电时要能停掉：每秒一次的定时器会把 CPU 拽醒） */
    startTrafficTimer() {
      if (this._trafficTimer) return;
      this._trafficTimer = setInterval(() => this.sampleTraffic(), 1000);
    },

    stopTrafficTimer() {
      if (this._trafficTimer) { clearInterval(this._trafficTimer); this._trafficTimer = 0; }
    },

    /** 计数归零：只归零**本次会话**的计数器（历史区间与跨会话累计都不动） */
    resetTraffic() {
      const t = this.traffic || {};
      this.traffic = {
        down: 0, up: 0, evt: 0, t0: Date.now(), _d: 0, _u: 0, _at: Date.now(),
        rateDown: 0, rateUp: 0, peakDown: 0, native: t.native || null,
        cum: t.cum || 0, cumAt: Date.now(), samples: t.samples || [], legacyCum: t.legacyCum || 0
      };
      this.renderTraffic();
    },

    /** 读历史区间（坏了就当空 —— 宁可没有历史，也别拿着半截 JSON 画错图） */
    loadTrafficSamples() {
      try {
        const raw = this.pref('trafficSamples', '');
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((s) => s && typeof s.up === 'number' && typeof s.down === 'number') : [];
      } catch (e) { return []; }
    },

    sampleTraffic() {
      const t = this.traffic;
      if (!t) return;
      const now = Date.now();
      const dt = Math.max(200, now - t._at) / 1000;
      const d = t.down - t._d, u = t.up - t._u;
      // 指数平滑：读数不至于一秒一跳
      t.rateDown = t.rateDown * 0.5 + (d / dt) * 0.5;
      t.rateUp = t.rateUp * 0.5 + (u / dt) * 0.5;
      if (t.rateDown > t.peakDown) t.peakDown = t.rateDown;
      // 采样点 = 这一段的区间（有增量才记，空转的秒不占图上的位置）
      if (d > 0 || u > 0) t.samples = HP.Net.pushSample(t.samples, { t0: t._at, t1: now, up: u, down: d });
      t._d = t.down; t._u = t.up; t._at = now;
      t.cum += d;
      this.renderTraffic();
      // 跨会话累计 + 历史区间每 30s 落一次盘（别每秒写偏好）
      if (now - t.cumAt > 30000) {
        t.cumAt = now;
        const v = Math.round(t.cum);
        this.prefs.trafficCum = v;
        try { this.rpc('pref.set', { k: 'trafficCum', v }).catch(() => { }); } catch (e) { }
        this.saveTrafficSamples();
      }
    },

    /** 把历史区间落盘（唯一写入口走 pref.set；数组先 JSON 成一条字符串） */
    saveTrafficSamples() {
      const t = this.traffic;
      if (!t) return 0;
      const v = JSON.stringify(t.samples || []);
      this.prefs.trafficSamples = v;
      try { this.rpc('pref.set', { k: 'trafficSamples', v }).catch(() => { }); } catch (e) { }
      return (t.samples || []).length;
    },

    /** 清空历史区间（计数归零是另一回事：那清的是本次会话的计数器） */
    clearTrafficSamples() {
      if (!this.traffic) return 0;
      const had = (this.traffic.samples || []).length;
      this.traffic.samples = [];
      this.saveTrafficSamples();
      this.renderTraffic();
      return had;
    },

    renderTraffic() {
      const el = $('tb-traffic');
      if (!el || !this.traffic) return;
      if (!this.bool('showTraffic', true)) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      const t = this.traffic;
      const txt = '↓ ' + fmtBytes(t.down);
      if (el.textContent !== txt) el.textContent = txt;      // 值没变就不碰 DOM
      el.title = '下行 ' + fmtBytes(t.down) + '（当前 ' + fmtBytes(t.rateDown) + '/s）\n上行 '
        + fmtBytes(t.up) + '（当前 ' + fmtBytes(t.rateUp) + '/s）\n点开看详情';
    },

    /** 字节格式化：fmtBytes 只到 M，流量累计会到 G */
    fmtB(n) {
      if (!isFinite(n) || n < 0) n = 0;
      if (n < 1024) return Math.round(n) + 'B';
      if (n < 1048576) return (n / 1024).toFixed(1) + 'K';
      if (n < 1073741824) return (n / 1048576).toFixed(1) + 'M';
      return (n / 1073741824).toFixed(2) + 'G';
    },

    fmtDur(ms) {
      const s = Math.round(ms / 1000);
      if (s < 60) return s + ' secs';
      const m = Math.floor(s / 60);
      if (m < 60) return m + ' 分 ' + (s % 60) + ' secs';
      return Math.floor(m / 60) + ' 时 ' + (m % 60) + ' 分';
    },

    /**
     * 流量小窗：数字每秒在动，所以用 `HP.UI.sheet` 的 live 重画（同一个 sheet 实现，不另起一套弹窗）。
     * 历史那段走 F-NET-8 的三层：采集存**区间**（`traffic.samples`）→ 统计一处（`HP.Net.bucketize`）→ 绘图一处（`HP.Net.bars/pie`）。
     */
    openTrafficDialog() {
      if (!this.traffic) return;
      this.rpc('ping', {}, 5000).catch(() => { });     // 顺手把原生计数刷到最新（ping 里会 emitMetrics）
      // 图上最多 12 根柱：够了就多合几条（条数、组数都写在抬头里，能核对）
      const bucketSpan = () => Math.max(1, Math.ceil(((this.traffic.samples || []).length) / 12));
      HP.UI.sheet({
        title: '流量统计',
        live: {
          ms: 600,
          fn: (body) => {
            const t = this.traffic;
            body.textContent = '';
            if (!t) { body.appendChild(HP.UI.status('没有流量对象')); return; }
            const elapsedMs = Date.now() - t.t0;
            const secs = Math.max(1, elapsedMs / 1000);
            const n = t.native;
            const rows = [
              HP.UI.row({
                title: '下行（本次会话）', right: this.fmtB(t.down), testid: 'tf-down',
                sub: '当前 ' + this.fmtB(t.rateDown) + '/s · 峰值 ' + this.fmtB(t.peakDown) + '/s'
              }),
              HP.UI.row({
                title: '上行（本次会话）', right: this.fmtB(t.up), testid: 'tf-up',
                sub: '当前 ' + this.fmtB(t.rateUp) + '/s'
              }),
              HP.UI.row({
                title: '平均下行', right: this.fmtB(t.down / secs) + '/s', testid: 'tf-avg',
                sub: '会话 ' + this.fmtDur(elapsedMs) + ' · 收到数据块 ' + t.evt + ' 次'
              }),
              HP.UI.row({
                title: '累计下行（跨会话）', right: this.fmtB(t.cum), testid: 'tf-cum',
                sub: n ? ('服务端 socket ' + this.fmtB(n.down) + ' ↓ / ' + this.fmtB(n.up) + ' ↑') : '每 30 秒落一次盘'
              })
            ];
            body.appendChild(HP.UI.list(rows));

            // 历史：区间 → 统计 → 图（数字全在 net.js 一处算）
            const stats = HP.Net.bucketize(t.samples || [], bucketSpan());
            const box = document.createElement('div');
            box.className = 'tf-hist';
            box.dataset.testid = 'tf-hist';
            if (!stats.采集条数) {
              box.appendChild(HP.UI.status(t.legacyCum
                ? '还没有历史采样（老版本只存了一个累计总数，没有时间窗、折不成桶 —— 宁可不画，也不伪造一根巨柱）'
                : '还没有历史采样 —— 连上跑一会儿就有了'));
            } else {
              box.appendChild(HP.UI.status('历史上下行：每 ' + bucketSpan() + ' 条合一组（' + stats.采集条数 + ' 条区间 → ' + stats.区间条数 + ' 组）'));
              box.appendChild(HP.Net.bars(stats, { height: 90 }));
              box.appendChild(HP.Net.pie(stats));
            }
            body.appendChild(box);
          }
        },
        actions: [
          { label: '计数归零', fn: () => { this.resetTraffic(); this.toast('本次会话计数已归零（历史不动）'); } },
          { label: '清空历史', fn: () => { const n = this.clearTrafficSamples(); this.toast(n ? ('已清掉 ' + n + ' 条历史区间') : '本来就没有历史'); } },
          { label: '关闭' }
        ]
      });
    },

    /* ======================================================= composer */

    bindComposer() {
      const ta = $('cinput');
      // 具体高度要受 fitChrome() 设的 maxHeight 约束，别顶到 132px 把键条挤出屏幕
      this.growComposer = () => {
        const cap = parseFloat(ta.style.maxHeight) || 132;
        ta.style.height = 'auto';
        ta.style.height = Math.min(cap, Math.max(34, ta.scrollHeight)) + 'px';
      };
      const grow = () => this.growComposer();
      ta.addEventListener('input', grow);
      // 焦点一变立刻跟一帧（不再等 250ms），再补一次收尾，兜住 IME 动画的尾巴
      const bumpViewport = () => {
        this.syncViewport();
        this.scheduleGeometry(90);
        setTimeout(() => this.scheduleGeometry(0), 320);
      };
      ta.addEventListener('focus', bumpViewport);
      ta.addEventListener('blur', bumpViewport);
      ta.addEventListener('keydown', (e) => {
        // ⚠ 只在**攒着**模式接管回车：实时模式下回车由下面的直通分支发 '\r'，
        //   两边都接管 = 一次回车发两遍（TUI 里等于多提交一次）—— 本地实测抓到过。
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!this.liveInput()) this.sendComposer(); }
      });
      $('csend').addEventListener('click', () => this.sendComposer());
      let lp = null;
      $('csend').addEventListener('pointerdown', () => { lp = setTimeout(() => { lp = null; this.sendComposer(true); this.toast('已发送（不带回车）'); }, 620); });
      $('csend').addEventListener('pointerup', () => { if (lp) { clearTimeout(lp); lp = null; } });

      /* ——— 实时输入：敲一下就走一个，和按功能键条上的键同一个链路 ———
       * 以前输入框是"攒着"的：敲完点「发送」才整行送进终端，
       * 交互式界面（TUI、ssh 里的密码提示、REPL）里就等于没有键盘。
       * 另外手机软键盘直接打进 xterm 那个隐藏 textarea 在不少输入法上并不可靠
       *（候选上屏时机、合成事件都各不相同），所以让这个**看得见的**输入框当按键直通管。
       * 想先攒一段再一起发（长文本、多行脚本），点「实时」切成"攒着"即可。
       */
      let composing = false;
      ta.addEventListener('compositionstart', () => { composing = true; });
      ta.addEventListener('compositionend', () => {
        composing = false;
        if (!this.liveInput()) return;
        // ⚠ 中文/日文这类输入法：上屏时 Chrome 的顺序是「先改 textarea.value → 再发 compositionend」，
        //   而组合期间的 input 事件我们故意跳过了。所以**必须在这里补发**，
        //   否则手机上打中文会出现"字留在框里、什么都没进终端"——看起来就是"这一栏不实时"。
        //   补发后立刻清空，后面的 input 事件看到空值就不会重复发。
        const v = ta.value;
        if (!v) return;
        this.sendLive(v);
        ta.value = ''; ta.style.height = 'auto';
      });
      ta.addEventListener('keydown', (e) => {
        if (!this.liveInput()) return;
        if (composing || e.isComposing || e.keyCode === 229) return;   // 输入法在组合，交给 input
        const m = HP.Keybar.mods, hasMod = !!(m.ctrl || m.alt);
        let seq = null;
        switch (e.key) {
          case 'Enter': seq = '\r'; break;
          case 'Backspace': seq = '\x7f'; break;
          case 'Tab': seq = '\t'; break;
          case 'Escape': seq = '\x1b'; break;
          case 'ArrowUp': seq = '\x1b[A'; break;
          case 'ArrowDown': seq = '\x1b[B'; break;
          case 'ArrowLeft': seq = '\x1b[D'; break;
          case 'ArrowRight': seq = '\x1b[C'; break;
          default:
            // 可打印单字符（含被按住的 Ctrl/Alt：手机上靠键条那个 Ctrl 锁定传来）
            if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) seq = e.key;
            else if (e.key.length === 1 && e.ctrlKey) seq = e.key;   // 硬件键盘自带 Ctrl 也认
        }
        if (seq === null) return;
        e.preventDefault();
        this.sendLive(seq);
        ta.value = ''; ta.style.height = 'auto';
      });
      // 输入法上屏 / 粘贴进来的一整批字符：原样送走（不补回车）
      ta.addEventListener('input', () => {
        if (!this.liveInput() || composing) return;
        const v = ta.value;
        if (!v) return;
        this.sendLive(v);
        ta.value = ''; ta.style.height = 'auto';
      });
      // 输入框右边的按钮同理：点它们不该把软键盘收走
      //（不然点一下「⏎」键盘就没了，还得再点屏幕把它叫回来）
      [ $('cmode'), $('csend') ].forEach((el) => {
        if (el) el.addEventListener('pointerdown', (e) => {
          window.__hpKeepFocus = document.activeElement;
          e.preventDefault();
        }, { passive: false });
      });
      $('cmode').addEventListener('click', () => this.toggleLiveComposer());
    },

    /** 输入框的「实时 / 攒着」模式 */
    liveInput() { return this.bool('liveComposer', true); },

    /**
     * 实时输入真正发出去的那一下。
     *
     * ⚠ 修饰键（键条上的 Ctrl/Alt 锁定）必须在这里统一处理，因为手机上字母**多数是
     * 输入法"提交"**（走 input 事件）而不是 keydown —— 只在 keydown 里套修饰键，
     * 真机上"点 Ctrl 再敲 b"发出去的还是普通 b，Ctrl+b 永远按不出来。
     * 一次来多个字符（中文/粘贴）时只把修饰键套在**第一个**字符上。
     */
    sendLive(text) {
      if (!text) return;
      const m = HP.Keybar.mods;
      if (m.ctrl || m.alt) {
        this.send(HP.buildSeq(text.slice(0, 1), { ctrl: !!m.ctrl, alt: !!m.alt }) + text.slice(1));
        HP.Keybar.mods.ctrl = HP.Keybar.mods.alt = false; HP.Keybar.syncAll();
        return;
      }
      this.send(text);
    },

    async toggleLiveComposer() {
      const live = !this.liveInput();
      this.prefs.liveComposer = live;
      try { await this.rpc('pref.set', { k: 'liveComposer', v: live }); }
      catch (e) { localStorage.setItem('hp.liveComposer', String(live)); }
      this.applyComposerMode();
      // 切到「实时」：框里已经攒着的那段**送进终端**（用户要求：实时=逐键直通，所以这段也当"刚敲的"发出去），
      // 并且**不补换行符** —— 回车是"提交/执行"，得由用户自己按，不能替他决定。
      // 切到「攒着」：**不动框里的内容**（以前两边都清空，等于把草稿丢了）。
      const ta0 = $('cinput');
      const pendingText = ta0 ? ta0.value : '';
      if (live && pendingText) {
        this.sendLive(pendingText);
        ta0.value = '';
        if (this.growComposer) this.growComposer();
      }
      this.toast(live ? '实时：敲一个字就进终端（原框里那段已送出，没加回车）' : '攒着：写完点「发送」整行送（草稿留着）');
      ta0.focus();
    },

    applyComposerMode() {
      const live = this.liveInput();
      const cm = $('cmode'), cs = $('csend'), ta = $('cinput');
      if (cm) { cm.textContent = live ? '实时' : '攒着'; cm.classList.toggle('on', live); }
      if (cs) cs.textContent = live ? '⏎' : '写入';
      if (ta) ta.placeholder = live
        ? '实时输入：敲一个字就送进终端（和点功能键条一样）'
        : '攒着输入：写完点「写入」把这段送进终端（不带回车；要回车点键条的 ⏎）';
    },

    sendComposer(noEnter) {
      const ta = $('cinput');
      const text = ta.value;
      // 实时模式下输入框平时是空的（字符已经边走边发出去了）——
      // 这时「发送」= 发一个回车，长按 = 只发已上屏的内容（不带回车）
      if (this.liveInput() && !text) {
        if (!noEnter) { this.send('\r'); this.toast('已发送回车 ⏎'); }
        ta.focus();     // 点「⏎」之后继续留在输入框（键盘别收）
        return;
      }
      if (!text) return;
      // 没连上时**不清空草稿** —— 之前无条件清空，用户敲了一长段点发送，字直接没了。
      if (!this.sessionId || !this.transport || !this.transport.alive) {
        this.toast('还没连上，草稿已保留');
        return;
      }
      const mods = HP.Keybar.mods;
      if (mods.ctrl || mods.alt) {
        this.send(HP.buildSeq(text, { ctrl: !!mods.ctrl, alt: !!mods.alt }));
        HP.Keybar.mods.ctrl = HP.Keybar.mods.alt = false; HP.Keybar.syncAll();
      } else {
        // **不自动补回车**（用户要求）：这里只把内容"写进"终端，回调车请点功能键条上的「⏎」。
        // 以前是 text + '\r'，等于替用户按了回车 —— 在 TUI 里会直接提交、在 shell 里会直接执行。
        this.send(text);
      }
      ta.value = ''; ta.style.height = 'auto';
      this.toast('已写入终端（不带回车）');
    },

    /** 键盘开合：单击终端不再抢焦点，改由这个显式动作负责 */
    /**
     * 把焦点从文本框上收回来（= 让系统把软键盘收起）。
     * 只动 input/textarea 这类真输入元素；blur 不影响它们的内容，所以"打了一半的字"还在。
     * 用在「点上面那块屏幕」时 —— 用户要的是点了不弹键盘、也挡住长按/复制。
     */
    /**
     * 现在到底"想不想要键盘"：
     *   · 只有按 ⌨ 功能键（或设置里开了"点击终端弹键盘"）才算想要；
     *   · 点上面那块屏幕、点别处 → 不想要（终端隐藏输入框若此时抢焦点，立刻收回去）。
     */
    wantKeyboard(on) {
      this._kbdWanted = !!on;
      // 第二道保险（真机有效）：没要键盘时给隐藏输入框 inputmode=none —— 就算它被谁聚焦，
      // 系统也不会弹软键盘；按「⌨ 键盘」时再改回 text，键盘照常能用。
      // 为什么加这条：只挡"焦点不落它"在真机上不够（WebView 触摸之后仍会给它一次 focus）。
      try {
        const ta = this.term && this.term.textarea;
        if (ta) ta.setAttribute('inputmode', this._kbdWanted ? 'text' : 'none');
      } catch (e) { }
      return this._kbdWanted;
    },

    blurInputs() {
      const ae = document.activeElement;
      if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) {
        try { ae.blur(); } catch (e) { }
      }
    },

    toggleKeyboard() {
      const ta = this.term && this.term.textarea;
      if (!ta) return;
      if (document.activeElement === ta) {
        this.wantKeyboard(false);
        ta.blur();
        this.toast('键盘已收起');
      } else {
        this.wantKeyboard(true);     // 这是**唯一**"点了就弹键盘"的入口
        this.term.focus();
        this.toast('键盘已打开（再点「⌨ 键盘」收起）');
      }
    },

    /**
     * tmux 回滚。
     * 备用屏在本地没有 scrollback，手机端还有一条不依赖鼠标的路：
     * 发 tmux 的 prefix + [ 进 copy mode，之后方向键 / PgUp / PgDn 翻历史，q 退出。
     */
    enterCopyMode() {
      if (!this.sessionId) { this.toast('还没连接'); return; }
      this.send('\x02[');
      this.toast('已发 tmux 回滚键（prefix + [）：↑↓/PgUp 翻历史，q 退出', 2600);
    },

    toggleComposer(force) {
      const c = $('composer');
      const show = force === undefined ? c.classList.contains('hidden') : force;
      c.classList.toggle('hidden', !show);
      this.prefs.showComposer = show;
      $('csend').textContent = '发送';
      setTimeout(() => { this.resetGeometry(); if (show) $('cinput').focus(); }, 60);
    },

    /* ======================================================= 剪贴板 */

    async copy(text, msg) {
      try {
        if (HP.hasNative()) await this.rpc('clip.write', { text });
        else if (navigator.clipboard) await navigator.clipboard.writeText(text);
        else throw new Error('no clipboard');
        this.toast(msg || '已复制');
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); this.toast(msg || '已复制'); } catch (_) { }
        ta.remove();
      }
    },

    async paste() {
      let text = '';
      try {
        if (HP.hasNative()) text = await this.rpc('clip.read');
        else if (navigator.clipboard) text = await navigator.clipboard.readText();
      } catch (e) { }
      if (!text) { this.toast('读不到剪贴板（可在输入框里长按粘贴）'); return; }
      if (this.watcher && this.watcher.bracketedPaste) this.send('\x1b[200~' + text + '\x1b[201~');
      else this.send(text);
      this.toast('已粘贴 ' + text.length + ' 字符');
    },

    /* ======================================================= 提示 / 弹窗 */

    toast(msg, ms) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove('show'), ms || 1900);
    },

    confirm(msg, okLabel) {
      return new Promise((resolve) => {
        const back = document.createElement('div');
        back.className = 'hp-dialog';
        back.style.cssText = 'position:absolute;inset:0;background:rgba(4,8,12,.82);z-index:80;display:flex;align-items:center;justify-content:center;padding:18px';
        back.innerHTML = `<div class="card" style="max-width:420px;width:100%">
            <div class="sub" style="white-space:pre-wrap;font-family:var(--font-mono);font-size:12px;color:var(--fg)">${msg.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>
            <div class="btnrow">
              <button class="btn primary" data-y>${okLabel || '确定'}</button>
              <button class="btn" data-n>取消</button>
            </div></div>`;
        back.addEventListener('click', (e) => {
          if (e.target.hasAttribute('data-y')) { back.remove(); resolve(true); }
          else if (e.target.hasAttribute('data-n')) { back.remove(); resolve(false); }
        });
        $('stage').appendChild(back);
      });
    },

    sheet(title, text) {
      const back = document.createElement('div');
      back.className = 'hp-dialog';
      back.style.cssText = 'position:absolute;inset:0;background:rgba(4,8,12,.94);z-index:85;display:flex;flex-direction:column;padding:14px';
      back.innerHTML = `
        <div style="font-weight:650;margin-bottom:8px">${title}</div>
        <textarea readonly style="flex:1;background:#0a1119;border:1px solid var(--line);border-radius:10px;padding:10px;font-family:var(--font-mono);font-size:12px;-webkit-user-select:text;user-select:text">${text}</textarea>
        <div class="btnrow">
          <button class="btn primary" data-c>复制</button>
          <button class="btn" data-x>关闭</button>
        </div>`;
      back.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-c')) App.copy(back.querySelector('textarea').value);
        else if (e.target.hasAttribute('data-x')) back.remove();
      });
      $('stage').appendChild(back);
    },

    /* ======================================================= 设置生效 */

    applySettings() {
      const p = this.prefs;
      HP.Geom.baseFont = this.num('fontSize', 13);
      HP.Geom.mode = this.pref('geomMode', 'auto');
      HP.Geom.fixedCols = parseInt(this.pref('fixedCols', 100), 10);
      HP.Geom.fixedRows = parseInt(this.pref('fixedRows', 0), 10) || 0;
      HP.Geom.tuiFidelity = this.bool('tuiFidelity', false);
      if (this.term) {
        this.term.options.scrollback = parseInt(this.pref('scrollback', 5000), 10);
        this.term.options.fontSize = HP.Geom.baseFont;
      }
      $('keybar').classList.toggle('hidden', !this.bool('showKeybar', true));
      $('composer').classList.toggle('hidden', !this.bool('showComposer', true));
      this.applyComposerMode();
      this.renderTraffic();
      HP.Hermes.attachCmd = this.pref('hermesAttach', HP.Hermes.attachCmd);
      // 回读：改完设置后把「现在真正生效的是什么」显示出来（否则用户只能靠肉眼猜有没有生效）
      HP.Panels && HP.Panels.syncPrefInputs && HP.Panels.syncPrefInputs();
      if (HP.hasNative()) this.rpc('app.configure', {
        keepAwake: this.bool('keepAwake', true),
        keepalive: this.num('keepalive', 30)
      }).catch(() => { });
      this.resetGeometry();
    },

    setTitle(t) {
      const el = $('tb-title');
      el.textContent = t || 'Hermes Pocket';
    },

    welcome() {
      if (!HP.Panels.hosts.length) { this.openBoard('hosts'); }
      this.term.write('\x1b[38;5;79mHermes Pocket\x1b[0m  移动端 SSH + Hermes TUI 渲染层  \x1b[38;5;244m' + HP.BUILD + '\x1b[0m\r\n');
      this.term.write('点左上 ☰ 选栏目（主机 / 密钥 / 设置 / Hermes）。\r\n');
      this.term.write('打字：功能键条的「\x1b[33m⌨键盘\x1b[0m」；长文本：「✎输入」；冷门键：「⌄更多」。\r\n');
      this.term.write('单击终端不会弹键盘；长按终端或「\x1b[33m▤\x1b[0m」出菜单。\r\n\r\n');
    }
  };

  const fmtBytes = (n) => n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M';

  /** 若 assets/ui/fonts/terminal.ttf 存在就加载（Nerd Font 图标字形） */
  async function loadTermFont(app) {
    try {
      if (!app.bool('nerdFont', true)) return;
      const ff = new FontFace('HPPocketMono', "url('fonts/terminal.ttf') format('truetype')");
      await ff.load();
      document.fonts.add(ff);
      HP.FONT = "'HPPocketMono'," + HP.FONT;
    } catch (e) { /* 没放字体文件就用系统等宽，正常情况 */ }
  }

  HP.App = App;
  document.addEventListener('DOMContentLoaded', () => App.boot().catch((e) => {
    document.body.innerHTML = '<pre style="color:#ff5c5c;padding:16px;white-space:pre-wrap">启动失败: ' + (e && e.stack || e) + '</pre>';
  }));
})();
