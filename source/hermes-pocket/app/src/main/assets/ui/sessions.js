/* Hermes Pocket — 会话（tmux）流程
 * ===========================================================================
 * 用户的要求（log.md 第 6 条）：
 *   · 能看到 session 与在线状态，**能选**要进哪个会话；
 *   · 启动该软件时：**有 tmux 就不管它、直接选它**；没有才创建；
 *   · **始终不终止 tmux** —— 所以这个文件里没有、也不许出现 kill-session / kill-server。
 *
 * 分层：远端执行在原生 `tmux.list`（只读一条命令，回原始文本）→ 解析与流程在这里（纯函数，测试台能喂真实输出）
 *       → 界面只画行与状态（HP.UI）。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  /** 与 Bridge.kt 里的 SEP 必须一致（改一处要两处一起改） */
  const SEP = '__HP__';

  /** 会话名可能带空格/特殊字符，发给远端前一律单引号包起来（转义内部的单引号） */
  const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

  const Sessions = {
    list: [],            // [{name, windows, attached, activityMs, createdMs}]
    sel: '',             // 当前选中的会话名（用户点过就记它）
    at: 0,
    err: '',
    name: 'hermes',      // 没有会话时创建的默认会话名

    /**
     * 解析 `tmux list-sessions -F ...` 的原始输出（**纯函数**：测试台直接喂真实输出）。
     * 远端没跑 tmux 时输出形如 `no server running on /tmp/tmux-1000/default`（我们带了 2>&1）——
     * 这种要返回空列表 + 原因，而不是抛错。
     */
    parse(raw) {
      const out = { list: [], err: '' };
      const text = String(raw == null ? '' : raw).trim();
      if (!text) return out;
      if (/no server running|no such file or directory|command not found|error connecting/i.test(text) && text.indexOf(SEP) < 0) {
        out.err = text.split('\n')[0].trim();
        return out;
      }
      const now = Date.now() / 1000;
      text.split('\n').forEach((line) => {
        const p = line.split(SEP);
        if (p.length < 5 || !p[0]) return;
        const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
        out.list.push({
          name: p[0].trim(),
          windows: num(p[1]),
          attached: num(p[2]),
          activityMs: num(p[3]) * 1000,
          createdMs: num(p[4]) * 1000,
          ageSec: num(p[4]) ? Math.max(0, Math.round(now - num(p[4]))) : 0,
          idleSec: num(p[3]) ? Math.max(0, Math.round(now - num(p[3]))) : 0
        });
      });
      return out;
    },

    /** 读远端会话清单（只读 op） */
    async refresh() {
      try {
        const r = await HP.App.rpc('tmux.list', {}, 12000);
        const parsed = this.parse(r && (r.raw || r.out));
        this.list = parsed.list;
        this.err = parsed.err || (r && r.err) || '';
        this.at = Date.now();
        return this.list;
      } catch (e) {
        this.list = []; this.err = String(e.message || e); this.at = Date.now();
        return this.list;
      }
    },

    /** 进哪个会话：用户点过的优先，否则第一个 */
    pick() {
      if (this.sel && this.list.some((s) => s.name === this.sel)) return this.sel;
      return this.list.length ? this.list[0].name : '';
    },

    /** attach 到某个会话（发到终端里，用户能看见） */
    attach(name) {
      const n = name || this.pick();
      if (!n) { HP.App.toast('远端没有 tmux 会话'); return false; }
      this.sel = n;
      /* 已经在 tmux 里就切过去；没在 tmux 里才 attach */
      HP.App.send('tmux attach -t ' + q(n) + '\r');   /* 启动/进入：原版行为，直接 attach 已有会话 */
      HP.App.toast('已切到会话 ' + n);
      return true;
    },

    /** 新建会话（只在真的没有会话时用）；建成后仍然是"常驻不杀" */
    create(name) {
      const n = name || this.name;
      this.sel = n;
      HP.App.send('tmux new -As ' + q(n) + " 'hermes --tui' \\; set -g mouse on\r");
      HP.App.toast('已新建会话 ' + n);
      return true;
    },

    /**
     * **启动流程**（连上之后走一次）：
     *   有 tmux → 不管它，直接 attach（不新建、不重启）；
     *   没有 tmux → 按主机的启动命令建（默认 `tmux new -As hermes 'hermes --tui'`）。
     * 全程只发键盘输入，**不发任何 kill**。
     */
    async bootstrap(opts) {
      const o = opts || {};
      await this.refresh();
      if (this.list.length) {
        const n = this.pick();
        this.attach(n);
        return { action: 'attach', name: n, count: this.list.length };
      }
      const cmd = (HP.App.host && HP.App.host.startCmd) || '';
      if (cmd) { HP.App.send(cmd + '\r'); this.sel = this.name; return { action: 'startCmd', cmd, count: 0 }; }
      this.create();
      return { action: 'create', name: this.name, count: 0 };
    }
  };

  HP.Sessions = Sessions;
})();
