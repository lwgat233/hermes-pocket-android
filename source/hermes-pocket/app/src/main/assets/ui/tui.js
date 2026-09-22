/* Hermes Pocket — Hermes TUI 适配层
 * ===========================================================================
 * xterm.js 只负责「把字节画成字符」。这一层负责把 TUI 在手机上变得能用：
 *
 *   TuiWatcher  旁路嗅探字节流里的终端模式（备用屏/鼠标/标题），
 *               因为 Hermes TUI 是 Ink 写的全屏 TUI，和普通 shell 需要
 *               完全不同的输入法、几何、手势策略。
 *   Geom        几何策略：TUI 需要 ≥80 列，手机只有 ~45 列宽 —— 先自动
 *               缩小字号塞进去，塞不下就固定列数 + 横向平移。
 *   Keybar      手机没有 Esc/Tab/Ctrl/方向键，功能键条补上（分 shell / TUI 两套）。
 *   mouseSeq    触摸 → SGR 鼠标序列，让 TUI 里的按钮/列表能点。
 *   Hermes      Hermes 专属快捷：常用斜杠命令、tmux 常驻会话、状态识别。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  /* ========================================================== 1. 模式嗅探 */

  const RE_ALT = /\x1b\[\?(?:1049|1047|47)([hl])/g;
  const RE_MOUSE = /\x1b\[\?(1000|1002|1003)([hl])/g;
  const RE_SGR = /\x1b\[\?(1006|1005)([hl])/g;
  const RE_BRACKET = /\x1b\[\?2004([hl])/g;
  const RE_CURSOR = /\x1b\[\?25([hl])/g;
  const RE_APPKEYS = /\x1b\[\?1([hl])/g;
  const RE_OSC_TITLE = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  // 终端通知协议：printf '\e]777;notify;标题;正文\a'（iTerm2/kitty 那套，OSC 9 是简写）
  const RE_OSC_NOTIFY = /\x1b\](?:777|9);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  // shell 集成协议：OSC 133;A=提示符开始 C=命令开始 D=命令结束（可带退出码）
  const RE_OSC_133 = /\x1b\]133;([A-D])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;
  const RE_OSC_ANY = /\x1b\][^\x07\x1b]{0,512}(?:\x07|\x1b\\)/g;
  const RE_BEL = /\x07/g;

  class TuiWatcher {
    constructor() {
      this.alt = false;          // 备用屏 = 全屏 TUI
      this.mouseMode = 0;        // 0 关 / 1000 点 / 1002 拖 / 1003 任意移动
      this.sgr = false;          // SGR 鼠标编码（\x1b[<b;x;yM）
      this.bracketedPaste = false;
      this.cursorHidden = false;
      this.appKeys = false;
      this.title = '';
      this._tail = '';
      this.onChange = null;      // (kind, watcher) => void
    }

    get tui() { return this.alt; }

    /** 吃掉一段（已解码的）终端输出 */
    feed(text) {
      let buf = this._tail + text;
      // 末尾若是半条转义序列，留到下一次再解析（跨 chunk 的序列很容易出现在 SSH 里）
      const li = buf.lastIndexOf('\x1b');
      if (li >= 0) {
        const rest = buf.slice(li);
        const partial = /^\x1b$/.test(rest) ||
          /^\x1b\[[0-9;?]*$/.test(rest) ||
          /^\x1b\][^\x07\x1b]*$/.test(rest) ||
          /^\x1b\[<[0-9;]*$/.test(rest);
        if (partial || rest.length > 256) {
          this._tail = partial ? rest : '';
          buf = buf.slice(0, buf.length - rest.length);
        } else this._tail = '';
      } else this._tail = '';

      let changed = null;
      const scan = (re, fn) => {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(buf)) !== null) { if (fn(m)) changed = changed || 'mode'; }
      };

      scan(RE_ALT, (m) => { const v = m[1] === 'h'; if (v === this.alt) return false; this.alt = v; this._fire('alt'); return true; });
      scan(RE_MOUSE, (m) => {
        const mode = m[2] === 'h' ? parseInt(m[1], 10) : 0;
        if (mode === this.mouseMode) return false;
        this.mouseMode = mode; this._fire('mouse'); return true;
      });
      scan(RE_SGR, (m) => { this.sgr = m[1] === 'h'; this._fire('mouse'); return true; });
      scan(RE_BRACKET, (m) => { this.bracketedPaste = m[1] === 'h'; this._fire('paste'); return true; });
      scan(RE_CURSOR, (m) => { this.cursorHidden = m[1] === 'l'; return true; });
      scan(RE_APPKEYS, (m) => { this.appKeys = m[1] === 'h'; return true; });
      scan(RE_OSC_TITLE, (m) => { const t = m[1].trim(); if (t && t !== this.title) { this.title = t; this._fire('title'); } return true; });

      // ---- 事件通知类序列（手机端跑长任务时最有用）----
      // OSC 777 / 9：脚本可以主动叫人，例如
      //   printf '\e]777;notify;构建完成;用了 42 秒\a'
      scan(RE_OSC_NOTIFY, (m) => {
        const parts = String(m[1]).split(';');
        let title = 'Hermes Pocket', body = m[1];
        if (parts[0] === 'notify') { title = parts[1] || title; body = parts.slice(2).join(';'); }
        if (body && body.trim()) this._fire('notify', { title: title, body: body.trim() });
        return true;
      });
      // OSC 133：如果远端 shell 装了集成，这里能拿到**精确**的命令结束与退出码
      scan(RE_OSC_133, (m) => {
        if (m[1] === 'D') this._fire('cmdend', { code: (m[2] === undefined || m[2] === '') ? null : parseInt(m[2], 10) });
        else this._fire('cmdstart', { phase: m[1] });
        return true;
      });
      // BEL：最经典的「跑完了叫我」信号（make 出错、很多 TUI 都会响铃）
      // 先把 OSC 序列抠掉 —— 否则 OSC 的结束符 \a 会被误判成响铃
      const bare = buf.replace(RE_OSC_ANY, '');
      RE_BEL.lastIndex = 0;
      if (RE_BEL.test(bare)) { RE_BEL.lastIndex = 0; this._fire('bell'); }

      return changed;
    }

    _fire(kind, data) { this._changed = true; this.onChange && this.onChange(kind, this, data); }

    /** 把 watcher 状态压成状态栏用的一行 */
    describe() {
      if (!this.alt) return 'shell';
      // 无鼠标时明说"滚动受限"，别让用户以为是自己的手势不对
      return 'TUI' + (this.mouseMode ? '·鼠标' : '·滚动受限');
    }
  }

  HP.TuiWatcher = TuiWatcher;

  /* ========================================================== 2. 几何策略 */

  const Geom = {
    mode: 'auto',        // auto | fill | fixed
    fixedCols: 100,
    /** fixed 模式下的固定行数；0 = 行数跟随可视高度 */
    fixedRows: 0,
    /**
     * 「为了 TUI 强行凑 ≥80 列」——**默认关闭**。
     * 开启后，竖屏手机上终端会比屏幕宽出近一倍，必须左右滑动才能看全（框线倒是不会错位）。
     * 关掉时按屏幕宽度铺满：不超出屏幕，一点横向滑动都不需要。
     */
    tuiFidelity: false,
    tuiMinCols: 80,      // TUI 至少要多少列才不变形
    tuiMaxCols: 120,
    minFont: 6,          // 字号下限（与设置面板/对话框/双指缩放共用）
    maxFont: 48,         // 字号上限：手机上放到 40+ 就是「大字模式」，不设小上限
    /** 自动缩字号时的**可读下限**：再小就看不清了，到此为止剩下的交给横向平移（仅「TUI 保真」用） */
    readableMin: 10,
    baseFont: 13,
    hardMaxCols: 400,    // 手动模式下允许很大，不再卡在 200
    hardMaxRows: 200,
    /** 手动/凑列数时的列数下限；**屏幕算出来的列数不适用**（见 apply 里的注释） */
    minCols: 10,

    /** 挂到 fitAddon 上迭代字号，直到 cols 达标 */
    _colsAt(term, fit) {
      const d = fit.proposeDimensions();
      return d && d.cols ? d : null;
    },

    /** 某个字号下屏幕能放下多少列（算完把字号还原，不改变实际显示） */
    fitColsAt(term, fit, font) {
      const cur = term.options.fontSize;
      if (font && font !== cur) term.options.fontSize = font;
      const d = fit.proposeDimensions();
      if (font && font !== cur) term.options.fontSize = cur;
      return d && d.cols ? d.cols : 0;
    },

    /**
     * 计算并落地一次几何。返回 {cols,rows,fontSize,pan}；
     * pan=true 表示列数超出可视宽度，需要横向平移才能看全。
     *
     * 手机竖屏约 45 列，Hermes 这种 Ink TUI 在 45 列里会框线错位、面板挤成一团。
     * 所以 auto 模式下的策略是「先缩字号塞到 80 列，塞不下就固定 80 列 + 横向平移」。
     */
    apply(term, fit, watcher) {
      const tui = !!(watcher && watcher.alt);
      // 只有用户显式打开「TUI 保真」时，才为了凑够 80 列去缩字号 / 让终端宽过屏幕。
      // 默认按屏幕宽度铺满：手机上"能一眼看全"比"框线不错位"重要。
      const shrink = this.mode === 'auto' && tui && this.tuiFidelity;

      let font = this.baseFont;
      if (term.options.fontSize !== font) term.options.fontSize = font;

      if (shrink) {
        // 只缩到「还看得清」为止。硬要缩到 6px 去凑 80 列，在手机上是没法用的
        // —— 到可读下限还没凑够，就固定 80 列 + 横向平移（下面的 pan 标志）。
        for (let i = 0; i < 12; i++) {
          const d = this._colsAt(term, fit);
          if (!d || d.cols >= this.tuiMinCols) break;
          if (font <= this.readableMin) break;
          font -= 1;
          term.options.fontSize = font;
        }
      }

      const d = this._colsAt(term, fit);
      if (!d) return null;

      let cols, rows = d.rows;
      let fromScreen = false;      // 这个列数是「屏幕算出来的」还是「人为指定的」
      if (this.mode === 'fixed') {
        // 手动模式：列数与字号都由用户钉死（字号由 baseFont 带进来，且不走上面的自动缩字号），
        // 行数设了就跟用户走，没设（0）才跟着屏幕高度。
        cols = this.fixedCols;
        if (this.fixedRows > 0) rows = this.fixedRows;
      } else if (this.mode === 'auto' && tui && this.tuiFidelity) {
        cols = Math.min(Math.max(d.cols, this.tuiMinCols), this.tuiMaxCols);
      } else {
        // 默认：屏幕宽度能放多少列就用多少列 —— 不超出屏幕，不需要左右滑动
        cols = d.cols;
        fromScreen = true;
      }
      // ⚠ 屏幕算出来的列数**绝不能被抬高**：抬高多少就等于超出屏幕多少。
      //   字号调大时能放下的列数会变小（比如 40px 字号下只剩 16 列），
      //   如果统一套一个「最少 20 列」的下限，就会在大字号下重新撑宽 —— Termux 不这么做。
      cols = Math.min(this.hardMaxCols, fromScreen ? Math.max(2, cols) : Math.max(this.minCols, cols));
      rows = Math.max(4, Math.min(this.hardMaxRows, rows));

      if (cols !== term.cols || rows !== term.rows) term.resize(cols, rows);

      return { cols, rows, fontSize: font, pan: cols > d.cols, fitCols: d.cols };
    }
  };

  HP.Geom = Geom;

  /* ========================================================== 3. 键序列 */

  const ctrlChar = (ch) => {
    if (!ch) return null;
    const u = ch.toUpperCase().charCodeAt(0);
    if (u >= 64 && u < 128) return String.fromCharCode(u - 64);
    if (ch === ' ') return '\x00';
    if (ch === '[') return '\x1b';
    if (ch === '\\') return '\x1c';
    if (ch === ']') return '\x1d';
    if (ch === '^') return '\x1e';
    if (ch === '_') return '\x1f';
    if (ch === '?') return '\x7f';
    return null;
  };

  // 方向键/功能键的「带修饰」编码：xterm 的 CSI 1;<mod> 形式，
  // mod = 1 + shift + 2*alt + 4*ctrl。TUI 里的 Ctrl+↑ / Alt+← 走这个，
  // 而不是简单地往序列前面贴一个 ESC（那样只会得到乱码序列）。
  const CSI_LETTER = { '\x1b[A': 'A', '\x1b[B': 'B', '\x1b[C': 'C', '\x1b[D': 'D', '\x1b[H': 'H', '\x1b[F': 'F' };
  const CSI_TILDE = { '\x1b[2~': '2', '\x1b[3~': '3', '\x1b[5~': '5', '\x1b[6~': '6' };

  const withMods = (seq, mods) => {
    const m = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
    if (m !== 1) {
      if (CSI_LETTER[seq]) return '\x1b[1;' + m + CSI_LETTER[seq];
      if (CSI_TILDE[seq]) return '\x1b[' + CSI_TILDE[seq] + ';' + m + '~';
    }
    // 其他转义序列：Alt 加一个 ESC 前缀（这是 Alt+键 的通用形式），Ctrl 没有标准等价形式，原样发
    if (mods.alt) return '\x1b' + seq;
    return seq;
  };

  /** 带修饰键的字符串编码。
   *  普通文本逐字符处理（Ctrl+a → 0x01，Alt+a → ESC a，两者可叠加 → ESC 0x01）；
   *  已经是转义序列的（方向键/PgUp 等）走 withMods，不能逐字符贴前缀。 */
  const build = (text, mods) => {
    const isSeq = text.length > 1 && text.charCodeAt(0) === 0x1b;
    if (isSeq) return withMods(text, mods);
    let out = '';
    for (const ch of text) {
      let c = ch;
      if (mods.ctrl) { const cc = ctrlChar(ch); if (cc !== null) c = cc; }
      if (mods.alt) c = '\x1b' + c;
      out += c;
    }
    return out;
  };

  /** SGR 鼠标序列（Hermes Ink TUI 用 1006 编码） */
  const mouseSeq = function (btn, col, row, press, sgr, mods) {
    const m = (mods && mods.shift ? 4 : 0) | (mods && mods.alt ? 8 : 0) | (mods && mods.ctrl ? 16 : 0);
    const b = btn | m;
    if (sgr) return '\x1b[<' + b + ';' + (col + 1) + ';' + (row + 1) + (press ? 'M' : 'm');
    return '\x1b[M' + String.fromCharCode(32 + b, 32 + Math.min(223, col) + 1, 32 + Math.min(223, row) + 1);
  };

  const wheelSeq = function (up, col, row, sgr) {
    const b = up ? 64 : 65;
    if (sgr) return '\x1b[<' + b + ';' + (col + 1) + ';' + (row + 1) + 'M';
    return '\x1b[M' + String.fromCharCode(32 + b, 33, 33);
  };

  HP.ctrlChar = ctrlChar;
  HP.buildSeq = build;
  HP.mouseSeq = mouseSeq;
  HP.wheelSeq = wheelSeq;

  /* ========================================================== 4. 功能键条 */

  // 主键位固定 15 个 + 「⌄更多」= 16，正好铺满 8 列 × 2 行，**全部可见、不横滑**。
  // 顺序按使用频率排：修饰键和方向键放前面，冷门键收进「更多」。
  const KEY_SHELL = [
    { label: 'Esc', seq: '\x1b', cls: 'mod' },
    { label: 'Tab', seq: '\t', cls: 'mod' },
    { label: '⇧Tab', seq: '\x1b[Z', cls: 'mod' },
    { label: '↑', seq: '\x1b[A' },
    { label: '↓', seq: '\x1b[B' },
    { label: '←', seq: '\x1b[D' },
    { label: '→', seq: '\x1b[C' },
    { label: '⌫', seq: '\x7f' },
    { label: 'Ctrl', mod: 'ctrl', cls: 'mod' },
    { label: 'Alt', mod: 'alt', cls: 'mod' },
    { label: '^C', text: 'c', ctrl: true, cls: 'acc' },
    { label: '^D', text: 'd', ctrl: true, cls: 'acc' },
    { label: '⌨键盘', act: 'kbd', cls: 'mod' },
    { label: '✎输入', act: 'composer', cls: 'mod' },
    { label: '▤', act: 'hermes', cls: 'acc' }
  ];

  const KEY_TUI = [
    { label: 'Esc', seq: '\x1b', cls: 'acc' },
    { label: 'Tab', seq: '\t', cls: 'mod' },
    { label: '⇧Tab', seq: '\x1b[Z', cls: 'mod' },
    { label: '↑', seq: '\x1b[A' },
    { label: '↓', seq: '\x1b[B' },
    { label: '←', seq: '\x1b[D' },
    { label: '→', seq: '\x1b[C' },
    { label: '⏎', seq: '\r', cls: 'acc' },
    // Ctrl / Alt 必须留在**可见**这一行：
    // TUI 恰恰就是 tmux/vim/less 待的地方，而 tmux 的操作几乎都要 Ctrl
    //（C-b d 脱离、C-b c 新窗口……）。以前它们只在 shell 行和「⌄更多」展开行里，
    // 在 TUI 下等于**按不到 Ctrl**，用户只能得出"输入 ctrl+b d 退不出去"的结论。
    { label: 'Ctrl', mod: 'ctrl', cls: 'mod' },
    { label: 'Alt', mod: 'alt', cls: 'mod' },
    { label: '⌫', seq: '\x7f' },
    { label: '^C', text: 'c', ctrl: true, cls: 'acc' },
    { label: 'PgUp', seq: '\x1b[5~' },
    { label: 'PgDn', seq: '\x1b[6~' },
    { label: '▤', act: 'hermes', cls: 'acc' }
  ];

  // 冷门键收进「更多」那一行（同样 8 列网格，也不横滑）
  const KEY_SHELL_MORE = [
    { label: 'Ctrl', mod: 'ctrl', cls: 'mod' },
    { label: 'Alt', mod: 'alt', cls: 'mod' },
    { label: '^Z', text: 'z', ctrl: true, cls: 'acc' },
    { label: '清屏', seq: '\x0c', cls: 'mod' },
    { label: '⤓粘贴', act: 'paste', cls: 'mod' },
    { label: 'F1', seq: '\x1bOP' },
    { label: 'F2', seq: '\x1bOQ' },
    { label: 'Home', seq: '\x1b[H' },
    { label: 'End', seq: '\x1b[F' },
    { label: 'PgUp', seq: '\x1b[5~' },
    { label: 'PgDn', seq: '\x1b[6~' },
    { label: '|' }, { label: '-' }, { label: '~' }, { label: '/' }, { label: '空格', text: ' ' }
  ];

  const KEY_TUI_MORE = [
    { label: '⇞回滚', act: 'copyMode', cls: 'mod' },
    { label: '⌨键盘', act: 'kbd', cls: 'mod' },
    { label: '^L', text: 'l', ctrl: true, cls: 'mod' },
    { label: '清屏', seq: '\x0c', cls: 'mod' },
    { label: '⤓粘贴', act: 'paste', cls: 'mod' },
    { label: '✎输入', act: 'composer', cls: 'mod' },
    { label: 'Home', seq: '\x1b[H' },
    { label: 'End', seq: '\x1b[F' },
    { label: '空格', text: ' ' }
  ];

  const MORE_KEY = { label: '⌄更多', act: 'more', cls: 'act-more' };

  const Keybar = {
    mods: { ctrl: false, alt: false },
    h: {},          // {shellRow, tuiRow, isTui}

    build(rowEl, defs, ctx) {
      rowEl.innerHTML = '';
      for (const d of defs) {
        const b = document.createElement('button');
        b.className = 'key ' + (d.cls || '');
        b.textContent = d.label;
        b.dataset.k = d.label;
        if (d.mod) { b.dataset.mod = d.mod; this._syncMod(b, d.mod); }
        // 按功能键**不能把软键盘收走**：这是 <button>，点它会把焦点从输入框抢过去，
        // Android 的输入法随之收起 —— 按一下 Esc 就得再点一下屏幕把键盘叫回来，很难用。
        // 在 pointerdown 上 preventDefault 就拦得住这次焦点转移；动作由 pointerup 触发。
        let downOn = false, lastAct = 0;
        b.addEventListener('pointerdown', (e) => {
          window.__hpKeepFocus = document.activeElement;   // 记下"按之前正在输入的那一位"
          downOn = true;
          e.preventDefault();
        }, { passive: false });
        b.addEventListener('pointercancel', () => { downOn = false; });
        // 动作必须由 **pointerup** 触发：
        // 上面 pointerdown 已经 preventDefault 了（为了不把键盘焦点抢走），
        // 实测 Chromium 连同后面那个 click 一起吞掉 —— 只挂 click 会变成"按了没反应"。
        b.addEventListener('pointerup', (ev) => {
          if (!downOn) return;
          downOn = false; lastAct = Date.now();
          ev.preventDefault(); ev.stopPropagation();
          act();
        });
        // 兜底：没有 pointerup 的场景（键盘激活/无障碍），并避免与 pointerup 重复执行
        b.addEventListener('click', (ev) => {
          if (Date.now() - lastAct < 600) return;
          if (Date.now() < (this._swallowUntil || 0)) return;   // 键条刚重排，别把残留的 click 当按键
          ev.preventDefault(); ev.stopPropagation();
          act();
        });
        const act = () => {
          const keep = window.__hpKeepFocus;
          // 动作做完把焦点还回去（还给它，而不是无脑 focus 终端 ——
          // 在输入框里打字时按 Esc，应该继续留在输入框里打字）
          const refocus = () => {
            if (keep && keep.isConnected && document.activeElement !== keep && typeof keep.focus === 'function') {
              try { keep.focus({ preventScroll: true }); return; } catch (e) { }
            }
            if (!keep) ctx.focus();     // 之前压根没焦点：按老规矩把键盘唤出来
          };
          window.__hpKeepFocus = null;
          if (d.mod) {
            this.mods[d.mod] = !this.mods[d.mod];
            this.syncAll();
            // 锁定修饰键之后必须把焦点留在"正在输入的那一位"：
            // 焦点被按钮拿走的话软键盘会收起，用户没法接着敲要组合的那个字母；
            // 而在输入框里打字时点 Ctrl，也不该被踢到终端去。
            refocus();
            return;
          }
          if (d.act) { ctx.act(d.act); refocus(); return; }
          const mods = { ctrl: !!this.mods.ctrl, alt: !!this.mods.alt };
          if (d.ctrl) mods.ctrl = true;
          let data;
          if (d.seq !== undefined) {
            data = d.seq;
            // 应用光标键模式（DECCKM）下方向键走 SS3：\x1bOA 而不是 \x1b[A
            if (ctx.appKeys && /^\x1b\[[A-DHF]$/.test(data)) data = data.replace('\x1b[', '\x1bO');
            if (mods.ctrl || mods.alt) data = build(data, mods);
          } else data = build(d.text !== undefined ? d.text : d.label, mods);
          ctx.send(data);
          if (this.mods.ctrl || this.mods.alt) { this.mods.ctrl = this.mods.alt = false; this.syncAll(); }
          refocus();
        };
        rowEl.appendChild(b);
      }
    },

    _syncMod(el, mod) {
      el.classList.toggle('latched', !!this.mods[mod]);
    },

    syncAll() {
      document.querySelectorAll('#keybar .key[data-mod]').forEach((el) => this._syncMod(el, el.dataset.mod));
    },

    render(ctx) {
      this.ctx = ctx;
      const s = document.getElementById('krow-shell');
      const t = document.getElementById('krow-tui');
      const e = document.getElementById('krow-extra');
      this.h = { shell: s, tui: t, extra: e };
      this.isTui = false;
      this.moreOpen = false;
      this.build(s, KEY_SHELL.concat([MORE_KEY]), ctx);
      this.build(t, KEY_TUI.concat([MORE_KEY]), ctx);
      this.build(e, KEY_SHELL_MORE, ctx);
      this.setTui(false);
    },

    /** 「⌄更多」：冷门键那一行，开合状态在切换 TUI/shell 时保留 */
    toggleMore() {
      this.moreOpen = !this.moreOpen;
      this.h.extra.classList.toggle('hidden', !this.moreOpen);
      // 展开/收起那一瞬间，键条会整体位移 —— 这一击的 click 有可能落到"刚冒出来"
      // 的那个键上（实测点「⌄更多」会顺带发出一个 Ctrl+空格，就是 0x0）。
      // 开一个很短的窗口，让这次的残留 click 不生效。
      this._swallowUntil = Date.now() + 350;
    },

    setTui(isTui) {
      if (!this.h.shell) return;
      this.isTui = isTui;
      this.h.shell.classList.toggle('hidden', isTui);
      this.h.tui.classList.toggle('hidden', !isTui);
      // 「更多」那一行按当前模式重建（两种模式的冷门键不同）
      this.build(this.h.extra, isTui ? KEY_TUI_MORE : KEY_SHELL_MORE, this.ctx);
      this.h.extra.classList.toggle('hidden', !this.moreOpen);
      document.getElementById('btn-keys')?.classList.toggle('on', !isTui);
    }
  };

  HP.Keybar = Keybar;

  /* ========================================================== 5. Hermes 专属 */

  const Hermes = {
    /** 手机上一键恢复「不会被断线杀掉的」Hermes 会话。
     *  结尾的 `; set -g mouse on` 很重要：tmux 默认不接管鼠标，
     *  而手机端在备用屏里唯一的滚动途径就是「把滚轮事件发给 tmux 让它自己滚」。 */
    attachCmd: "tmux new -As hermes 'hermes --tui' \\; set -g mouse on",
    quick: [
      { label: '恢复/新建 Hermes 会话（tmux，含鼠标）', send: "tmux new -As hermes 'hermes --tui' \\; set -g mouse on\r" },
      { label: 'tmux 脱离会话（C-b d）', send: '\x02d' },
      { label: '恢复最近的会话', send: '/resume latest\r' },
      { label: '开启 tmux 鼠标 → 支持滚轮/点选', send: "tmux set -g mouse on\r" },
      { label: '关闭 tmux 鼠标（用 tmux 自带选区）', send: "tmux set -g mouse off\r" },
      { label: '/help', send: '/help\r' },
      { label: '/new 新会话', send: '/new\r' },
      { label: '/model 换模型', send: '/model\r' },
      { label: '/sessions 会话列表', send: '/sessions\r' },
      { label: '/skills 技能', send: '/skills\r' },
      { label: '/exit 退出', send: '/exit\r' },
      { label: 'Ctrl+C 中断当前任务', send: '\x03' },
      { label: '清屏 (clear)', send: 'clear\r' }
    ],
    looksLikeHermes(w) {
      if (!w) return false;
      if (/hermes/i.test(w.title)) return true;
      return w.alt && w.cursorHidden;
    }
  };

  HP.Hermes = Hermes;
})();
