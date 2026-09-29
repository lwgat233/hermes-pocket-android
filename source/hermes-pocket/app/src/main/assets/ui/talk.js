/* Hermes Pocket — 频道（多角色协作）
 * 规矩（用户 2026-09-22 定，改版后仍照此）：
 *   1) **全按键，不输指令** —— 点角色行就是跟谁说话；用户只敲"要说的话"。
 *   2) **角色分组后一行一个、等高**（照「主机」页的 .card 行样式，不挤在一行里）。
 *   3) **频道可折叠展开**；1:1 界面按角色**缓存**（看着像多窗口/多条 SSH，实际一条）。
 *   4) 常驻按键 ≤3；不写说明文字；行里不摆 ⋯。
 * 后端全部走 HP.App.rpc('talk.xxx')（原生侧命令固定，用户数据只进参数）。
 */
(function () {
  const HP = (window.HP = window.HP || {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rpc = (op, args) => HP.App.rpc(op, args || {}, 20000);
  const KIND = { broadcast: '📢', private: '🔒', default: '· ' };

  /* 气泡（私聊/群聊共用一套）：强制写清"谁 → 谁"，样式学聊天软件（圆角+名字小字+时间） */
  const bubbleEl = (o) => {
    const box = document.createElement('div');
    const st = box.style;
    st.display = 'flex';
    st.flexDirection = 'column';
    st.maxWidth = '82%';
    st.alignSelf = o.mine ? 'flex-end' : 'flex-start';
    st.background = o.mine ? '#2b6cff' : '#22262f';
    st.color = o.mine ? '#fff' : '#e6e8ee';
    st.borderRadius = '16px';
    st[o.mine ? 'borderBottomRightRadius' : 'borderBottomLeftRadius'] = '6px';
    st.padding = '8px 12px 9px';
    st.marginTop = '8px';
    st.boxShadow = '0 1px 2px rgba(0,0,0,.25)';
    if (o.head) {
      const h = document.createElement('div');
      h.style.fontSize = '11px';
      h.style.opacity = '.82';
      h.style.marginBottom = '3px';
      h.textContent = o.head;
      box.appendChild(h);
    }
    const t = document.createElement('div');
    t.style.fontSize = '14px';
    t.style.lineHeight = '1.5';
    t.style.whiteSpace = 'pre-wrap';
    t.style.wordBreak = 'break-word';
    t.textContent = o.text;
    box.appendChild(t);
    if (o.time) {
      const d = document.createElement('div');
      d.className = 'tk-time';                       /* R-52：状态图标并进这一行（同一行，不加高度） */
      d.style.fontSize = '10px';
      d.style.opacity = '.62';
      d.style.alignSelf = o.mine ? 'flex-end' : 'flex-start';
      d.style.marginTop = '3px';
      d.textContent = o.time;
      box.appendChild(d);
    }
    return box;
  };
  const hhmm = (ts) => { try { const d = new Date((ts || 0) * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } catch (e) { return ''; } };



  /* 气泡样式直接内联：不依赖样式表是否被应用（用户报过"一行一行"，追查成本太高） */
  const BUB = (el, mine) => {
    const st = el.style;
    st.boxSizing = 'border-box';
    st.maxWidth = '82%';
    st.padding = '9px 12px';
    st.borderRadius = '14px';
    st.fontSize = '14px';
    st.lineHeight = '1.45';
    st.whiteSpace = 'pre-wrap';
    st.wordBreak = 'break-word';
    st.marginTop = '6px';
    if (mine) {
      st.alignSelf = 'flex-end';
      st.background = '#2b6cff';
      st.color = '#ffffff';
      st.borderBottomRightRadius = '4px';
    } else {
      st.alignSelf = 'flex-start';
      st.background = '#22262f';
      st.color = '#e6e8ee';
      st.borderBottomLeftRadius = '4px';
    }
    return el;
  };



  /* 本地保存（记录/角色/技巧都留一份在手机上）+ 登录时刷新校验
   * 规矩：网络通 → 拿服务端的并覆写本地；网络不通 → 用本地那份并标"离线"。 */
  const HP_TALK_SEEN = {};
  /* 切过去用什么指令：可配（设置里有键改），{v} 会替换成匹配到的名字 */
  const SW_CFG = {
    cmd: '/resume {v}',
    mode: 'name',   /* name=会话名 / session=hermes 的 session id / role=角色名 / none=不匹配 */
  };
  function swLoad() {
    try { const o = JSON.parse(localStorage.getItem('HP_SWITCH_CFG') || '{}'); if (o && o.cmd) { SW_CFG.cmd = o.cmd; SW_CFG.mode = o.mode || 'name'; } } catch (e) { /* 用默认 */ }
    return SW_CFG;
  }
  function swSave() { try { localStorage.setItem('HP_SWITCH_CFG', JSON.stringify(SW_CFG)); } catch (e) { /* 存不了也不崩 */ } }
  function swBuild(v) { return String(SW_CFG.cmd || '').replace(/\{v\}/g, v); }   /* 见过的角色：做「历史」分组用 */
  /* 落盘统一走 HP.Cache（R-26：节流 + 上限 + 满配额护栏都收在那一处）
   * 分层：小而常用的（roles/asks/sessions/deliveries）全量留；thread.<角色> 只留最近 N 条（设置 cacheMaxItems，默认 50）；
   *       draft.<角色> 按键合并写（500ms），不再一个字母一次 setItem。 */
  const threadMax = () => {
    try { const v = parseInt(HP.App.pref('cacheMaxItems', 50), 10); return (v > 0 ? v : 50); } catch (e) { return 50; }
  };
  const CACHE_OPT = {
    roles: { throttle: 1000, maxBytes: 64 * 1024 },
    asks: { throttle: 1000, maxBytes: 32 * 1024 },
    sessions: { throttle: 1000, maxBytes: 64 * 1024 },
    deliveries: { throttle: 1000, maxItems: 20, maxBytes: 64 * 1024 },
    draft: { throttle: 500 },
    thread: {
      throttle: 1000, maxBytes: 96 * 1024,
      trim: (v) => (v && Array.isArray(v.items) ? Object.assign({}, v, { items: v.items.slice(-threadMax()) }) : v)
    }
  };
  const cacheOpt = (k) => Object.assign({}, CACHE_OPT[String(k).split('.')[0]] || { throttle: 1000 });
  const CACHE = {
    get(k, d) { return HP.Cache.get(k, d); },
    set(k, v) { return HP.Cache.set(k, v, cacheOpt(k)); }
  };
  const rpcCache = async (op, args, key) => {
    try {
      const r = await rpc(op, args);
      if (key) CACHE.set(key, r);
      return r;
    } catch (e) {
      const c = key ? CACHE.get(key, null) : null;
      if (c) { c.__cached = true; return c; }     /* 连不上就用本地那份 */
      throw e;
    }
  };

  /* R-40：会话编号（**前端不造号**）—— 号码只认 talk.sessions[].id（R-26 的 HP.Cache 里已有，不新增请求）
   * · 找号：s.role === full_name 的那条；多条取 alive=true，都 false 取 last_used 最大
   * · 去重：按 **tmux 全名**（同一个 tmux 只留 alive 那条；**绝不按 role** —— QQ 通道是本体、App 入口是第二入口）
   * · 容器会话（roles / hermes）是盒子不是人 ⇒ 不成行
   * · 窗口名＝tmux 冒号后半段；不是「会话:窗口」形态的（如 qqbot:3FDE0CB3…）⇒ 用本人定的叫法「本人-女仆通道」
   * · 一条都没有 ⇒ **不显号**（显「未起会话」），绝不造号 */
  const CONTAINERS = { roles: 1, hermes: 1 };
  /* R-26 的落盘是**节流写**（set 带 throttle ⇒ 隔一会儿才进 localStorage），刚取回的那一刻读盘是空的；
   * 所以这里再留一份**内存**的（首屏就能显号，不用等节流落盘） */
  let SESS_MEM = null;
  const noteSessions = (r) => { if (r && r.sessions) SESS_MEM = r; };
  const sessList = () => {
    const c = SESS_MEM || CACHE.get('sessions', null);
    const byTmux = {};
    (((c || {}).sessions) || []).forEach((s) => {
      if (!s) return;
      const t = String(s.tmux || '');
      if (!t || CONTAINERS[t]) return;
      if (!byTmux[t] || (s.alive && !byTmux[t].alive)) byTmux[t] = s;
    });
    return Object.keys(byTmux).map((k) => byTmux[k]);
  };
  /* R-40 修正：**通道目标**（tmux 不是「会话:窗口」形态，如 qqbot:3FDE0CB3…）——
   * 身份用本人定的**固定标签**（不取平台 title/name），不参与「已废」判定、恒在线。 */
  const winForm = (tmux) => /^[^:]+:[A-Za-z][A-Za-z0-9_-]*$/.test(String(tmux || ''));
  /* 通道目标＝**有冒号但窗口段不是可读窗口名**（qqbot:3FDE0CB3… 这种机器串）；
   * 裸 tmux 名（role-pipeline-tester / solo-…）不是通道，照旧按 alive 判「已废」 */
  const chanForm = (tmux) => { const s = String(tmux || ''); return s.indexOf(':') > 0 && !winForm(s); };
  const isChan = (s) => !!s && chanForm(s.tmux);
  const CHAN_IDENT = '女仆（本人通道）';
  const winName = (s) => {
    if (isChan(s)) return CHAN_IDENT;
    const w = String((s && s.tmux) || '').split(':')[1] || '';
    return w || CHAN_IDENT;
  };
  const sessInfo = (full) => {
    const mine = sessList().filter((s) => s.role === full);
    if (!mine.length) return null;
    const pick = mine.filter((s) => s.alive)[0] ||
      mine.slice().sort((a, b) => (b.last_used || 0) - (a.last_used || 0))[0];
    return { id: pick.id, win: winName(pick), alive: !!pick.alive, tmux: pick.tmux, s: pick };
  };
  /* 角色卡副行 / 信息窗「会话」行共用同一份映射（同号同人） */
  const sessLabel = (full) => {
    const i = sessInfo(full);
    return i ? ('#' + i.id + ' · ' + i.win) : (String(full || '') + ' · 未起会话');
  };
  /* 会话列表那两处只要个前缀；取不到号返回空串（不造号） */
  const idTag = (full) => { const i = sessInfo(full); return i ? ('#' + i.id + ' ') : ''; };

  /* ---- R-41：单行输入框的「回车发送」（三条兜底 + 一把闸）-----------------
   * 为什么要有兜底：有些输入法**只给 beforeinput/keyup、不给 keydown**（"按回车没反应"的机制就在这里）。
   * · `enterkeyhint=send`：软键盘右下角显示「发送」
   * · 三条路：keydown(Enter)（主）→ keyup(13) / beforeinput(insertLineBreak|insertParagraph)（兜底）
   * · **一把闸**：同一次回车（三条路同时触发）只发 1 条 —— 400ms 时间窗；
   *   但**新来一个 keydown 就把窗口清零** ⇒ 用户连按两次是真按键，照样发两条（不吞第二次）。
   * · **Shift+Enter 一律不发送**（A 案：单行框本来也不支持换行）；
   * · **组字中不抢先发**（compositionend 之前不发送，Enter 交给输入法确认候选）。
   */
  const bindEnterSend = (inp, fire) => {
    if (!inp) return inp;
    inp.setAttribute('enterkeyhint', 'send');
    let sentAt = 0, composing = false, compTimer = null, shiftAt = 0;
    const isEnter = (e) => !!(e && (e.key === 'Enter' || e.keyCode === 13));
    const now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    /* R-41 修正①：**只拦 `keyCode === 229`**（那才是真正的 IME 合成中间态）；
     * `isComposing === true` 不再单独拦 —— Gboard 的 Enter 是 `isComposing=true` + `keyCode=13`，
     * 那正是"确认/上屏并发送"，就是本人要的行为（真机 R41-3 定位：老守卫把整条路吞了）。 */
    const imeMid = (e) => !!(e && e.keyCode === 229);
    /* R-45：Shift 改成**时间戳闩**（原来 `shiftDown` 布尔会被 keyup 的清零覆盖 —— 见下 keyup 的注释）。
     * 判据＝"最近 400ms 内按过 Shift"，闩会自己过期（不粘滞）。 */
    const shifted = () => !!(shiftAt && now() - shiftAt < 400);
    const go = (e) => {
      if (imeMid(e)) return;                              /* 合成中间态：交给输入法，不发 */
      if (shifted()) return;                              /* Shift+Enter：不发送 */
      const t = now();
      if (t - sentAt < 400) return;                       /* 同一次回车的三条路：只发 1 条 */
      sentAt = t;
      fire(inp);
    };
    inp.addEventListener('keydown', (e) => {
      /* R-45：Shift 的 keydown 在真机上可能带 `shiftKey=false` ⇒ **必须同时认 `e.key === 'Shift'`** */
      if (e && (e.key === 'Shift' || e.shiftKey === true)) shiftAt = now();
      if (!isEnter(e)) return;
      if (imeMid(e)) return;                              /* 中间态：不拦也不发 */
      if (shifted()) { e.preventDefault(); return; }       /* Shift+Enter：不发送（单行框也不换行） */
      sentAt = 0;                                          /* 真按键 ⇒ 重置窗口（连按两次要发两条） */
      go(e);
    });
    inp.addEventListener('keyup', (e) => {
      /* R-45（祸根行）：**只记 true、绝不用 keyup 清零**。
       * 原来写 `shiftDown = e.shiftKey`，遇到「Shift 先松、Enter 后松」时那一下 keyup 带 `shiftKey=false`，
       * 把 Shift 状态覆盖回假 ⇒ 后面的 Enter 被当普通回车发出去。 */
      if (e && e.shiftKey) shiftAt = now();
      if (isEnter(e)) go(e);
    });
    inp.addEventListener('beforeinput', (e) => {
      const ty = e && e.inputType;
      if (ty === 'insertLineBreak' || ty === 'insertParagraph') go(e);
    });
    /* R-41 修正②：组字态**必须有兜底退出**（不许再出现"永久 composing"）——
     * `compositionstart` 后 1.5s 无条件复位；`compositionend` 照旧立即复位；谁先到算谁。
     * 注意：composing 现在**只做状态记录**，不再拿它拦 Enter（口径①）。 */
    inp.addEventListener('compositionstart', () => {
      composing = true;
      if (compTimer) clearTimeout(compTimer);
      compTimer = setTimeout(() => { composing = false; compTimer = null; }, 1500);
    }, { passive: true });
    inp.addEventListener('compositionend', () => {
      composing = false;
      if (compTimer) { clearTimeout(compTimer); compTimer = null; }
    }, { passive: true });
    inp.__enterState = () => ({ composing: composing, sentAt: sentAt, timer: !!compTimer });   /* 探针/排查读数 */
    return inp;
  };

  const Talk = {
    roles: [], msgs: [], last: 0, view: 'channel', sel: null, busy: false, timer: null,
    withPrivate: true, live: true,
    chOpen: false,                 /* 「频道」折叠状态 */
    cache: {},                     /* role -> 上次读到的会话输出（切回来秒显，充当"多窗口"） */
    asks: [],
    sends: [],                     /* R-31：最近几条发送的状态（发送中 / 已送达◯◯ms / 没送达:原因） */
    sendSeq: 0,
    showHidden: false,             /* R-53：长按菜单里的「显示已删除」（从 pref 读，见 initTalk） */

    onShow(tab) { this.tab = tab || 'talk'; try { this.showHidden = HP.App.bool('showHidden', false); } catch (e) { } this.verifySync().catch(() => { }); this.render(); this.startPoll(); },
    onHide() { this.stopPoll(); },
    /* 轮询周期：前台一律 2.5s（实时）；省电档按设置（R-25，与「聊天要实时」的冲突交本人定，这里只给档位）——
     *   slow30（默认，作者推荐）：省电时降到 30s —— 牺牲：新消息最多晚 30s 才亮，亮屏立刻补一次
     *   pause：省电时完全停轮询 —— 牺牲：后台期间完全不刷（省得最干净）
     *   realtime：省电时也 2.5s —— 牺牲：省电基本白省（30 分钟 ≈720 次 talk.since，每次还走 SSH 起 python） */
    POLL_MS: 2500,
    POLL_SAVE_MS: 30000,
    pollDelay() {
      if (!this._powerSave) return this.POLL_MS;
      let mode = 'slow30';
      try { mode = HP.App.pref('talkPollSave', 'slow30'); } catch (e) { /* 读不到设置就用推荐档 */ }
      if (mode === 'realtime') return this.POLL_MS;
      if (mode === 'pause') return 0;
      return this.POLL_SAVE_MS;
    },
    startPoll() {
      this.stopPoll();
      if (!this.live) return;
      const ms = this.pollDelay();
      this._pollOff = false;
      if (!ms) { this._pollOff = true; return; }        /* pause 档：省电时不开表，回前台由 onPowerSave(false) 补一次 */
      this.timer = setInterval(() => {
        if (this._powerSave) this._pollInSave = (this._pollInSave || 0) + 1;
        this.tick().catch(() => { });
        /* R-32：这里原来还有一句 this.pullRoleOutput(this.sel) —— 那个方法**从来没定义过**，
         * 每 2.5s 抛一条 unhandled rejection（实测 30s 12 条）。按作者口径**删调用、不补定义**。 */
      }, ms);
    },
    stopPoll() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
    /* 省电进出（app.js 的 pauseWork/resumeWork 会调）：轮询按档位重排 + 把「只在看得见时才有意义」的表一起收掉 */
    onPowerSave(on) {
      this._powerSave = !!on;
      if (on) {
        this._pollInSave = 0;
        this.stopSendTicker();                        /* R-31 的 500ms 发送状态表：省电期间不刷 */
        try { HP.Cache.flush(); } catch (e) { /* 缓存节流表先落盘，别留着定时器空转 */ }
        this.startPoll();                             /* 按档位重排（pause 档会直接关表） */
      } else {
        this.startPoll();                             /* 回前台：按档位开表 */
        if (this.live) this.tick().catch(() => { });  /* 亮屏/回前台立刻补一次，不等下一个周期 */
      }
    },
    pollStats() {
      const ms = this.pollDelay();
      return { 省电: !!this._powerSave, 间隔秒: ms ? Math.round(ms / 100) / 10 : 0, 省电期间轮询次数: this._pollInSave || 0 };
    },

    async refreshRoles() {
      const r = await rpcCache('talk.roles', {}, 'roles');
      const scenes = (r && r.scenes) || [];
      this.offline = !!(r && r.__cached);
      this.channels = (r && r.channels) || {};
      this.roles = [];
      scenes.forEach((s) => (s.roles || []).forEach((x) => { x.scene = s.scene; this.roles.push(x); }));
      /* R-40：编号要用的 talk.sessions 也在这一步取（同一个 op、命中 R-26 缓存就不发请求）；
       * 放在画卡片之前 ⇒ 首屏卡片副行/信息窗就能显 #id，而不是先显一屏「未起会话」 */
      try { noteSessions(await rpcCache('talk.sessions', {}, 'sessions')); } catch (e) { /* 离线：卡片显「未起会话」 */ }
    },

    /* 每次"登录进来"（进频道页）刷新校验：角色 / 等你授权 / 频道接入表 */
    async verifySync() {
      const out = { ok: true, roles: 0, asks: 0, chans: 0 };
      try {
        const r = await rpc('talk.roles');
        CACHE.set('roles', r);
        out.roles = (r && r.scenes ? r.scenes : []).reduce((n, x) => n + (x.roles || []).length, 0);
        out.chans = r && r.channels ? Object.keys(r.channels).length : 0;
      } catch (e) { out.ok = false; }
      try { const a = await rpc('talk.asks'); CACHE.set('asks', a); out.asks = (a && a.count) || 0; }
      catch (e) { out.ok = false; }
      this.lastSync = { at: Date.now(), ...out };
      HP.App.toast(out.ok
        ? ('已同步：' + out.roles + ' 个角色 · ' + out.asks + ' 条等你授权 · ' + out.chans + ' 个频道')
        : '连不上服务端：显示本地保存的那份', 4000);
      return out;
    },

    /* 每次进频道页核对一次：库 / tmux / 中转站 + 每个角色是否真有会话 */
    async paintDoctor(line, btn) {
      try {
        const d = await rpc('talk.doctor', {});
        const miss = d.missing || [];
        if (!d.db || (d.roles_total || 0) === 0) {
          line.textContent = '服务端：还没搭建 —— 点右边「搭服务端」';
        } else {
          line.textContent = '服务端：' + (d.roles_total || 0) + ' 个角色 · ' +
            (miss.length ? ('缺 ' + miss.length + ' 个会话') : '会话齐') +
            ' · 中转站' + (d.relay === 'active' ? '在跑' : '没跑');
        }
        if (btn) btn.style.display = (miss.length || !d.db || (d.roles_total || 0) === 0) ? '' : 'none';
      } catch (e) {
        line.textContent = '服务端：连不上（' + e.message + '）';
      }
    },

    async refreshAsks() {
      try { const r = await rpcCache('talk.asks', {}, 'asks'); this.asks = (r && r.asks) || []; }
      catch (e) { this.asks = []; }
    },

    async tick() {
      const r = await rpc('talk.since', { id: this.last });
      const list = (r && r.messages) || [];
      if (list.length) {
        list.forEach((m) => this.msgs.push(m));
        if (this.view === 'channel' && this.live) this.paintStream();
      }
      this.last = r && r.last != null ? r.last : this.last;
    },

    async render() {
      const group = this.tab === 'group';
      const el = document.getElementById(group ? 'tab-group' : 'tab-talk');
      if (!el) return;
      el.textContent = '';
      if (group) { this.paintGroup(el); this.paintSends(el); return; }
      try {
        await this.refreshRoles();
        await this.refreshAsks();
        if (!this.last) {
          const r = await rpc('talk.since', { id: 0 });
          /* 桥回的不是 JSON（= 那条命令自己失败了）⇒ 露出来，别静默成"0 条消息"（R52R53#4） */
          if (r && r.raw !== undefined) {
            this.rpcErr = String(r.raw || '').trim().split('\n')[0].slice(0, 120) || '（命令没有输出）';
            this.rpcCmd = r.cmd || '';
            HP.App.toast('频道取数失败：' + this.rpcErr, 5200);
          } else { this.rpcErr = ''; this.rpcCmd = ''; }
          this.last = (r && r.last) || 0; this.msgs = (r && r.messages) || [];
        }
      } catch (e) { HP.App.toast('连不上频道：' + e.message); }
      try { (this.view === 'role' && this.sel) ? this.paintRole(el) : this.paintChannel(el); }
      catch (e) { el.textContent = '频道画不出来：' + e.message; }
      this.paintSends(el);
    },

    /* ---------------- 频道页 ---------------- */
    paintChannel(el) {
      const head = document.createElement('div');
      head.className = 'tk-row';
      head.appendChild(this.toggle('实时', this.live, (v) => { this.live = v; v ? this.startPoll() : this.stopPoll(); this.render(); }));
      head.appendChild(this.toggle('含私信 🔒', this.withPrivate, (v) => { this.withPrivate = v; this.paintStream(); }));
      el.appendChild(head);

      /* 服务端状态（每次进频道页核对）：几个角色、缺几个会话、中转站在跑吗 */
      const sl = document.createElement('div');
      sl.className = 'tk-title';
      if (this.rpcErr) {                                             /* R52R53#4：失败要看得见，且**不被后面覆盖** */
        const er = document.createElement('div');
        er.className = 'tk-title';
        er.id = 'tk-rpcerr';
        er.textContent = '取数失败：' + this.rpcErr;
        el.appendChild(er);
      }
      sl.id = 'tk-serverline';
      sl.textContent = '服务端：核对中…';
      el.appendChild(sl);
      const sb = document.createElement('button');
      sb.className = 'tk-chip';
      sb.id = 'tk-setupbtn';
      sb.setAttribute('data-testid', 'talk-setupbtn');
      sb.textContent = '搭服务端';
      sb.style.display = 'none';
      sb.addEventListener('click', async () => {
        sb.textContent = '正在搭…';
        try {
          const r = await rpc('talk.setup', {});
          const d = (r && r.doctor) || {};
          HP.App.toast('服务端已就绪：' + (d.roles_total || 0) + ' 个角色' +
            ((d.missing || []).length ? ('，还缺 ' + (d.missing || []).length + ' 个会话') : ''));
          this.render();
        } catch (e) { HP.App.toast('搭失败：' + e.message, 5000); }
      });
      el.appendChild(sb);
      this.paintDoctor(sl, sb);

      /* 等你授权：谁在等你答、等什么 —— 答完自动消失（放最上面，怕你漏看） */
      if (this.asks.length) {
        el.appendChild(this.title('等你授权（' + this.asks.length + '）'));
        const box = document.createElement('div');
        box.className = 'tk-asks';
        box.id = 'tk-asks';
        this.asks.forEach((k) => box.appendChild(this.askRow(k)));
        el.appendChild(box);
      }

      /* 跟谁说：按场景分组，**一个角色一行、等高**（照主机页的 .card） */
      el.appendChild(this.title('跟谁说'));
      const scenes = {};
      this.roles.forEach((r) => (scenes[r.scene || '?'] = scenes[r.scene || '?'] || []).push(r));
      const keys = Object.keys(scenes).sort();
      if (!keys.length) el.appendChild(this.hint('（还没拉到角色）'));
      keys.forEach((sc) => {
        const cap = document.createElement('div');
        cap.className = 'tk-scene';
        cap.textContent = sc;
        el.appendChild(cap);
        scenes[sc].forEach((r) => el.appendChild(this.roleCard(r)));
      });

      /* ＋ 新角色（客户端直接建） */
      const addb = document.createElement('button');
      addb.className = 'tk-act';
      addb.id = 'tk-addrole';
      addb.setAttribute('data-testid', 'talk-addrole');
      addb.textContent = '＋ 新角色';
      const form = document.createElement('div');
      form.className = 'tk-asks';
      form.id = 'tk-addform';
      form.style.display = 'none';
      [['scene', '场景（组）'], ['name', '角色名'], ['title', '一句话描述'], ['tags', '标签（可空）']].forEach((f) => {
        const i = document.createElement('input');
        i.className = 'tk-askin';
        i.id = 'tk-new-' + f[0];
        i.placeholder = f[1];
        form.appendChild(i);
      });
      const mk = document.createElement('button');
      mk.className = 'tk-act';
      mk.id = 'tk-new-ok';
      mk.textContent = '建';
      mk.addEventListener('click', async () => {
        const g = (kk) => (document.getElementById('tk-new-' + kk).value || '').trim();
        if (!g('scene') || !g('name')) { HP.App.toast('场景和角色名得填'); return; }
        try {
          const r = await rpc('talk.reg', { scene: g('scene'), name: g('name'), title: g('title'), tags: g('tags') });
          HP.App.toast('已建角色：' + ((r && r.full) || (g('scene') + '.' + g('name'))));
          this.render();
        } catch (e) { HP.App.toast('建失败：' + e.message); }
      });
      form.appendChild(mk);
      addb.addEventListener('click', () => {
        form.style.display = form.style.display === 'none' ? 'flex' : 'none';
      });
      el.appendChild(addb);
      el.appendChild(form);

      /* 频道（可折叠）：折着只看一行，展开看谁能收到 */
      const chs = Object.keys(this.channels || {}).sort();
      const sec = document.createElement('button');
      sec.className = 'row-item tk-sec';
      sec.id = 'tk-channels-toggle';
      sec.setAttribute('data-testid', 'talk-channels');
      sec.innerHTML = '<div class="row1"><span class="name">频道（' + chs.length + '）</span>' +
        '<span class="tk-caret">' + (this.chOpen ? '▾' : '▸') + '</span></div>';
      sec.addEventListener('click', () => { this.chOpen = !this.chOpen; this.render(); });
      el.appendChild(sec);
      if (this.chOpen) {
        const cl = document.createElement('div');
        cl.className = 'tk-exp';
        cl.id = 'tk-channels';
        if (!chs.length) cl.appendChild(this.hint('（接入表是空的）'));
        chs.forEach((c) => {
          const d = document.createElement('div');
          d.className = 'tk-chrow';
          d.innerHTML = '<span class="tk-chname">' + esc(c) + '</span><span class="tk-chwho">' +
            esc((this.channels[c] || []).join('、')) + '</span>';
          cl.appendChild(d);
        });
        el.appendChild(cl);
      }

      /* 常驻按键（含上面「＋ 新角色」共 3 个） */
      const acts = document.createElement('div');
      acts.className = 'tk-acts';
      const shout = document.createElement('button');
      shout.className = 'tk-act';
      shout.setAttribute('data-testid', 'talk-shout');
      shout.textContent = '🗣 全体喊话';
      shout.addEventListener('click', () => this.ask('全体', 'broadcast'));
      acts.appendChild(shout);
      const solo = document.createElement('button');
      solo.className = 'tk-act';
      solo.setAttribute('data-testid', 'talk-solo');
      solo.textContent = '＋ 新对话（只对我）';
      solo.addEventListener('click', () => this.newSolo());
      acts.appendChild(solo);
      el.appendChild(acts);

      el.appendChild(this.title('上次聊过'));
      const hist = document.createElement('div');
      hist.className = 'tk-hist';
      hist.id = 'tk-hist';
      el.appendChild(hist);
      this.paintHistory(hist);

      const goGroup = document.createElement('button');
      goGroup.className = 'tk-act';
      goGroup.id = 'tk-gogroup';
      goGroup.textContent = '去群聊 →';
      goGroup.addEventListener('click', () => HP.App.showBoard('group'));
      el.appendChild(goGroup);
    },

    /* ---------------- 群聊栏目（独立一页） ---------------- */
    paintGroup(el) {
      el.appendChild(this.title('群聊'));
      const stream = document.createElement('div');
      stream.className = 'tk-chat';
      stream.id = 'tk-stream';
      stream.style.display = 'flex';
      stream.style.flexDirection = 'column';
      stream.style.maxHeight = '54vh';
      stream.style.overflowY = 'auto';
      /* 我们自己按「被删节点高度」补偿 scrollTop（见 paintStream 的裁旧），
       * 所以关掉浏览器的滚动锚定（overflow-anchor）：不然两个机制叠加，
       * 同样的代码在桌面 Chromium 与 Android WebView 上会跑出不同的可见位置。 */
      stream.style.overflowAnchor = 'none';
      el.appendChild(stream);
      this.paintStream();

      const gline = document.createElement('div');
      gline.className = 'tk-askline';
      const gin = document.createElement('input');
      gin.className = 'tk-askin';
      gin.id = 'tk-shoutin';
      gin.setAttribute('data-testid', 'talk-shoutin');
      gin.placeholder = '在群里说一句（= 广播给全体）';
      const gok = document.createElement('button');
      gok.className = 'tk-act';
      gok.id = 'tk-shoutok';
      gok.setAttribute('data-testid', 'talk-shoutok');
      gok.textContent = '广播';
      const gfire = async () => {
        const text = (gin.value || '').trim();
        if (!text) { HP.App.toast('先说点什么'); return; }
        gin.value = '';
        await this.send('全体', 'broadcast', text);
      };
      gok.addEventListener('click', gfire);
      bindEnterSend(gin, gfire);                      /* R-41：回车发送（三条兜底 + 400ms 闸） */
      gline.appendChild(gin);
      gline.appendChild(gok);
      const wc2 = document.createElement('button');
      wc2.className = 'tk-chip' + (this.asWho === 'owner.me' ? ' on' : '');
      wc2.id = 'tk-whosay2';
      wc2.textContent = this.asWho === 'owner.me' ? '经理说' : '本人说';
      wc2.addEventListener('click', () => {
        this.asWho = (this.asWho === 'owner.me' ? 'me' : 'owner.me');
        this.render();
      });
      gline.appendChild(wc2);
      el.appendChild(gline);

      /* 投递台账：谁收了、谁没收、为什么 */
      const db = document.createElement('button');
      db.className = 'tk-chip';
      db.id = 'tk-delivbtn';
      db.setAttribute('data-testid', 'talk-delivbtn');
      db.textContent = this.delivOpen ? '收起台账' : '投递台账';
      db.addEventListener('click', () => { this.delivOpen = !this.delivOpen; this.render(); });
      el.appendChild(db);
      if (this.delivOpen) {
        const box = document.createElement('div');
        box.className = 'tk-hist';
        box.id = 'tk-deliv';
        box.textContent = '（读取中…）';
        el.appendChild(box);
        this.paintDeliveries(box);
      }
    },

    async paintDeliveries(box) {
      try {
        const r = await rpcCache('talk.deliveries', { limit: 20 }, 'deliveries');
        const items = (r && r.items) || [];
        box.textContent = '';
        if (!items.length) { box.textContent = '（还没有投递记录）'; return; }
        items.forEach((d) => {
          const row = document.createElement('div');
          row.className = 'tk-hist-row';
          row.textContent = '#' + d.msg + ' → ' + d.role + '  ' + (d.ok ? '✓ 已投' : '✗ ' + (d.note || '没投成'));
          box.appendChild(row);
        });
      } catch (e) { box.textContent = '读不到台账：' + e.message; }
    },

    /* 一个角色 = 一行等高卡片（名称 / 副行 / 能接入的标签） */
    roleCard(r) {
      const b = document.createElement('button');
      b.className = 'card tk-rolecard' + (r.state === 'paused' ? ' paused' : '') + (r.online ? ' online' : '');
      b.setAttribute('data-role', r.full_name);
      b.setAttribute('data-testid', 'talk-role');
      const row1 = document.createElement('div');
      row1.className = 'row1';
      row1.innerHTML = '<span class="tk-dot"></span><span class="name">' + esc(r.title || r.name) + '</span>' +
        (r.pending ? '<span class="tk-badge">' + r.pending + '</span>' : '') +
        '<span class="tk-caret">›</span>';
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = sessLabel(r.full_name) + (r.online ? '' : (r.state === 'paused' ? ' · 被停' : ' · 不在线'));
      b.appendChild(row1);
      b.appendChild(sub);
      /* R-42：信息窗入口挪到**卡片右侧的箭头热区**（≥44dp，照 R-33 硬线）——
       * 热区是卡片右缘一条 44px 宽、整卡高的透明块（不占排版、不撑高卡片）；箭头符号还是 row1 里那个 › */
      b.style.position = 'relative';
      const caretHit = document.createElement('span');
      caretHit.className = 'tk-carethit';
      caretHit.setAttribute('data-testid', 'talk-rolecaret');
      caretHit.setAttribute('role', 'button');
      caretHit.addEventListener('click', (e) => { e.stopPropagation(); this.openRoleSheet(r.full_name); });
      b.appendChild(caretHit);
      /* 接入频道：复用 .sub 一行（不新增 CSS）；channels=[] 的角色这条不显示，卡片保持 60dp */
      const chans = (r.channels || []);
      if (chans.length) {
        const ch = document.createElement('div');
        ch.className = 'sub';
        ch.setAttribute('data-testid', 'talk-rolechans');
        ch.textContent = '接入频道：' + chans.join('、');
        b.appendChild(ch);
      }
      b.addEventListener('click', () => this.openRole(r.full_name));   /* R-42：卡片单击＝一步进单聊 */
      return b;
    },

    /* 一行「等你授权」：谁 / 等什么 / 敲一句就答 */
    askRow(k) {
      const row = document.createElement('div');
      row.className = 'tk-ask';
      row.setAttribute('data-ask', String(k.id));
      const head = document.createElement('div');
      head.className = 'tk-askhead';
      head.textContent = k.from + '　' + (k.topic || '');
      const what = document.createElement('div');
      what.className = 'tk-askbody';
      what.textContent = (k.body || '').replace(/^【[^】]*】来自[^\n]*\n/, '');
      const line = document.createElement('div');
      line.className = 'tk-askline';
      const inp = document.createElement('input');
      inp.className = 'tk-askin';
      inp.placeholder = '只说你要说的话';
      const ok = document.createElement('button');
      ok.className = 'tk-act';
      ok.textContent = '答复';
      /* R-41：这个框原来连 Enter 都没挂 —— 把发送抽成 reply()，给「答复」键与回车共用（同一套兜底口径） */
      const reply = async () => {
        const text = (inp.value || '').trim();
        if (!text) { HP.App.toast('先说点什么'); return; }
        try {
          await rpc('talk.answer', { id: String(k.id), text: text });
          inp.value = '';                              /* R-41：发完清空（配合 400ms 闸防重复） */
          HP.App.toast('答复已回给 ' + k.from);
          this.render();
        } catch (e) { HP.App.toast('答复失败：' + e.message); }
      };
      ok.addEventListener('click', reply);
      bindEnterSend(inp, reply);
      line.appendChild(inp); line.appendChild(ok);
      row.appendChild(head); row.appendChild(what); row.appendChild(line);
      return row;
    },

    title(t) { const d = document.createElement('div'); d.className = 'tk-title'; d.textContent = t; return d; },
    hint(t) { const d = document.createElement('div'); d.className = 'tk-hint'; d.textContent = t; return d; },

    /* ---- 钉底（R-29）：群聊/单聊共用一个入口 ------------------------------
     * 群聊原先是漏的：paintStream 与 paintGroup 都不设 scrollTop，也没有「在不在底部」的状态。
     * 现在状态挂在容器上：box._pinned = 用户此刻在不在底部（一条 scroll 监听维护）。
     * 规矩：只有「本来就在底部」或 force（切栏目/首次渲染）才往下钉；
     * 用户手动上翻后**不抢回**，改用「⇣ 回到底部（新 N 条）」给一条路回去。
     */
    NEAR_BOTTOM: 24,
    isNearBottom(box) {
      if (!box) return true;
      return (box.scrollHeight - box.clientHeight - box.scrollTop) <= this.NEAR_BOTTOM;
    },
    /* 「用户刚才在不在底部」要用**上一次渲染结束时的高度**算（box._lastHeight）：
     * 只靠 scroll 监听会漏 —— 有人用代码改 scrollTop（或事件还没派发）时，缓存的状态是旧的，
     * 下一次重画就会把用户抢回底部。用旧高度量差距，即时改也不抢回。 */
    wasAtBottom(box) {
      if (!box) return true;
      if (box._lastHeight === undefined) return true;                     /* 首次渲染：就当在底部 */
      return (box._lastHeight - box.clientHeight - box.scrollTop) <= this.NEAR_BOTTOM;
    },
    bindScroll(box) {
      if (!box || box._pinBound) return;
      box._pinBound = true;
      this._scrollBound = true;                 /* 有人（探针/自检）拿这个看「挂了滚动监听没有」 */
      box.addEventListener('scroll', () => {
        const near = this.isNearBottom(box);
        box._pinned = near;
        if (near) box._newCount = 0;
        this.paintBackChip(box);
      });
    },
    backChip(box) {
      if (box._chip && box._chip.isConnected) return box._chip;
      const b = document.createElement('button');
      b.className = 'tk-chip tk-backchip';
      b.id = 'tk-backchip-' + (box.id || 'x');
      b.setAttribute('data-testid', 'talk-backchip');
      b.style.display = 'none';
      b.style.alignSelf = 'center';
      b.addEventListener('click', () => {
        box.scrollTop = box.scrollHeight;
        box._pinned = true;
        box._newCount = 0;
        this.paintBackChip(box);
      });
      if (box.parentNode) box.parentNode.insertBefore(b, box.nextSibling);
      box._chip = b;
      return b;
    },
    paintBackChip(box) {
      if (!box) return;
      const b = this.backChip(box);
      const n = box._newCount || 0;
      if (box._pinned) {
        b.style.display = 'none';
        b.textContent = '';
        b.setAttribute('data-count', '0');
        return;
      }
      b.style.display = '';
      b.textContent = n > 0 ? ('⇣ 回到底部（新 ' + n + ' 条）') : '⇣ 回到底部';
      b.setAttribute('data-count', String(n));
    },
    pinBottom(box, opts) {
      if (!box) return;
      const o = opts || {};
      this.bindScroll(box);
      if (o.force || this.wasAtBottom(box)) {
        box.scrollTop = box.scrollHeight;
        box._pinned = true;
        box._newCount = 0;
      } else if (o.added) {
        box._newCount = (box._newCount || 0) + o.added;
      }
      box._lastHeight = box.scrollHeight;      /* 记下这次渲染完的高度，下次拿它判「刚才在不在底部」 */
      this.paintBackChip(box);
    },

    /* 群聊流：**只追加不整块重建**（上翻时 DOM 不重排、位置天然稳；长列表也不卡） */
    paintStream() {
      const s = document.getElementById('tk-stream');
      if (!s) return;
      this.bindScroll(s);
      /* 「用户此刻在不在底部」必须**在动 DOM 之前**取好（R29-4 的红就在这里）：
       * 收满 80 之后，append 会把高度抬上去、裁旧又把它拉回来并把 scrollTop 夹小，
       * 拿变动后的 scrollHeight/scrollTop 去判底必然误判（实测差 97px > 24 → 判成「不在底部」）。 */
      const wasAtBottom = s._pinned === undefined ? true : s._pinned;
      const rows = this.msgs.filter((m) => this.withPrivate || m.kind !== 'private').slice(-80);
      /* 过滤器变了 → 整块重建（否则只追加新行） */
      const sig = 'w' + (this.withPrivate ? 1 : 0);
      if (s._sig !== sig) { s.textContent = ''; s._ids = new Set(); s._sig = sig; s._lastHeight = undefined; }
      if (!s._ids) s._ids = new Set();
      if (!rows.length) {
        if (!s.textContent) s.textContent = '（还没有消息）';
        this.pinBottom(s, { force: true });
        return;
      }
      if (s.children.length === 1 && s.children[0].nodeType === 3) s.textContent = '';   /* 清掉空态那句 */
      let added = 0;
      rows.forEach((m) => {
        if (s._ids.has(m.id)) return;
        const me = m.from === 'owner.me';
        const arrow = m.kind === 'private' ? (' → ' + (m.to || '?')) : (m.kind === 'broadcast' ? ' → 全体' : '');
        const head = (KIND[m.kind] || '') + ' ' + m.from + arrow + (m.topic ? ('　' + m.topic) : '');
        const d = bubbleEl({ mine: me, head: head, text: (m.body || '').split('\n')[0], time: hhmm(m.at) });
        d.className = 'tk-bub ' + (me ? 'me' : 'him');
        if (!me) {
          const hn = document.createElement('span');
          hn.className = 'tk-bubname';
          d.setAttribute('data-from', m.from);
          d.addEventListener('click', () => this.openRoleSheet(m.from));
        }
        d.setAttribute('data-tk-id', String(m.id));
        s.appendChild(d);
        s._ids.add(m.id);
        added++;
      });
      /* 上限裁旧：超过 80 条从头顶去掉；**只有用户上翻时**才补偿 scrollTop（在底部的人最后会被强制钉底）。
       * 补偿量按 scrollHeight 的真实缩减算 —— 不用 offsetHeight：它不含 margin，
       * 一条气泡会少算 8px（实测 3 条差 24px，上翻的锚点就会漂）。 */
      const baseTop = s.scrollTop;
      const baseH = s.scrollHeight;
      while (s.children.length > 80) {
        const first = s.children[0];
        const id = Number(first.getAttribute('data-tk-id'));
        if (!isNaN(id)) s._ids.delete(id);
        s.removeChild(first);
      }
      if (s.scrollHeight !== baseH && !wasAtBottom) {
        s.scrollTop = Math.max(0, baseTop - (baseH - s.scrollHeight));
      }
      /* 收尾判底用**进门时**的状态（不是被裁旧夹过的 scrollTop）：在底部就继续跟着，上翻就只计数 */
      this.pinBottom(s, { added: added, force: wasAtBottom });
    },

    /* 会话列表：分成 在线 / 没在线 / 历史 三组（点一下弹选择窗，不直接切） */
    async paintHistory(el) {
      el.textContent = '';
      let roles = [];
      try { noteSessions(await rpcCache('talk.sessions', {}, 'sessions')); } catch (e) { /* 离线也能看：下面读缓存那份 */ }
      try {
        const rr = await rpcCache('talk.roles', {}, 'roles');
        /* R-40 缺陷③：talk.roles 顶层只有 scenes/channels（**没有 roles**），原来读 r.roles ⇒ 恒空、
         * 「在线/没在线」两个分组永不出现、known 恒空还会把同一人列两条 ⇒ 改成 scenes 展平（同 refreshRoles） */
        ((rr && rr.scenes) || []).forEach((sc) => ((sc && sc.roles) || []).forEach((x) => roles.push(x)));
      } catch (e) { /* 同上 */ }
      if (!roles.length) roles = this.roles || [];
      const sess = sessList();                  /* 已按 tmux 全名去重、已剔容器 */
      roles.forEach((r) => { HP_TALK_SEEN[r.full_name] = 1; });

      const addGroup = (label, rows) => {
        if (!rows.length) return;
        const t2 = this.title(label + '（' + rows.length + '）');
        t2.setAttribute('data-testid', 'talk-group');
        el.appendChild(t2);
        rows.forEach((row) => {
          const b = document.createElement('button');
          b.className = 'tk-chip';
          b.setAttribute('data-testid', 'talk-sessrow');
          b.style.display = 'block';
          b.style.width = '100%';
          b.style.textAlign = 'left';
          b.style.margin = '4px 0';
          b.textContent = (row.label || row.name) + (row.sub ? '　· ' + row.sub : '');
          b.addEventListener('click', () => this.openSessionSheet({ name: row.name, role: row.role, id: row.id }));
          el.appendChild(b);
        });
      };

      /* ① 在线：会话真在跑 */
      const online = roles.filter((r) => r.online).map((r) => ({
        name: (r.title || r.name), role: r.full_name,
        label: idTag(r.full_name) + (r.title || r.name),      /* R-40：行首 #<id> */
        sub: '在跑' + (r.pending ? ' · 欠 ' + r.pending : ''),
      }));
      /* ② 没在线：角色在，会话没起（取不到号 ⇒ 不显号） */
      const offline = roles.filter((r) => !r.online).map((r) => ({
        name: (r.title || r.name), role: r.full_name,
        label: idTag(r.full_name) + (r.title || r.name),
        sub: r.state === 'paused' ? '被停' : '没起会话',
      }));
      /* ③ 历史：见过但现在不在角色表里的（角色删了/会话结束了） */
      const known = {};
      roles.forEach((r) => { known[r.full_name] = 1; });
      const histRows = [];
      Object.keys(HP_TALK_SEEN).forEach((f) => {
        if (known[f]) return;
        histRows.push({ name: f, role: f, sub: '历史（会话已结束）' });
      });
      /* 真历史：hermes 自己的 session 清单（拿到几条是几条） */
      try {
        const h = await rpc('talk.hermesSessions', {});
        ((h && h.items) || []).forEach((it) => {
          const nm = (it.title || it.id || '').split(/\s+/)[0];
          if (!nm) return;
          if (known[nm]) return;
          if (histRows.some((r2) => r2.name === nm)) return;
          histRows.push({ name: nm, role: null, sub: '历史和话（hermes session）' });
        });
      } catch (e) { /* 扫不到就不显示这一块 */ }
      sess.forEach((s) => {
        if (s.role) return;
        histRows.push({ label: '#' + s.id + ' 临时对话', name: s.tmux || s.name, role: null, id: s.id, sub: '普通会话' });
      });

      addGroup('在线', online);
      addGroup('没在线', offline);
      addGroup('历史', histRows);
      if (!online.length && !offline.length && !histRows.length) el.textContent = '（还没有会话）';
    },


    toggle(label, on, fn) {
      const b = document.createElement('button');
      b.className = 'tk-chip' + (on ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => fn(!on));
      return b;
    },

    /* ---------------- 点角色弹出的信息窗 ---------------- */
    openRoleSheet(full) {
      this.sheetRole = this.roles.find((x) => x.full_name === full) || { full_name: full, title: full };
      this.sheetEdit = false;
      this.paintSheet();
    },
    closeSheet() {
      const s = document.getElementById('tk-sheet');
      if (s) s.remove();
      this.sheetRole = null;
    },
    async saveRole() {
      const g = (k) => (document.getElementById('tk-e-' + k).value || '').trim();
      const old = this.sheetRole.full_name;
      try {
        const res = await rpc('talk.role-edit', { role: old, title: g('title'), tags: g('tags'), scene: g('scene') });
        HP.App.toast('已改：' + ((res && res.full) || old));
        this.closeSheet();
        this.render();
      } catch (e) { HP.App.toast('改不了：' + e.message, 5000); }
    },
    paintSheet() {
      const old = document.getElementById('tk-sheet');
      if (old) old.remove();
      const r = this.sheetRole;
      if (!r) return;
      const ov = document.createElement('div');
      ov.className = 'tk-sheet';
      ov.id = 'tk-sheet';
      ov.setAttribute('data-testid', 'talk-sheet');
      const card = document.createElement('div');
      card.className = 'tk-sheetcard';
      const head = document.createElement('div');
      head.className = 'tk-sheethead';
      head.innerHTML = '<span class="tk-dot"></span><span class="name">' + esc(r.title || r.name) + '</span>' +
        '<span class="tk-sheetx" id="tk-sheetx">✕</span>';
      head.querySelector('#tk-sheetx').addEventListener('click', () => this.closeSheet());
      card.appendChild(head);
      [['全名', r.full_name], ['会话', sessLabel(r.full_name)],
       ['状态', r.state === 'paused' ? '被停' : (r.online ? '在线' : '不在线')],
       ['欠回复', String(r.pending || 0)], ['标签', r.tags || '（无）'],
       ['接入频道', (r.channels || []).join('、') || '未接']].forEach((kv) => {
        const d = document.createElement('div');
        d.className = 'tk-sheetrow';
        d.innerHTML = '<span class="tk-k">' + esc(kv[0]) + '</span><span class="tk-v">' + esc(kv[1]) + '</span>';
        card.appendChild(d);
      });
      if (this.sheetEdit) {
        const parts = String(r.full_name).split('.');
        [['title', '描述（一句话）', r.title || ''], ['tags', '标签（逗号分隔）', r.tags || ''],
         ['scene', '场景（组）', parts[0] || ''], ['name', '角色名', parts[1] || '']].forEach((f) => {
          const i = document.createElement('input');
          i.className = 'tk-askin';
          i.id = 'tk-e-' + f[0];
          i.placeholder = f[1];
          i.value = f[2];
          if (f[0] === 'name') { i.disabled = true; i.placeholder = '角色名（改名走命令行）'; }
          card.appendChild(i);
        });
      }
      const acts = document.createElement('div');
      acts.className = 'tk-acts';
      const say = document.createElement('button');
      say.className = 'tk-act';
      say.setAttribute('data-testid', 'talk-sheet-say');
      /* 他绑的是哪个 session（角色只能用这个会话回答） */
      const bd = document.createElement('div');
      bd.className = 'tk-title';
      bd.id = 'tk-rolebind';
      bd.setAttribute('data-testid', 'talk-rolebind');
      bd.textContent = '绑定会话：' + (r.bind || ('默认 roles:' + String(r.full_name || '').replace(/\./g, '-')));
      ov.appendChild(bd);
      say.textContent = '跟他对话';
      say.addEventListener('click', () => { const full = r.full_name; this.closeSheet(); this.openRole(full); });
      acts.appendChild(say);
      const edit = document.createElement('button');
      edit.className = 'tk-act';
      edit.setAttribute('data-testid', 'talk-sheet-edit');
      edit.textContent = this.sheetEdit ? '取消改' : '改信息';
      edit.addEventListener('click', () => { this.sheetEdit = !this.sheetEdit; this.paintSheet(); });
      acts.appendChild(edit);
      if (this.sheetEdit) {
        const save = document.createElement('button');
        save.className = 'tk-act';
        save.setAttribute('data-testid', 'talk-sheet-save');
        save.textContent = '存';
        save.addEventListener('click', () => this.saveRole());
        acts.appendChild(save);
      } else {
        const paused = r.state === 'paused';
        const offline = !r.online;
        const key = document.createElement('button');
        key.className = 'tk-act';
        key.setAttribute('data-testid', 'talk-sheet-power');
        key.textContent = offline ? '拉起他' : (paused ? '恢复他' : '暂停他');
        key.addEventListener('click', async () => {
          try {
            if (offline) await rpc('talk.spawn', { role: r.full_name, launch: true });
            else await rpc(paused ? 'talk.start' : 'talk.pause', { role: r.full_name });
            HP.App.toast(offline ? ('正在拉起 ' + r.full_name) : (paused ? ('已恢复 ' + r.full_name) : ('已暂停 ' + r.full_name)));
            this.closeSheet(); this.render();
          } catch (e) { HP.App.toast('改不了状态：' + e.message, 5000); }
        });
        acts.appendChild(key);
        const del = document.createElement('button');
        del.className = 'tk-act';
        del.setAttribute('data-testid', 'talk-sheet-del');
        del.textContent = '删除他';
        del.addEventListener('click', async () => {
          if (!window.confirm('删掉 ' + r.full_name + '？他的权限和接入也一起清掉')) return;
          try {
            await rpc('talk.role-del', { role: r.full_name, force: true });
            HP.App.toast('已删 ' + r.full_name);
            this.closeSheet(); this.render();
          } catch (e) { HP.App.toast('删不了：' + e.message, 5000); }
        });
        acts.appendChild(del);
      }
      card.appendChild(acts);
      ov.appendChild(card);
      ov.addEventListener('click', (e) => { if (e.target === ov) this.closeSheet(); });
      document.body.appendChild(ov);
    },

    /* ---------------- 跟某个角色单独说（= 一个"窗口"） ---------------- */
    async openRole(full) {
      this.sel = this.roles.find((r) => r.full_name === full) || { full_name: full, title: full };
      this.view = 'role';
      this.render();
    },

    /* 跟某个角色单独说（= 一个"窗口"：草稿/记录都留在这个会话里） */
    async paintRole(el) {
      const r = this.sel || {};
      this.style = this.style || 'chat';
      const full = r.full_name || '';

      const bar = document.createElement('div');
      bar.className = 'tk-row';
      const back = document.createElement('button');
      back.className = 'tk-chip';
      back.setAttribute('data-testid', 'talk-back');
      back.textContent = '← 频道';
      back.addEventListener('click', () => { this.view = 'channel'; this.sel = null; this.render(); });
      bar.appendChild(back);
      bar.appendChild(this.toggle('聊天', this.style === 'chat', () => { this.style = 'chat'; this.render(); }));
      bar.appendChild(this.toggle('终端', this.style === 'term', () => { this.style = 'term'; this.render(); }));
      el.appendChild(bar);

      const head = document.createElement('div');
      head.className = 'tk-title';
      head.textContent = (r.title || r.name) + '\u3000' + (r.state === 'paused' ? '被停' : (r.online ? '在线' : '不在线')) +
        (r.pending ? ' · 欠 ' + r.pending : '');
      this.tapWho(head, r.full_name);          /* R-37 A：抬头是主入口（点一下就开信息窗） */
      el.appendChild(head);

      if (this.style === 'chat') {
        const box = document.createElement('div');
        box.className = 'tk-chat';
        box.id = 'tk-chat';
        box.style.display = 'flex';
        box.style.flexDirection = 'column';
        box.style.maxHeight = '48vh';
        box.style.overflowY = 'auto';
        box.style.overflowAnchor = 'none';   /* 同 #tk-stream：位置只由我们自己的钉底/还原决定 */
        el.appendChild(box);
        this.paintChat(r);
      } else {
        const out = document.createElement('pre');
        out.className = 'tk-term';
        out.id = 'tk-term';
        out.textContent = this.cache[full] || '（正在读他的会话…）';
        el.appendChild(out);
        rpc('talk.capture', { role: full, lines: 200 }).then((c) => {
          const raw = (c && c.raw) || '（没内容）';
          this.cache[full] = raw;
          const b = document.getElementById('tk-term');
          if (b && this.sel && this.sel.full_name === full) b.textContent = raw;
        }).catch((e) => { if (!this.cache[full]) out.textContent = '读不到：' + e.message; });
      }

      /* 选择：这条谁能看见 + 以什么身份说（各一个键，标签写清；不做第二个选择器） */
      const chips = document.createElement('div');
      chips.className = 'tk-row';
      chips.id = 'tk-saychips';
      chips.style.padding = '4px 0';
      const kc = document.createElement('button');
      kc.className = 'tk-chip' + (this.kind === 'default' ? ' on' : '');
      kc.id = 'tk-kindchip';
      kc.setAttribute('data-testid', 'talk-kindchip');
      kc.textContent = this.kind === 'default' ? '可见：他人可见' : '可见：只给他';
      kc.addEventListener('click', () => {
        this.kind = (this.kind === 'default' ? 'private' : 'default');
        this.render();
      });
      chips.appendChild(kc);
      const wc = document.createElement('button');
      wc.className = 'tk-chip' + (this.asWho === 'owner.me' ? ' on' : '');
      wc.id = 'tk-whosay';
      wc.setAttribute('data-testid', 'talk-whosay');
      wc.textContent = this.asWho === 'owner.me' ? '身份：经理说' : '身份：本人说';
      wc.addEventListener('click', () => {
        this.asWho = (this.asWho === 'owner.me' ? 'me' : 'owner.me');
        this.render();
      });
      chips.appendChild(wc);
      el.appendChild(chips);

      /* 输入条：固定在这个会话里（贴底不跨页），草稿按会话各存一份 */
      const line = document.createElement('div');
      line.className = 'tk-askline';
      line.id = 'tk-sayline';
      line.style.position = 'sticky';
      line.style.bottom = '0';
      line.style.background = '#0f1218';
      line.style.display = 'flex';
      line.style.gap = '8px';
      line.style.padding = '8px 0';
      const inp = document.createElement('input');
      inp.className = 'tk-askin';
      inp.id = 'tk-sayin';
      inp.setAttribute('data-testid', 'talk-sayin');
      inp.style.flex = '1 1 auto';
      inp.style.minWidth = '0';
      inp.placeholder = this.style === 'chat' ? '说点什么…' : '说点什么（会送进他的会话）…';
      inp.value = String(CACHE.get('draft.' + full, '') || '');
      inp.addEventListener('input', () => CACHE.set('draft.' + full, inp.value));
      const ok = document.createElement('button');
      ok.className = 'tk-act';
      ok.id = 'tk-sayok';
      ok.setAttribute('data-testid', 'talk-sayok');
      ok.textContent = '发送';
      ok.style.flex = '0 0 auto';
      const fire = async () => {
        const text = (inp.value || '').trim();
        if (!text) { HP.App.toast('先说点什么'); return; }
        inp.value = '';
        CACHE.set('draft.' + full, '');
        await this.send(full, this.kind || 'private', text);
        /* R-32：这里原来有两个 setTimeout 调 this.pullRoleOutput(r)（+2.5s / +6s）—— 该方法没有定义，
         * 到点必抛。按作者口径删掉（发送状态由 R-31/R-36 的状态机负责）。 */
      };
      ok.addEventListener('click', fire);
      bindEnterSend(inp, fire);                       /* R-41：回车发送（三条兜底 + 400ms 闸） */
      line.appendChild(inp);
      line.appendChild(ok);
      el.appendChild(line);
      /* R-39（乙案）：把粘性条高量一次写进 :root 的 `--sayline-h`，内层滚动容器 `#tk-chat` 的 `padding-bottom`
       * 跟着它走（`calc(var(--sayline-h) + var(--safe-b) + 8px)`）—— 字号/安全区一变也不会失配，不写死数字。
       * 共用规则（经理口径，SPEC §10）：凡「粘性/固定底部条」，上方滚动内容必须留 `calc(条高 + var(--safe-b))` 的底部内边距。 */
      const noteH = () => {
        try {
          const h = Math.round(line.getBoundingClientRect().height);
          if (h > 0) document.documentElement.style.setProperty('--sayline-h', h + 'px');
        } catch (e) { /* 量不到就用 CSS 里的默认值 */ }
      };
      noteH();
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(noteH);   /* 布局稳定后再量一次 */
    },

    /* 聊天气泡：我说的靠右蓝、他说的靠左灰；他说的话从会话里捞（不再靠屏幕抠字以外的猜测） */
    async paintChat(r) {
      const box = document.getElementById('tk-chat');
      if (!box) return;
      this.bindScroll(box);
      const wasNear = box._pinned === undefined ? true : this.isNearBottom(box);
      const prevTop = box.scrollTop;
      box.textContent = '';
      let items = [];
      try {
        const th = await rpcCache('talk.thread', { role: r.full_name, limit: 100 }, 'thread.' + r.full_name);
        items = (th && th.items) || [];
      } catch (e) { /* 拉不到记录也要能看他的话 */ }
      /* R-32：原来这里还有一段 `const live = ((this.live || {})[r.full_name] || [])` 的「live 追加」分支 ——
       * this.live 是**布尔开关**（141/166/187/250/275 都按开关用），所以那段永远走不到（死代码）。
       * 按作者口径删掉（R-37 挂在那段里的 tapWho 也随之一并没了，已在报告里写明）。 */
      if (!items.length && !this.showHidden) { box.textContent = '（还没聊过）'; this.pinBottom(box, { force: true }); return; }
      /* R-53：开了「显示已删除」就把被隐藏的那几条找回来（灰显），按时间插回去 */
      if (this.showHidden) {
        try {
          const hid = await this.hiddenItems(r.full_name);
          hid.forEach((m) => {
            if (items.some((x) => x.id === m.id)) return;
            const mine2 = (m.from === 'me' || m.from === 'owner.me');
            items.push({ id: m.id, who: mine2 ? 'me' : 'him', body: m.body, at: m.at,
                         send_state: m.send_state, send_note: m.send_note, hidden: true });
          });
          items.sort((a, b) => ((a.at || 0) - (b.at || 0)) || ((a.id || 0) - (b.id || 0)));
        } catch (e) { /* 找不回来也不能挡住正常气泡 */ }
      }
      items.forEach((m) => {
        const me = m.who === 'me';
        const head = me ? ('我 → ' + (r.title || r.full_name)) : ((r.title || r.full_name) + ' → 我');
        const bu = bubbleEl({ mine: me, head: head, text: m.body, time: hhmm(m.at) });
        bu.className = 'tk-bub ' + (me ? 'me' : 'him') + (m.hidden ? ' tk-bub-hidden' : '');
        bu.setAttribute('data-msg', String(m.id || ''));
        this.longPress(bu, () => this.msgMenu(m, r.full_name));          /* R-53：长按出两档菜单（先挂，好把长按后的 click 吃掉） */
        if (!me) this.tapWho(bu, r.full_name);   /* R-37 B：他说的气泡点了也开信息窗（我说的不挂） */
        if (me) this.paintStateIcon(bu, m, r.full_name);                 /* R-52：状态并进气泡那一行 */
        if (m.hidden) { const tag = document.createElement('span'); tag.className = 'tk-delmark'; tag.setAttribute('data-testid', 'talk-hidden-mark'); tag.textContent = '␡'; bu.appendChild(tag); }
        box.appendChild(bu);
      });
      if (wasNear) this.pinBottom(box, { force: true });
      else { box.scrollTop = prevTop; box._pinned = false; box._lastHeight = box.scrollHeight; this.paintBackChip(box); }
      /* R-32：这里原来还有一句 this.pullRoleOutput(r)（每次重画都抛）。按作者口径删掉。 */
    },

    /* ---- 发送状态（R-31）：每条消息给状态，不再只闪一行 toast -------------------
     * 三态：发送中 → 已送达 ◯◯ms / 没送达：原因。
     * 桥不回执：3s 转「还在发…」（带重试），8s 转「没送达：超时」；回执后到也照样覆盖终态。
     * 耗时优先用**回执里的 ms**（就是平台 delivery 台账那个数）；回执没给才退回界面往返毫秒，那种情况前面加 ≈。
     * 省电/省流量：设置 sendTiming 关掉后只留终态 —— 不显示毫秒、也不做每秒刷新。
     */
    timing() {
      try { return HP.App.bool('sendTiming', true); } catch (e) { return true; }
    },
    secs(t0) { return ((performance.now() - (t0 || 0)) / 1000).toFixed(1); },
    sendWho(s) {
      const name = s.target === '全体' ? '全体' : ((this.roles.find((x) => x.full_name === s.target) || {}).title || s.target);
      return '我 → ' + name;
    },
    sendStateText(s) {
      const who = this.sendWho(s) + (s.kind === 'broadcast' ? '（广播）' : '');
      if (s.state === 'sending') return who + ' · 发送中…' + (this.timing() ? ' ' + this.secs(s.t0) + 's' : '');
      if (s.state === 'waiting') return who + ' · 还在发…' + (this.timing() ? ' ' + this.secs(s.t0) + 's' : '');
      if (s.state === 'unconfirmed') return who + ' · 已发出（未确认）';   /* R-36 A：中性态，不写毫秒 */
      if (s.state === 'sent' || s.state === 'partial') {
        const head = s.parts && s.parts.length
          ? (s.parts.filter((p) => p.ok).length + '/' + s.parts.length + ' 已送达')
          : '已送达';
        const ms = (this.timing() && s.ms != null) ? (' ' + (s.msApprox ? '≈' : '') + Math.round(s.ms) + 'ms') : '';
        return who + ' · ' + head + ms;
      }
      return who + ' · 没送达：' + (s.note || '原因不明');
    },
    fillSends(box) {
      if (!box) return;
      box.textContent = '';
      this.sends.filter((s) => s.state !== 'sent').slice(-4).forEach((s) => {
        const row = document.createElement('div');
        const cls = (s.state === 'sent') ? 'ok'
          : ((s.state === 'sending' || s.state === 'waiting' || s.state === 'unconfirmed') ? 'wait' : 'bad');   /* unconfirmed＝中性态，别归进 ok 绿 */
        row.className = 'tk-sendrow ' + cls;
        row.setAttribute('data-testid', 'talk-sendrow');
        row.setAttribute('data-state', s.state);
        const line = document.createElement('div');
        line.className = 'tk-sendtext';
        line.textContent = this.sendStateText(s);
        row.appendChild(line);
        (s.parts || []).forEach((p) => {
          const d = document.createElement('div');
          d.className = 'tk-sendsub';
          d.textContent = '· ' + p.role + (p.ok ? ' ✓' : ' ✗') +
            ((this.timing() && p.ok && p.ms != null) ? ' ' + Math.round(p.ms) + 'ms' : '') +
            (p.ok ? '' : ' ' + (p.note || '没投成'));
          row.appendChild(d);
        });
        if (s.state === 'waiting' || s.state === 'timeout' || s.state === 'failed' || s.state === 'partial') {
          const rt = document.createElement('button');
          rt.className = 'tk-chip';
          rt.setAttribute('data-testid', 'talk-retry');
          rt.textContent = '重试';
          rt.addEventListener('click', () => { this.send(s.target, s.kind, s.body, { force: true }); });
          row.appendChild(rt);
        }
        box.appendChild(row);
      });
    },
    /* R-52：成功态**不再**另起这一行 —— 只有还有没落定的（发送中/还在发/超时/没送达）才画；
     * 全成功时把节点从 DOM 里摘掉（判据：成功态 `#tk-sends` 节点数 = 0）。 */
    paintSends(el) {
      const old = document.getElementById('tk-sends');
      const live = this.sends.filter((s) => s.state !== 'sent');
      if (!live.length) { if (old) old.remove(); return; }
      if (!el) return;
      if (old) { this.fillSends(old); return; }
      const box = document.createElement('div');
      box.className = 'tk-sends';
      box.id = 'tk-sends';
      el.appendChild(box);
      this.fillSends(box);
    },
    repaintSends() {
      const box = document.getElementById('tk-sends');
      if (box) this.fillSends(box);
      else this.paintSends(document.getElementById('tk-chat'));
    },
    /* R-37：点一下就开信息窗（单聊抬头 + 他说的气泡）——
     * **只挂 click**；touchstart 记一下手指位置，click 时若位移 >8px 就当滚动、不开窗。
     * 不注册 touchmove、不 preventDefault、不碰滚动（滚动交给浏览器与既有的钉底逻辑）。 */
    tapWho(el, full) {
      if (!el || !full) return el;
      el.setAttribute('data-from', full);
      el.setAttribute('data-tapwho', '1');
      let x0 = null, y0 = null;
      el.addEventListener('touchstart', (e) => {
        const t = (e.touches && e.touches[0]) || null;
        if (t) { x0 = t.clientX; y0 = t.clientY; }
      }, { passive: true });
      el.addEventListener('click', (e) => {
        /* 真机上一次点击是 MouseEvent（没有 changedTouches），坐标取 clientX/Y；
         * 若浏览器给了 changedTouches 就优先用它。位移 >8px 就当滚动。 */
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        const cx = (t && t.clientX != null) ? t.clientX : e.clientX;
        const cy = (t && t.clientY != null) ? t.clientY : e.clientY;
        if (x0 != null && cx != null && (Math.abs(cx - x0) > 8 || Math.abs(cy - y0) > 8)) return;
        e.stopPropagation();
        this.openRoleSheet(full);
      });
      return el;
    },

    /* ---- R-52 / R-53：气泡三态 + 长按两档菜单（拼进气泡那一行，不另起状态行、不占常驻键）------
     * 口径出处：作者配方 `roles-chat/evidence/R52R53-平台侧-20260929/03-给renderer-配方.md`
     *  · 三态：pending＝小圈、sent＝对号、failed＝红叹号（可点重发）；成功态**不再**出 `#tk-sends` 那行；
     *  · 状态源只用平台字段 `send_state` / `send_note`（`talk.thread` / `talk.since` 都已带回），界面不造状态；
     *  · 「删除」＝ `talk.hidden {action:'hide'}`（只把自己这份藏起来，`talk/*.md` 台账与库行都不动）；
     *    「显示已删除」＝ 拿 `talk.since --show-hidden` 找回那几条（灰显）。
     */
    stateOf(m) {
      if (!m) return null;
      const st = m.send_state;
      return (st === 'pending' || st === 'sent' || st === 'failed') ? st : null;
    },
    /* 把状态图标**就地拼进气泡**（绝对定位在气泡右下角）：不占行高；尺寸 ≤14px（R-33 的 44dp 是触控区，图标本身要小） */
    paintStateIcon(bu, m, role) {
      if (!bu || !m || !m.id) return bu;
      if (this._retryPending && this._retryPending[m.id]) { /* 刚点过重发：先按 pending 画 */ }
      const st = (this._retryPending && this._retryPending[m.id]) ? 'pending' : this.stateOf(m);
      const old = bu.querySelector('.tk-ic');
      if (old) old.remove();
      if (!st) return bu;
      const cls = (st === 'pending') ? 'sending' : (st === 'failed' ? 'fail' : 'sent');
      const ic = document.createElement('span');
      ic.className = 'tk-ic tk-ic-' + cls;
      ic.setAttribute('data-testid', 'talk-ic-' + st);
      ic.setAttribute('data-msg', String(m.id));
      ic.setAttribute('data-role', role || '');
      ic.setAttribute('data-body', String(m.body || ''));    /* 重发要用：气泡正文 */
      ic.textContent = (st === 'sent') ? '✓' : (st === 'failed' ? '!' : '');
      if (st === 'failed') {
        const note = (m.send_note && (m.send_note.reason || m.send_note.result)) || '没送达';
        ic.setAttribute('data-note', String(note));
        ic.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.retryMsg(ic); });
      }
      const rowT = bu.querySelector('.tk-time');
      if (rowT) rowT.appendChild(ic); else bu.appendChild(ic);   /* 并进气泡那一行（时间行尾），不新增行 */
      return bu;
    },
    /* 点红叹号 = 把这一条重投一次：不新建气泡、不重画列表；同一条 1.2s 内只投一次（防连点） */
    async retryMsg(ic) {
      const id = ic && ic.getAttribute ? ic.getAttribute('data-msg') : null;
      const role = ic && ic.getAttribute ? ic.getAttribute('data-role') : '';
      const body = ic && ic.getAttribute ? ic.getAttribute('data-body') : null;
      if (!id || !body) return;
      const now = performance.now();
      this._retryAt = this._retryAt || {};
      if (this._retryAt[id] && now - this._retryAt[id] < 1200) return;    /* 防连点：连点 3 次只投 1 次 */
      this._retryAt[id] = now;
      this._retryPending = this._retryPending || {};
      this._retryPending[id] = true;
      ic.className = 'tk-ic tk-ic-sending';
      ic.setAttribute('data-testid', 'talk-ic-pending');
      ic.textContent = '';
      try {
        await rpc('talk.say', { role: role, body: body, kind: 'private', by: this.asWho || 'me' });
      } catch (e) {
        HP.App.toast('重发没成：' + ((e && e.message) || e), 4000);
      }
    },
    /* 长按（500ms 不动）⇒ 两档小菜单；长按之后那一下 click 用 stopImmediatePropagation 吃掉，
     * 免得又去开信息窗（R-37 的 tapWho 挂在同一元素上，所以本函数必须**先**挂）。 */
    longPress(el, fn) {
      if (!el) return el;
      let t = null, x0 = 0, y0 = 0, fired = false;
      const clear = () => { if (t) { clearTimeout(t); t = null; } };
      const arm = () => { clear(); fired = false; t = setTimeout(() => { t = null; fired = true; fn(); }, 500); };
      el.addEventListener('touchstart', (e) => {
        const p = (e.touches && e.touches[0]) || null;
        if (p) { x0 = p.clientX; y0 = p.clientY; }
        arm();
      }, { passive: true });
      el.addEventListener('touchmove', (e) => {
        const p = (e.touches && e.touches[0]) || null;
        if (p && (Math.abs(p.clientX - x0) > 8 || Math.abs(p.clientY - y0) > 8)) clear();
      }, { passive: true });
      el.addEventListener('touchend', clear);
      el.addEventListener('touchcancel', clear);
      el.addEventListener('mousedown', arm);            /* 本机台/桌面浏览器：按住不动也算 */
      el.addEventListener('mouseup', clear);
      el.addEventListener('mouseleave', clear);
      el.addEventListener('click', (e) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } });
      return el;
    },
    /* 两档菜单：删除 / 显示已删除（临时浮层，不进常驻按键；不写说明文字） */
    msgMenu(m, role) {
      const old = document.getElementById('tk-msgmenu');
      if (old) old.remove();
      if (!m || !m.id) return null;
      const box = document.createElement('div');
      box.id = 'tk-msgmenu';
      box.className = 'tk-msgmenu';
      const mk = (label, tid, fn) => {
        const b = document.createElement('button');
        b.className = 'tk-msgitem';
        b.setAttribute('data-testid', tid);
        b.textContent = label;
        b.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); fn(); });
        box.appendChild(b);
        return b;
      };
      mk('删除', 'talk-msgmenu-del', () => this.hideMsg(m, role));
      mk(this.showHidden ? '不显示已删除' : '显示已删除', 'talk-msgmenu-show', () => this.toggleHidden());
      document.body.appendChild(box);
      setTimeout(() => {
        const off = (ev) => { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener('pointerdown', off); } };
        document.addEventListener('pointerdown', off);
      }, 0);
      return box;
    },
    /* 「删除」＝ 从我这儿删掉：平台标 hidden_by_user=1；界面把这条从列表去掉（库行与台账都不动） */
    async hideMsg(m, role) {
      try {
        const r = await rpc('talk.hidden', { id: m.id, action: 'hide' });
        if (!r || (r.changed === 0 && r.hidden_by_user !== 1)) { HP.App.toast('没删掉', 3000); return; }
      } catch (e) { HP.App.toast('删不掉：' + ((e && e.message) || e), 4000); return; }
      this._hidSeen = this._hidSeen || {};
      this._hidSeen[m.id] = { id: m.id, who: m.who, body: m.body, at: m.at, send_state: m.send_state, send_note: m.send_note, hidden: true };
      const ic = document.querySelector('.tk-ic[data-msg="' + m.id + '"]');
      const bu = ic ? ic.closest('.tk-bub') : document.querySelector('.tk-bub[data-msg="' + m.id + '"]');
      if (bu && bu.parentNode) bu.remove();              /* 列表少 1（只在界面上） */
    },
    /* 「显示已删除」：拿 `talk.since --show-hidden` 在近 200 条窗口里把被隐藏的找回来（服务端真值，重启也在） */
    async hiddenItems(role) {
      try {
        const from = Math.max(0, (this.last || 0) - 200);
        const r = await rpc('talk.since', { id: from, show_hidden: true });
        const MINE = ['me', 'owner.me'];
        return ((r && r.messages) || []).filter((x) => x.hidden_by_user &&
          ((MINE.indexOf(x.from) >= 0 && x.to === role) || x.from === role));
      } catch (e) { return []; }
    },
    async toggleHidden() {
      this.showHidden = !this.showHidden;
      try { await HP.App.setPref('showHidden', this.showHidden ? 'true' : 'false', { apply: false }); } catch (e) { /* 存不上也先按内存走 */ }
      this.render();
    },
    stopSendTicker() { if (this._sendTick) { clearInterval(this._sendTick); this._sendTick = null; } },
    startSendTicker() {
      if (this._sendTick || this._powerSave) return;    /* 省电期间不刷发送状态（R-25） */
      this._sendTick = setInterval(() => {
        const busy = this.sends.some((s) => s.state === 'sending' || s.state === 'waiting');
        if (!busy) { clearInterval(this._sendTick); this._sendTick = null; return; }
        if (this.timing()) this.repaintSends();
      }, 500);
    },

    /* 输入：只让他敲"要说的话"，别的都不用选 */
    ask(target, kind) {
      const who = target === '全体' ? '全体' : (this.roles.find((x) => x.full_name === target) || {}).title || target;
      const text = window.prompt(kind === 'broadcast' ? '对全体喊话：' : ('对 ' + who + ' 说：'), '');
      if (text == null || !text.trim()) return;
      this.send(target, kind, text.trim());
    },
    async send(target, kind, body, opts) {
      const o = opts || {};
      /* 防连点：只在「上一条还没落定」（发送中/还在发）时挡；已经出终态的（含 8s 超时）不该继续挡 ——
       * 否则一次卡住会把后面 20s 的发送全吞掉。*/
      const pending = this.sends.some((x) => x.state === 'sending' || x.state === 'waiting');
      if (pending && !o.force) return;
      this.busy = true;
      const s = {
        n: ++this.sendSeq, target: target, kind: kind || 'private', body: body,
        t0: performance.now(), state: 'sending', ms: null, msApprox: false, note: '', parts: null
      };
      this.sends.push(s);
      if (this.sends.length > 4) this.sends.shift();
      this.repaintSends();
      this.startSendTicker();
      const t3 = setTimeout(() => { s.state = 'waiting'; this.repaintSends(); }, 3000);
      const t8 = setTimeout(() => { s.state = 'timeout'; s.note = '超时（8 秒没回执）'; this.repaintSends(); }, 8000);
      try {
        const r = (kind === 'broadcast')
          ? await rpc('talk.shout', { body: body, by: this.asWho || 'me' })
          : await rpc('talk.say', { role: target, body: body, kind: kind || 'private', by: this.asWho || 'me' });
        clearTimeout(t3); clearTimeout(t8);
        const raw = (r && r.raw) || {};
        const results = (raw && raw.results) || (r && r.results);
        const bridged = (r && r.delivered !== undefined) ? r.delivered
          : (raw.delivered !== undefined ? raw.delivered : null);
        if (results && results.length) {
          /* 广播：逐个角色各自的结果（判据⑥） */
          s.parts = results.map((x) => ({
            role: x.role, ok: !!x.delivered, ms: (x.ms != null ? x.ms : null), note: x.error || x.note || ''
          }));
          const okN = s.parts.filter((p) => p.ok).length;
          const msList = s.parts.filter((p) => p.ms != null).map((p) => p.ms);
          s.ms = msList.length ? Math.max.apply(null, msList) : null;
          s.msApprox = false;
          s.state = (okN === s.parts.length) ? 'sent' : (okN ? 'partial' : 'failed');
          if (okN !== s.parts.length) {
            s.note = s.parts.filter((p) => !p.ok).map((p) => p.role + '：' + (p.note || '没投成')).join('；');
          }
        } else {
          const ms = (r && r.ms != null) ? r.ms : (raw.ms != null ? raw.ms : null);
          if (bridged === null) {
            /* R-36 A：回执里**没有 delivered 字段** —— 不算成功、也不说失败，走中性态「已发出（未确认）」；
             * 不写毫秒（ms=null），也不给重试（消息可能已经发出去了，重发会重复）。 */
            s.state = 'unconfirmed';
            s.ms = null;
            s.msApprox = false;
            s.note = raw.error || (r && r.error) || '';
          } else {
            const ok = !!bridged;
            s.ms = (ms != null) ? ms : Math.round(performance.now() - s.t0);
            s.msApprox = (ms == null);                     /* 回执没给耗时：退回界面往返毫秒，前面加 ≈ */
            s.state = ok ? 'sent' : 'failed';
            if (!ok) s.note = raw.error || (r && r.error) || '桥说这条没投成';
          }
        }
      } catch (e) {
        clearTimeout(t3); clearTimeout(t8);
        s.state = 'failed';
        s.note = String((e && e.message) || e);
      } finally {
        this.busy = false;
        this.repaintSends();
      }
      try { await this.tick(); } catch (e) { /* 拉不到新消息不影响刚才那条的状态 */ }
      this.render();
    },
    async newSolo() {
      try {
        const r = await rpc('talk.solo');
        HP.App.toast('新对话：' + ((r && r.tmux) || ''));
        this.render();
      } catch (e) { HP.App.toast('开不了新对话：' + e.message, 5000); }
    },
    /* 点会话 = 弹一个选择窗（不直接切） */
    openSessionSheet(s) {
      const el = document.getElementById('tk-page');
      el.textContent = '';
      const head = document.createElement('div');
      head.className = 'tk-title';
      head.textContent = (s.id ? '#' + s.id + ' ' : '') + s.name + (s.role ? '（角色会话）' : '（普通会话）');
      el.appendChild(head);
      const mk = (label, tid, fn, danger) => {
        const b2 = document.createElement('button');
        b2.className = 'tk-act' + (danger ? ' danger' : '');
        b2.id = tid;
        b2.setAttribute('data-testid', tid);
        b2.textContent = label;
        b2.style.display = 'block';
        b2.style.width = '100%';
        b2.style.margin = '6px 0';
        b2.addEventListener('click', fn);
        el.appendChild(b2);
        return b2;
      };
      mk('切过去（就在当前 tmux 里）', 'tk-sess-switch', async () => {
        try {
          if (s.role) {
            const r = await rpc('talk.switch', { role: s.role });
            if (r && r.cmd) { HP.App.send(r.cmd + '\r'); HP.App.toast('已切：' + r.cmd, 3500); }
            else { HP.App.toast('切不过去：' + ((r && r.why) || '未知原因'), 4000); }
          } else {
            swLoad();
            const line = swBuild(s.name);
            HP.App.send(line + '\r');
            HP.App.toast('已切：' + line, 3500);
          }
        } catch (e) { HP.App.toast('切失败：' + e.message, 4000); }
        this.view = 'channel'; this.render();
      });
      if (s.role) mk('跟他说话（聊天界面）', 'tk-sess-talk', () => { this.openRole(s.role); });
      mk('删除这个会话', 'tk-sess-del', async () => {
        if (!confirm('删掉「' + s.name + '」这个会话？' + (s.role ? '（只是结束这次会话，角色还在，可以再拉起）' : ''))) return;
        try {
          const r = await rpc('talk.sessionDel', { name: s.role || s.name });
          HP.App.toast(r && r.deleted ? ('已删除：' + (r.role || r.name)) : ('没删掉：' + ((r && r.why) || '未知原因')), 4000);
          this.view = 'channel'; this.render();
        } catch (e) { HP.App.toast('删失败：' + e.message, 5000); }
      }, true);
      mk('切换指令设置…', 'tk-swcfg', () => {
        swLoad();
        const c = document.createElement('input');
        c.id = 'tk-swcmd';
        c.setAttribute('data-testid', 'talk-swcmd');
        c.value = SW_CFG.cmd;
        c.style.cssText = 'width:100%;margin:4px 0';
        el.appendChild(c);
        const modes = document.createElement('div');
        modes.className = 'tk-row';
        [['name', '会话名'], ['session', 'session'], ['role', '角色名'], ['none', '不用正则']].forEach(([m, label]) => {
          const b3 = document.createElement('button');
          b3.className = 'tk-chip' + (SW_CFG.mode === m ? ' on' : '');
          b3.id = 'tk-swmode-' + m;
          b3.setAttribute('data-testid', 'talk-swmode-' + m);
          b3.textContent = label;
          b3.addEventListener('click', () => { SW_CFG.mode = m; swSave(); HP.App.toast('匹配方式：' + label, 2000); });
          modes.appendChild(b3);
        });
        el.appendChild(modes);
        const sv = document.createElement('button');
        sv.className = 'tk-act';
        sv.id = 'tk-swsave';
        sv.setAttribute('data-testid', 'talk-swsave');
        sv.textContent = '存下这个指令';
        sv.addEventListener('click', () => { SW_CFG.cmd = c.value; swSave(); HP.App.toast('已存：' + swBuild('{会话名}'), 3000); });
        el.appendChild(sv);
      });
      mk('取消', 'tk-sess-cancel', () => { this.view = 'channel'; this.render(); });
    },

    async openSession(s) {
      if (s.role) {
        try {
          const r = await rpc('talk.switch', { role: s.role });
          if (r && r.cmd) { HP.App.send(r.cmd + '\r'); HP.App.toast('已切：' + r.cmd, 3000); }
        } catch (e) { /* 切不过去也照样能看记录 */ }
        return this.openRole(s.role);
      }
      HP.App.toast('这是单独对话（' + s.name + '）：它不在角色体系里', 5000);
    },
    when(ts) {
      try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ''; }
    }
  };

  HP.Talk = Talk;
})();
