/* Hermes Pocket — 频道（多角色）：角色按钮 + 实时消息流 + 跟某个角色说话
 * 规矩（用户 2026-09-22 定）：**全按键，不输指令** ——
 *   点哪个角色就是跟谁说话（没有"选对象"、没有"选私信/广播"）；用户只敲"要说的话"。
 * 后端全部走 HP.App.rpc('talk.xxx')（原生侧命令固定，用户数据只进参数）。
 * 失败不连累其它栏目：本模块所有渲染都包在 try/catch 里。
 */
(function () {
  const HP = (window.HP = window.HP || {});
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rpc = (op, args) => HP.App.rpc(op, args || {}, 20000);

  const KIND = { broadcast: '📢', private: '🔒', default: '· ' };

  const Talk = {
    roles: [], msgs: [], last: 0, view: 'channel', sel: null, busy: false, timer: null,
    withPrivate: true, live: true,

    /* 切到频道栏目时开轮询；离开就停（省电、也不在后台刷） */
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

    async tick() {
      const r = await rpc('talk.since', { id: this.last });
      const list = (r && r.messages) || [];
      if (list.length) {
        list.forEach((m) => this.msgs.push(m));
        this.last = r.last || this.last;
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
        if (!this.last) { const r = await rpc('talk.since', { id: 0 }); this.last = (r && r.last) || 0; this.msgs = (r && r.messages) || []; }
      } catch (e) { HP.App.toast('连不上频道：' + e.message); }
      try { this.view === 'role' && this.sel ? this.paintRole(el) : this.paintChannel(el); }
      catch (e) { el.textContent = '频道画不出来：' + e.message; }
    },

    /* ---------------- 频道页 ---------------- */
    paintChannel(el) {
      const head = document.createElement('div');
      head.className = 'tk-row';
      head.appendChild(this.toggle('实时', this.live, (v) => { this.live = v; v ? this.startPoll() : this.stopPoll(); this.render(); }));
      head.appendChild(this.toggle('含私信 🔒', this.withPrivate, (v) => { this.withPrivate = v; this.paintStream(); }));
      el.appendChild(head);

      const title = document.createElement('div');
      title.className = 'tk-title';
      title.textContent = '跟谁说';
      el.appendChild(title);

      const scenes = {};
      this.roles.forEach((r) => (scenes[r.scene || '?'] = scenes[r.scene || '?'] || []).push(r));
      Object.keys(scenes).sort().forEach((sc) => {
        const cap = document.createElement('div');
        cap.className = 'tk-scene';
        cap.textContent = sc;
        el.appendChild(cap);
        const wrap = document.createElement('div');
        wrap.className = 'tk-roles';
        scenes[sc].forEach((r) => {
          const b = document.createElement('button');
          b.className = 'tk-role' + (r.state === 'paused' ? ' paused' : '') + (r.online ? ' online' : '');
          b.setAttribute('data-role', r.full_name);
          const chans = (r.channels || []).join('·');
          b.innerHTML = '<span class="tk-dot"></span>' + esc(r.title || r.name) +
            (chans ? '<span class="tk-ch">' + esc(chans) + '</span>' : '') +
            (r.pending ? '<span class="tk-badge">' + r.pending + '</span>' : '');
          b.addEventListener('click', () => this.openRole(r.full_name));
          wrap.appendChild(b);
        });
        el.appendChild(wrap);
      });

      /* ＋ 新角色：在客户端就能建（服务端只记名册，回头 roles-json 就带出来） */
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

      /* 接入表（经理维护）：哪个频道里谁能收到消息 */
      const chs = Object.keys(this.channels || {});
      if (chs.length) {
        const ct = document.createElement('div');
        ct.className = 'tk-title';
        ct.textContent = '频道（谁能接入）';
        el.appendChild(ct);
        const cl = document.createElement('div');
        cl.className = 'tk-hist';
        cl.id = 'tk-channels';
        chs.sort().forEach((c) => {
          const d = document.createElement('div');
          d.className = 'tk-hist-row';
          d.textContent = c + ' → ' + (this.channels[c] || []).join('、');
          cl.appendChild(d);
        });
        el.appendChild(cl);
      }

      this.paintAsks(el);      /* 异步拉「等你授权」：拉到就插在动作键前面 */

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

      const h = document.createElement('div');
      h.className = 'tk-title';
      h.textContent = '上次聊过';
      el.appendChild(h);
      const hist = document.createElement('div');
      hist.className = 'tk-hist';
      hist.id = 'tk-hist';
      el.appendChild(hist);
      this.paintHistory(hist);

      const st = document.createElement('div');
      st.className = 'tk-title';
      st.textContent = '频道';
      el.appendChild(st);
      const stream = document.createElement('div');
      stream.className = 'tk-stream';
      stream.id = 'tk-stream';
      el.appendChild(stream);
      this.paintStream();
    },

    async paintAsks(el) {
      await this.refreshAsks();
      if (!this.asks.length) return;
        /* 等你授权：谁在等你答、等的是什么 —— 答完自动从这儿消失 */
        if (this.asks.length) {
          const at = document.createElement('div');
          at.className = 'tk-title';
          at.textContent = '等你授权（' + this.asks.length + '）';
          el.appendChild(at);
          const box = document.createElement('div');
          box.className = 'tk-asks';
          box.id = 'tk-asks';
          this.asks.forEach((k) => {
            const row = document.createElement('div');
            row.className = 'tk-ask';
            row.setAttribute('data-ask', String(k.id));
            const head = document.createElement('div');
            head.className = 'tk-askhead';
            head.textContent = k.from + '\u3000' + (k.topic || '');
            const what = document.createElement('div');
            what.className = 'tk-askbody';
            what.textContent = (k.body || '').replace(/^\u3010[^\u3011]*\u3011\u6765\u81ea[^\n]*\n/, '');
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
            box.appendChild(row);
          });
          const anchor = el.querySelector('.tk-acts');
          if (anchor) el.insertBefore(box, anchor); else el.appendChild(box);
        }

    },

    async refreshAsks() {
      try { const r = await rpc('talk.asks'); this.asks = (r && r.asks) || []; }
      catch (e) { this.asks = []; }
    },

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

    /* ---------------- 跟某个角色说话 ---------------- */
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
      head.textContent = (r.title || r.name) + '　' + (r.state === 'paused' ? '被停' : '在跑') + (r.pending ? ' · 欠 ' + r.pending : '');
      el.appendChild(head);

      const out = document.createElement('pre');
      out.className = 'tk-term';
      out.id = 'tk-term';
      out.textContent = '（正在读他的会话…）';
      el.appendChild(out);
      try {
        const c = await rpc('talk.capture', { role: r.full_name, lines: 200 });
        out.textContent = (c && (c.raw || '')) || '（没内容）';
      } catch (e) { out.textContent = '读不到：' + e.message; }

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
