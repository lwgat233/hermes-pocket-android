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

  /* monospace 的会话名：跟服务端 tmux_session() 一致 */
  const sess = (full) => 'role-' + String(full || '').replace(/\./g, '-');

  const Talk = {
    roles: [], msgs: [], last: 0, view: 'channel', sel: null, busy: false, timer: null,
    withPrivate: true, live: true,
    chOpen: false,                 /* 「频道」折叠状态 */
    cache: {},                     /* role -> 上次读到的会话输出（切回来秒显，充当"多窗口"） */
    asks: [],
    sends: [],                     /* R-31：最近几条发送的状态（发送中 / 已送达◯◯ms / 没送达:原因） */
    sendSeq: 0,

    onShow(tab) { this.tab = tab || 'talk'; this.verifySync().catch(() => { }); this.render(); this.startPoll(); },
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
        if (this.view === 'role' && this.style === 'chat' && this.sel) this.pullRoleOutput(this.sel);
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
        if (!this.last) { const r = await rpc('talk.since', { id: 0 }); this.last = (r && r.last) || 0; this.msgs = (r && r.messages) || []; }
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
      gin.addEventListener('keydown', (e) => { if (e.key === 'Enter') gfire(); });
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
      sub.textContent = r.full_name + ' · ' + sess(r.full_name) + (r.online ? '' : (r.state === 'paused' ? ' · 被停' : ' · 不在线'));
      b.appendChild(row1);
      b.appendChild(sub);
      const tags = document.createElement('div');
      tags.className = 'tags';
      (r.channels || []).forEach((c) => {
        const t = document.createElement('span');
        t.className = 'tk-tag';
        t.textContent = c;
        tags.appendChild(t);
      });
      if (tags.childNodes.length) b.appendChild(tags);
      b.addEventListener('click', () => this.openRoleSheet(r.full_name));
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
      ok.addEventListener('click', async () => {
        const text = (inp.value || '').trim();
        if (!text) { HP.App.toast('先说点什么'); return; }
        try {
          await rpc('talk.answer', { id: String(k.id), text: text });
          HP.App.toast('答复已回给 ' + k.from);
          this.render();
        } catch (e) { HP.App.toast('答复失败：' + e.message); }
      });
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
      let sess = [], roles = [];
      try { sess = (((await rpcCache('talk.sessions', {}, 'sessions')) || {}).sessions) || []; } catch (e) { /* 离线也能看 */ }
      try { roles = (((await rpcCache('talk.roles', {}, 'roles')) || {}).roles) || []; } catch (e) { /* 同上 */ }
      const CONTAINER = 'roles';   /* 装角色窗口的容器会话：不是给人切的目标 */
      const sessOfRole = {};
      sess = (sess || []).filter((s) => s && s.name !== CONTAINER);
      sess.forEach((s) => { if (s.role) sessOfRole[s.role] = s; });
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
          b.textContent = row.name + (row.sub ? '　· ' + row.sub : '');
          b.addEventListener('click', () => this.openSessionSheet({ name: row.name, role: row.role }));
          el.appendChild(b);
        });
      };

      /* ① 在线：会话真在跑 */
      const online = roles.filter((r) => r.online).map((r) => ({
        name: (r.title || r.name), role: r.full_name,
        sub: '在跑' + (r.pending ? ' · 欠 ' + r.pending : ''),
      }));
      /* ② 没在线：角色在，会话没起 */
      const offline = roles.filter((r) => !r.online).map((r) => ({
        name: (r.title || r.name), role: r.full_name,
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
        if (s.role && known[s.role]) return;
        if (s.role) return;
        histRows.push({ name: s.name, role: null, sub: '普通会话' });
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
      [['全名', r.full_name], ['会话', sess(r.full_name)],
       ['状态', r.state === 'paused' ? '被停' : (r.online ? '在线' : '不在线')],
       ['欠回复', String(r.pending || 0)], ['标签', r.tags || '（无）'],
       ['能接入', (r.channels || []).join('、') || '（无）']].forEach((kv) => {
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
        setTimeout(() => this.pullRoleOutput(r), 2500);
        setTimeout(() => this.pullRoleOutput(r), 6000);
      };
      ok.addEventListener('click', fire);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fire(); });
      line.appendChild(inp);
      line.appendChild(ok);
      el.appendChild(line);
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
      const live = ((this.live || {})[r.full_name] || []);
      if (!items.length && !live.length) { box.textContent = '（还没聊过）'; this.pinBottom(box, { force: true }); return; }
      items.forEach((m) => {
        const me = m.who === 'me';
        const head = me ? ('我 → ' + (r.title || r.full_name)) : ((r.title || r.full_name) + ' → 我');
        const bu = bubbleEl({ mine: me, head: head, text: m.body, time: hhmm(m.at) });
        bu.className = 'tk-bub ' + (me ? 'me' : 'him');
        box.appendChild(bu);
      });
      live.forEach((tx) => {
        const bu = bubbleEl({ mine: false, head: (r.title || r.full_name) + ' → 我', text: tx, time: '' });
        bu.className = 'tk-bub him';
        box.appendChild(bu);
      });
      if (wasNear) this.pinBottom(box, { force: true });
      else { box.scrollTop = prevTop; box._pinned = false; box._lastHeight = box.scrollHeight; this.paintBackChip(box); }
      this.pullRoleOutput(r);
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
      this.sends.slice(-4).forEach((s) => {
        const row = document.createElement('div');
        const cls = (s.state === 'sent') ? 'ok' : ((s.state === 'sending' || s.state === 'waiting') ? 'wait' : 'bad');
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
    paintSends(el) {
      if (!el || !this.sends.length) return;
      const box = document.createElement('div');
      box.className = 'tk-sends';
      box.id = 'tk-sends';
      el.appendChild(box);
      this.fillSends(box);
    },
    repaintSends() {
      const box = document.getElementById('tk-sends');
      if (box) this.fillSends(box);
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
          const ok = (bridged === null) ? true : !!bridged;
          const ms = (r && r.ms != null) ? r.ms : (raw.ms != null ? raw.ms : null);
          s.ms = (ms != null) ? ms : Math.round(performance.now() - s.t0);
          s.msApprox = (ms == null);                       /* 回执没给耗时：退回界面往返毫秒，前面加 ≈ */
          s.state = ok ? 'sent' : 'failed';
          if (!ok) s.note = raw.error || (r && r.error) || '桥说这条没投成';
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
      head.textContent = s.name + (s.role ? '（角色会话）' : '（普通会话）');
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
