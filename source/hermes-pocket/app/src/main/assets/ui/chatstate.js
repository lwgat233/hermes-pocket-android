/* Hermes Pocket — 聊天输出状态机（HP.ChatState）
 * ===========================================================================
 * 用户的要求（log.md 第 12 条）：**监听聊天界面的输出，识别是否结束、是否在压缩、是否在运行**。
 *
 * 数据来源只有一个：终端里**真实渲染出来的文本**（每来一段输出喂一次 `feed()`）+ 输出静默时长。
 * 判据（谁说了什么）必须先能读回来：每条规则命中都留 `rule` 与 `sample`，
 * 界面上只显示一行字，`explain()` 能说出"为什么判成这样"。
 *
 * 规则依据（**不是猜的**）：这些文案取自本机已安装的 Hermes TUI 产物
 * `/home/lwgat/.hermes/hermes-agent/ui-tui/dist`（grep 原文见 evidence 里的 规则依据 文件）：
 *   · `"Ctrl+C to interrupt…"`              —— 一轮在跑时才出现的提示
 *   · `"Thinking"` / `~N tokens`             —— 推理/流式输出还在继续
 *   · `"compacting"` / `"compacted"`         —— 上下文压缩**进行中 / 刚完成**
 *   · `Compressions: ${n}` / `cmp ${n}`      —— 压缩计数
 *   · `"[interrupted]"`                      —— 这一轮被打断
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]/g;
  const strip = (s) => String(s == null ? '' : s).replace(ANSI, '');

  /** 规则表：**顺序即优先级**。每条都要能说清"凭哪个文案判的" */
  const RULES = [
    { id: 'compacting', state: '压缩中', re: /(^|[^a-z])compacting([^a-z]|$)/i,
      note: 'ui-tui/dist: "compacting"' },
    { id: 'compacted', state: '压缩中', re: /(^|[^a-z])compacted([^a-z]|$)/i,
      note: 'ui-tui/dist: "compacted"（刚压完，仍算压缩态，下一次输出会转回运行）' },
    { id: 'compressions', state: '压缩中', re: /(Compressions|cmp)\s*[:：]?\s*\d+/,
      note: 'ui-tui/dist: `Compressions: ${n}` / `cmp ${n}`' },
    { id: 'interrupted', state: '已结束', re: /\[interrupted\]|\*\[interrupted\]\*/i,
      note: 'ui-tui/dist: "[interrupted]" —— 这一轮被中断' },
    { id: 'interrupt_hint', state: '运行中', re: /Ctrl\+C to interrupt/i,
      note: 'ui-tui/dist: "Ctrl+C to interrupt…" —— 只有在跑的时候才显示' },
    { id: 'thinking', state: '运行中', re: /(^|\W)(Thinking|tokens?|tok)(\W|$)/,
      note: 'ui-tui/dist: "Thinking" / "~N tokens" / "N tok" —— 流式输出还在动' }
  ];

  const ChatState = {
    state: '未知',
    rule: '',
    note: '',
    sample: '',
    since: 0,
    at: 0,
    lastActivity: 0,      // 最近一次收到输出的时间
    transitions: [],      // [{from,to,rule,at}] —— 断言用的迁移序列
    onchange: null,       // (state, info) => void
    quietMs: 3000,        // 静默多久算"已结束/空闲"

    /** 只留最后 20 行可见文本，免得拿十年前的输出判当前状态 */
    tail(text, lines) {
      const t = strip(text).replace(/\r/g, '\n');
      const parts = t.split('\n').filter((x) => x.trim() !== '');
      return parts.slice(-(lines || 20)).join('\n');
    },

    /** 每收到一段终端输出就喂进来（带时间戳，便于静默判定） */
    feed(text, nowMs) {
      const now = nowMs || Date.now();
      this.lastActivity = now;
      const tail = this.tail(text);
      for (const r of RULES) {
        const m = tail.match(r.re);
        if (!m) continue;
        // 压缩类规则命中一次后，后续普通输出要能盖回"运行中"——按优先级顺序天然成立
        this.apply(r.state, r.id, r.note, (m[0] || '').slice(0, 60), now);
        return this.info();
      }
      return this.info();
    },

    /** 每秒（或测试里手动）推进一次：没有输出且有历史状态 → 判定结束 */
    tick(nowMs) {
      const now = nowMs || Date.now();
      this.at = now;
      if (!this.lastActivity) return this.info();
      const quiet = now - this.lastActivity;
      if (quiet >= this.quietMs && (this.state === '运行中' || this.state === '压缩中')) {
        this.apply('已结束', 'quiet', '输出静默 ' + Math.round(quiet / 1000) + ' 秒', '', now);
      }
      return this.info();
    },

    apply(state, rule, note, sample, now) {
      if (state === this.state) { this.at = now; return; }
      const from = this.state;
      this.state = state; this.rule = rule; this.note = note; this.sample = sample;
      this.at = now; this.since = now;
      this.transitions.push({ from, to: state, rule, at: now });
      if (this.transitions.length > 50) this.transitions.shift();
      try { if (this.onchange) this.onchange(state, this.info()); } catch (e) { }
    },

    info() {
      return {
        state: this.state, rule: this.rule, note: this.note, sample: this.sample,
        since: this.since, quietMs: this.lastActivity ? (this.at || Date.now()) - this.lastActivity : 0
      };
    },

    /** 一行字（顶栏用）：状态 + 已经这样多久 */
    label(nowMs) {
      if (this.state === '未知') return '';
      const now = nowMs || Date.now();
      const sec = Math.max(0, Math.round((now - (this.since || now)) / 1000));
      if (this.state === '已结束') return '已结束';
      return this.state + (sec >= 1 ? ' ' + sec + 's' : '');
    },

    /** 为什么判成这样（**误判时要能打印出来**）：规则 id + 依据文案 + 命中的原文片段 */
    explain() {
      const i = this.info();
      if (!i.state || i.state === '未知') return '还没收到聊天输出';
      return i.state + ' ← 规则 ' + (i.rule || '?') + '｜依据：' + (i.note || '?') +
        (i.sample ? '｜命中：' + JSON.stringify(i.sample) : '') +
        '｜静默 ' + Math.round((i.quietMs || 0) / 1000) + 's';
    },

    reset() {
      this.state = '未知'; this.rule = ''; this.note = ''; this.sample = '';
      this.since = 0; this.at = 0; this.lastActivity = 0; this.transitions = [];
    }
  };

  HP.ChatState = ChatState;
  HP.ChatState.RULES = RULES;   // 测试与界面都可以读规则表（自检"哪条依据没被覆盖"）
})();
