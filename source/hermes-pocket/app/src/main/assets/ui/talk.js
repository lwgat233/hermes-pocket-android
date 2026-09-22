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
  const CACHE = {
    get(k, d) { try { const v = localStorage.getItem('HP_TALK_CACHE.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('HP_TALK_CACHE.' + k, JSON.stringify(v)); } catch (e) { } }
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

    onShow(tab) { this.tab = tab || 'talk'; this.verifySync().catch(() => { }); this.render(); this.startPoll(); },
    onHide() { this.stopPoll(); },
    startPoll() {
      this.stopPoll();
      if (!this.live) return;
      this.timer = setInterval(() => {
        this.tick().catch(() => { });
        if (this.view === 'role' && this.style === 'chat' && this.sel) this.pullRoleOutput(this.sel);
      }, 2500);
    },
    stopPoll() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

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
      if (group) { this.paintGroup(el); return; }
      try {
        await this.refreshRoles();
        await this.refreshAsks();
        if (!this.last) { const r = await rpc('talk.since', { id: 0 }); this.last = (r && r.last) || 0; this.msgs = (r && r.messages) || []; }
      } catch (e) { HP.App.toast('连不上频道：' + e.message); }
      try { (this.view === 'role' && this.sel) ? this.paintRole(el) : this.paintChannel(el); }
      catch (e) { el.textContent = '频道画不出来：' + e.message; }
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

    paintStream() {
      const s = document.getElementById('tk-stream');
      if (!s) return;
      s.textContent = '';
      const rows = this.msgs.filter((m) => this.withPrivate || m.kind !== 'private').slice(-80);
      if (!rows.length) { s.textContent = '（还没有消息）'; return; }
      rows.forEach((m) => {
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
        s.appendChild(d);
      });
    },

    async paintHistory(el) {
      try {
        const r = await rpcCache('talk.sessions', {}, 'sessions');
        const list = (r && r.sessions) || [];
        el.textContent = list.length ? '' : '（还没有）';
        list.slice(0, 6).forEach((s) => {
          const b = document.createElement('button');
          b.className = 'tk-hist-row';
          b.textContent = (s.kind === 'solo' ? '👤 ' : '· ') + (s.role || s.name) + '　' + this.when(s.last_used) + (s.alive ? '' : '（已关）');
          b.addEventListener('click', () => this.openSession(s));
          el.appendChild(b);
        });
      } catch (e) { el.textContent = '（读不到历史）'; }
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

    async paintRole(el) {
      const r = this.sel || {};
      this.style = this.style || 'chat';

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
        box.style.maxHeight = '54vh';
        box.style.overflowY = 'auto';
        el.appendChild(box);
        this.paintChat(r);
      } else {
        const out = document.createElement('pre');
        out.className = 'tk-term';
        out.id = 'tk-term';
        out.textContent = this.cache[r.full_name] || '（正在读他的会话…）';
        el.appendChild(out);
        rpc('talk.capture', { role: r.full_name, lines: 200 }).then((c) => {
          const raw = (c && c.raw) || '（没内容）';
          this.cache[r.full_name] = raw;
          const box = document.getElementById('tk-term');
          if (box && this.sel && this.sel.full_name === r.full_name) box.textContent = raw;
        }).catch((e) => { if (!this.cache[r.full_name]) out.textContent = '读不到：' + e.message; });
      }

      /* 输入行：聊天和终端两种形式都在，敲一句按发送 */
      const line = document.createElement('div');
      line.className = 'tk-askline';
      /* 上半行：这条谁能看见（只给他 / 他人可见）+ 以什么身份说（本人 / 经理）—— 标签写清，不做第二个选择器 */
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

      /* 下半行：输入框 + 发送（贴底固定，发送键一定看得见） */
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
      inp.placeholder = this.style === 'chat' ? '说点什么…' : '说点什么（会送进他的会话）…';
      inp.style.flex = '1 1 auto';
      inp.style.minWidth = '0';
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
        await this.send(r.full_name, this.kind || 'private', text);
        setTimeout(() => this.pullRoleOutput(r), 2500);
        setTimeout(() => this.pullRoleOutput(r), 6000);
      };
      ok.addEventListener('click', fire);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fire(); });
      line.appendChild(inp);
      line.appendChild(ok);
      el.appendChild(line);
    },

    /* Hermes 的界面是整屏重画的，"行数变多"取不到新行 —— 直接抠他最近一次回答的框
     * 形如：╭─ ☤ Hermes ─╮  正文…  ╰───╯   （正文就是他的话） */
    lastAnswer(scr) {
      const lines = String(scr || '').split('\n');
      let start = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].indexOf('☤') >= 0 && lines[i].indexOf('╭') >= 0) { start = i; break; }
      }
      if (start < 0) return '';
      const out = [];
      for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (l.indexOf('╰') >= 0) break;
        if (/^[─═]{5,}/.test(l)) break;
        if (l.indexOf('☤') >= 0 && /deepseek|gpt|claude|Hermes/.test(l)) break;
        out.push(l.replace(/^[│|]\s?/, '').replace(/\s*[│|]\s*$/, ''));
      }
      return out.join('\n').trim();
    },

    /* 他只会在自己的会话里说话 —— 这里把"新出现的行"挑出来当他的话（气泡） */
    newLines(base, now) {
      const b = String(base || '').split('\n');
      const n = String(now || '').split('\n');
      if (n.length <= b.length) return [];
      const fresh = n.slice(b.length);
      const junk = /^[\s]*[─═━│┃╭╮╰╯+\-=|><*·.]+[\s]*$/;
      const mine = (t) => String(t || '').replace(/\s/g, '').length === 0;
      return fresh
        .map((l) => String(l).replace(/\s+$/, ''))
        .filter((l) => l && !junk.test(l) && !mine(l))
        .slice(-8);
    },

    /* 拉一次他的会话：把新增的行记成他的话 */
    async pullRoleOutput(r) {
      try {
        const c = await rpc('talk.capture', { role: r.full_name, lines: 120 });
        const raw = (c && c.raw) || '';
        const ans = this.lastAnswer(raw);
        if (!ans) { this.capBase[r.full_name] = raw; return; }
        const seen = this.said = this.said || {};
        const prev = (seen[r.full_name] || []).slice(-3);
        if (prev.indexOf(ans) >= 0) { this.capBase[r.full_name] = raw; return; }   /* 同一句不重复显示 */
        (seen[r.full_name] = seen[r.full_name] || []).push(ans);
        seen[r.full_name] = seen[r.full_name].slice(-20);
        this.live = this.live || {};
        this.live[r.full_name] = (this.live[r.full_name] || []).concat(ans.split('\n')).slice(-40);
        this.capBase[r.full_name] = raw;
        if (this.view === 'role' && this.style === 'chat' && this.sel && this.sel.full_name === r.full_name) this.paintChat(r);
        return;
      } catch (e) { return; }
      /* 旧的行差法留着当兜底（非 Hermes 的会话用得上） */
      try {
        const c = await rpc('talk.capture', { role: r.full_name, lines: 120 });
        const raw = (c && c.raw) || '';
        const base = this.capBase[r.full_name];
        if (base == null) { this.capBase[r.full_name] = raw; return; }
        const fresh = this.newLines(base, raw);
        this.capBase[r.full_name] = raw;
        if (fresh.length) {
          this.live = this.live || {};
          this.live[r.full_name] = (this.live[r.full_name] || []).concat(fresh).slice(-40);
          if (this.view === 'role' && this.style === 'chat' && this.sel && this.sel.full_name === r.full_name) this.paintChat(r);
        }
      } catch (e) { /* 读不到就先不显示，不打扰 */ }
    },

    async paintChat(r) {
      const box = document.getElementById('tk-chat');
      if (!box) return;
      box.textContent = '';
      let items = [];
      try {
        const th = await rpcCache('talk.thread', { role: r.full_name, limit: 100 }, 'thread.' + r.full_name);
        items = (th && th.items) || [];
      } catch (e) { /* 拉不到对话记录不影响看他的话，别把气泡一起吞了 */ }
      const live = ((this.live || {})[r.full_name] || []);
      if (!items.length && !live.length) { box.textContent = '（还没聊过）'; return; }
      items.forEach((m) => {
        const me = m.who === 'me';
        const head = me ? ('我 → ' + (r.title || r.full_name)) : ((r.title || r.full_name) + ' → 我');
        const bu = bubbleEl({ mine: me, head: head, text: m.body, time: hhmm(m.at) });
        bu.className = 'tk-bub ' + (me ? 'me' : 'him');
        box.appendChild(bu);
      });
      /* 他在自己会话里回的话（从 Hermes 回答框里抠的）：也写清是他 → 我 */
      live.forEach((t) => {
        const bu = bubbleEl({ mine: false, head: (r.title || r.full_name) + ' → 我', text: t, time: '' });
        bu.className = 'tk-bub him';
        box.appendChild(bu);
      });
      box.scrollTop = box.scrollHeight;
      this.pullRoleOutput(r);
    },

    /* 输入：只让他敲"要说的话"，别的都不用选 */
    ask(target, kind) {
      const who = target === '全体' ? '全体' : (this.roles.find((x) => x.full_name === target) || {}).title || target;
      const text = window.prompt(kind === 'broadcast' ? '对全体喊话：' : ('对 ' + who + ' 说：'), '');
      if (text == null || !text.trim()) return;
      this.send(target, kind, text.trim());
    },
    async send(target, kind, body) {
      if (this.busy) return;
      this.busy = true;
      try {
        if (kind === 'broadcast') await rpc('talk.shout', { body: body, by: this.asWho || 'me' });
        else await rpc('talk.say', { role: target, body: body, kind: kind || 'private', by: this.asWho || 'me' });
        HP.App.toast('已发出');
        await this.tick().catch(() => { });
        this.render();
      } catch (e) { HP.App.toast('发不出去：' + e.message, 5000); }
      finally { this.busy = false; }
    },
    async newSolo() {
      try {
        const r = await rpc('talk.solo');
        HP.App.toast('新对话：' + ((r && r.tmux) || ''));
        this.render();
      } catch (e) { HP.App.toast('开不了新对话：' + e.message, 5000); }
    },
    async openSession(s) {
      if (s.role) {
        try {
          const r = await rpc('talk.switch', { role: s.role });
          if (r && r.switched) HP.App.toast('已切到 ' + s.role, 2500);
        } catch (e) { /* 切不过去也照样能看记录 */ }
        return this.openRole(s.role);
      }
      if (false) return this.openRole(s.role);
      HP.App.toast('这是单独对话（' + s.name + '）：在终端里 tmux attach -t ' + s.tmux, 5000);
    },
    when(ts) {
      try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ''; }
    }
  };

  HP.Talk = Talk;
})();
