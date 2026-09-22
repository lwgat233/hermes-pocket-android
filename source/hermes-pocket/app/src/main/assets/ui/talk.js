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

  /* monospace 的会话名：跟服务端 tmux_session() 一致 */
  const sess = (full) => 'role-' + String(full || '').replace(/\./g, '-');

  const Talk = {
    roles: [], msgs: [], last: 0, view: 'channel', sel: null, busy: false, timer: null,
    withPrivate: true, live: true,
    chOpen: false,                 /* 「频道」折叠状态 */
    cache: {},                     /* role -> 上次读到的会话输出（切回来秒显，充当"多窗口"） */
    asks: [],

    onShow() { this.render(); this.startPoll(); },
    onHide() { this.stopPoll(); },
    startPoll() {
      this.stopPoll();
      if (!this.live) return;
      this.timer = setInterval(() => this.tick().catch(() => { }), 2000);
    },
    stopPoll() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },

    async refreshRoles() {
      const r = await rpc('talk.roles');
      const scenes = (r && r.scenes) || [];
      this.channels = (r && r.channels) || {};
      this.roles = [];
      scenes.forEach((s) => (s.roles || []).forEach((x) => { x.scene = s.scene; this.roles.push(x); }));
    },

    async refreshAsks() {
      try { const r = await rpc('talk.asks'); this.asks = (r && r.asks) || []; }
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
      const el = document.getElementById('tab-talk');
      if (!el) return;
      el.textContent = '';
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

      el.appendChild(this.title('频道'));
      const stream = document.createElement('div');
      stream.className = 'tk-stream';
      stream.id = 'tk-stream';
      el.appendChild(stream);
      this.paintStream();
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
        const d = document.createElement('div');
        d.className = 'tk-msg';
        d.innerHTML = '<b>' + (KIND[m.kind] || '·') + '</b> ' + esc(m.from) + ' → ' + esc(m.to || '全体') +
          ' <span class="tk-dim">' + esc((m.topic || '')) + '</span><br>' + esc((m.body || '').split('\n')[0]);
        s.appendChild(d);
      });
    },

    async paintHistory(el) {
      try {
        const r = await rpc('talk.sessions');
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
      const back = document.createElement('button');
      back.className = 'tk-chip';
      back.setAttribute('data-testid', 'talk-back');
      back.textContent = '← 频道';
      back.addEventListener('click', () => { this.view = 'channel'; this.sel = null; this.render(); });
      el.appendChild(back);

      const head = document.createElement('div');
      head.className = 'tk-title';
      head.textContent = (r.title || r.name) + '　' + (r.state === 'paused' ? '被停' : (r.online ? '在线' : '不在线')) + (r.pending ? ' · 欠 ' + r.pending : '');
      el.appendChild(head);

      const out = document.createElement('pre');
      out.className = 'tk-term';
      out.id = 'tk-term';
      /* 缓存命中就先铺上（切回来秒显，像另一个窗口一直都开着），再后台刷新 */
      out.textContent = this.cache[r.full_name] || '（正在读他的会话…）';
      el.appendChild(out);
      rpc('talk.capture', { role: r.full_name, lines: 200 }).then((c) => {
        const raw = (c && c.raw) || '（没内容）';
        this.cache[r.full_name] = raw;
        const box = document.getElementById('tk-term');
        if (box && this.sel && this.sel.full_name === r.full_name) box.textContent = raw;
      }).catch((e) => {
        if (!this.cache[r.full_name]) out.textContent = '读不到：' + e.message;
      });

      const inbox = document.createElement('button');
      inbox.className = 'tk-act';
      inbox.setAttribute('data-testid', 'talk-inbox');
      inbox.textContent = '看他要回什么';
      inbox.addEventListener('click', async () => {
        try {
          const ib = await rpc('talk.inbox', { role: r.full_name });
          const raw = (ib && ib.raw) || '';
          HP.App.toast(raw ? raw.split('\n').slice(0, 3).join(' / ') : '（他不欠你回复）', 5000);
        } catch (e) { HP.App.toast('读不到：' + e.message); }
      });
      el.appendChild(inbox);

      const say = document.createElement('button');
      say.className = 'tk-act';
      say.setAttribute('data-testid', 'talk-say');
      say.textContent = '跟他说一句';
      say.addEventListener('click', () => this.ask(r.full_name, 'private'));
      el.appendChild(say);
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
        if (kind === 'broadcast') await rpc('talk.shout', { body: body });
        else await rpc('talk.say', { role: target, body: body });
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
    openSession(s) {
      if (s.role) return this.openRole(s.role);
      HP.App.toast('这是单独对话（' + s.name + '）：在终端里 tmux attach -t ' + s.tmux, 5000);
    },
    when(ts) {
      try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ''; }
    }
  };

  HP.Talk = Talk;
})();
