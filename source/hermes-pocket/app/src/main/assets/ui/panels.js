/* Hermes Pocket — 三个面板：主机 / 密钥 / 设置
 * 面板只读数据 + 调 HP.App.rpc，不直接碰传输层。
 * 密码类字段是「只写」的：host.list 只回 hasPassword，永不回传明文。 */
(function () {
  const HP = (window.HP = window.HP || {});
  const A = () => HP.App;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const Panels = {
    hosts: [], keys: [],
    editing: null,     // 正在编辑的主机
    _loaded: false,

    /**
     * 偏好**不在这里存第二份**：唯一权威源是 `HP.App.prefs`，写只走 `App.setPref`。
     * 以前面板自己存一份 prefs，改完只更新那一份 —— 终端读的 App.prefs 没变，
     * 于是「调字号无效」；冷启动两边又各读各的，就有了「设置保持不住」。这里只做只读转发。
     */
    get prefs() { return (HP.App && HP.App.prefs) || {}; },

    async load(force) {
      if (this._loaded && !force) return;
      try {
        const [hosts, keys] = await Promise.all([
          A().rpc('host.list').catch(() => []),
          A().rpc('key.list').catch(() => [])
        ]);
        this.hosts = hosts || []; this.keys = keys || [];
        this._loaded = true;
      } catch (e) { A().toast('加载配置失败: ' + e.message); }
    },

    /* ------------------------------------------------------------- 主机 */

    renderHosts() {
      const el = document.getElementById('tab-hosts');
      const rows = this.hosts.map((h) => `
        <div class="card" data-host="${esc(h.id)}">
          <div class="row1">
            <span class="name">${esc(h.name || h.host)}</span>
            <span class="tag">${esc(h.user)}@${esc(h.host)}:${esc(h.port)}</span>
          </div>
          <div class="sub">${esc(h.startCmd || '（默认登录 shell）')}</div>
          <div class="tags">
            <span class="tag key">${h.auth === 'key' ? '密钥 ' + esc(h.keyName || h.keyId || '') : '密码'}</span>
            ${h.autoReconnect ? '<span class="tag">自动重连</span>' : ''}
            ${h.keepalive ? '<span class="tag">保活 ' + esc(h.keepalive) + 's</span>' : ''}
            ${h.lastUsed ? '<span class="tag">上次 ' + new Date(h.lastUsed).toLocaleString() + '</span>' : ''}
          </div>
        </div>`).join('');

      el.innerHTML = `
        ${rows || '<div class="empty">还没有主机。<br>点下面「新建主机」加一台，<br>或先去「密钥」页生成一把密钥。</div>'}
        <div class="btnrow"><button class="btn primary wide" data-act="host-new">+ 新建主机</button></div>
        <div id="host-form"></div>`;

      el.querySelectorAll('.card[data-host]').forEach((c) => {
        c.addEventListener('click', () => {
          const h = this.hosts.find((x) => x.id === c.dataset.host);
          this.hostMenu(h);
        });
      });
      el.querySelector('[data-act="host-new"]').addEventListener('click', () => this.hostForm(null));
    },

    hostMenu(h) {
      A().ctxMenu([
        { label: '▶ 连接 ' + (h.name || h.host), fn: () => { A().closePanel(); A().connect(h.id); } },
        { label: '编辑', fn: () => this.hostForm(h) },
        { label: '复制 ssh 命令', fn: () => A().copy(`ssh -p ${h.port} ${h.user}@${h.host}`) },
        { label: '删除', cls: 'danger', fn: async () => {
            await A().rpc('host.delete', { id: h.id }); this._loaded = false; await this.load(true);
            this.renderHosts(); A().toast('已删除');
          } }
      ]);
    },

    hostForm(h) {
      const f = h || { name: '', host: '', port: 22, user: '', auth: 'key', keyId: '', startCmd: '', autoReconnect: true, keepalive: 30 };
      const box = document.getElementById('host-form');
      box.innerHTML = `
        <div class="card">
          <div class="field"><label>名称</label><input id="hf-name" value="${esc(f.name)}" placeholder="NAS / 家里服务器"></div>
          <div class="field"><label>地址</label><input id="hf-host" value="${esc(f.host)}" placeholder="192.168.1.10 或 域名" autocapitalize="off" autocorrect="off"></div>
          <div class="field"><label>端口</label><input id="hf-port" type="number" inputmode="numeric" value="${esc(f.port)}"></div>
          <div class="field"><label>用户名</label><input id="hf-user" value="${esc(f.user)}" autocapitalize="off" autocorrect="off"></div>
          <div class="field"><label>认证方式</label>
            <select id="hf-auth">
              <option value="key" ${f.auth === 'key' ? 'selected' : ''}>密钥（推荐）</option>
              <option value="password" ${f.auth === 'password' ? 'selected' : ''}>密码</option>
            </select>
          </div>
          <div class="field" id="hf-keywrap"><label>使用的密钥</label>
            <select id="hf-key">${this.keys.map((k) => `<option value="${esc(k.id)}" ${f.keyId === k.id ? 'selected' : ''}>${esc(k.name)} · ${esc(k.algo)}</option>`).join('') || '<option value="">（无密钥，请先去密钥页生成）</option>'}</select>
          </div>
          <div class="field" id="hf-pwwrap" style="display:none"><label>密码${f.hasPassword ? '（已保存，留空则不改）' : ''}</label>
            <input id="hf-pw" type="password" placeholder="只写不读，存进 Android Keystore 加密库" autocomplete="off">
          </div>
          <div class="field"><label>登录后自动执行（可选）</label>
            <input id="hf-cmd" value="${esc(f.startCmd)}" placeholder="tmux new -As hermes 'hermes --tui'" autocapitalize="off" autocorrect="off">
            <div class="hint">填 tmux 命令 → 断线重连后 Hermes 会话原样还在，这是「长期链接」的关键。</div>
          </div>
          <div class="field"><label>保活间隔（秒）</label><input id="hf-ka" type="number" inputmode="numeric" value="${esc(f.keepalive || 30)}"></div>
          <div class="field"><label><input type="checkbox" id="hf-ar" ${f.autoReconnect ? 'checked' : ''} style="width:auto"> 断线自动重连</label></div>
          <div class="btnrow">
            <button class="btn primary" id="hf-save">保存</button>
            <button class="btn" id="hf-cancel">取消</button>
          </div>
        </div>`;

      const sync = () => {
        const key = box.querySelector('#hf-auth').value === 'key';
        box.querySelector('#hf-keywrap').style.display = key ? '' : 'none';
        box.querySelector('#hf-pwwrap').style.display = key ? 'none' : '';
      };
      box.querySelector('#hf-auth').addEventListener('change', sync); sync();

      box.querySelector('#hf-cancel').addEventListener('click', () => { box.innerHTML = ''; });
      box.querySelector('#hf-save').addEventListener('click', async () => {
        const o = {
          id: f.id || undefined,
          name: box.querySelector('#hf-name').value.trim(),
          host: box.querySelector('#hf-host').value.trim(),
          port: parseInt(box.querySelector('#hf-port').value, 10) || 22,
          user: box.querySelector('#hf-user').value.trim(),
          auth: box.querySelector('#hf-auth').value,
          keyId: box.querySelector('#hf-key').value,
          startCmd: box.querySelector('#hf-cmd').value,
          keepalive: parseInt(box.querySelector('#hf-ka').value, 10) || 30,
          autoReconnect: box.querySelector('#hf-ar').checked
        };
        if (!o.host || !o.user) return A().toast('地址和用户名必填');
        const pw = box.querySelector('#hf-pw').value;
        if (pw) o.password = pw;
        try {
          await A().rpc('host.save', { host: o });
          this._loaded = false; await this.load(true); this.renderHosts(); A().toast('已保存');
        } catch (e) { A().toast('保存失败: ' + e.message); }
      });
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    /* ------------------------------------------------------------- 密钥 */

    renderKeys() {
      const el = document.getElementById('tab-keys');
      const rows = this.keys.map((k) => `
        <div class="card" data-key="${esc(k.id)}">
          <div class="row1"><span class="name">${esc(k.name)}</span><span class="tag key">${esc(k.algo)}${k.bits ? ' ' + k.bits : ''}</span></div>
          <div class="sub">${esc(k.fingerprint || '')}</div>
          <div class="tags">
            ${k.hasPassphrase ? '<span class="tag">有口令</span>' : '<span class="tag">无口令</span>'}
            ${k.origin === 'generated' ? '<span class="tag">本机生成</span>' : '<span class="tag">导入</span>'}
          </div>
        </div>`).join('');
      el.innerHTML = `
        ${rows || '<div class="empty">还没有密钥。<br>点「生成」得到一把 Ed25519，<br>把公钥贴到服务器的 ~/.ssh/authorized_keys 即可免密登录。</div>'}
        <div class="btnrow">
          <button class="btn primary" data-act="key-gen">生成新密钥</button>
          <button class="btn" data-act="key-imp">导入私钥</button>
        </div>
        <div id="key-io"></div>`;

      el.querySelectorAll('.card[data-key]').forEach((c) => {
        c.addEventListener('click', () => {
          const k = this.keys.find((x) => x.id === c.dataset.key);
          A().ctxMenu([
            { label: '复制公钥', fn: () => A().copy(k.publicKey, '公钥已复制') },
            { label: '复制 authorized_keys 命令',
              fn: () => A().copy(k.publicKey, '已复制：追加到服务器 ~/.ssh/authorized_keys') },
            { label: '查看私钥（明文）', cls: 'danger', fn: async () => {
                if (!(await A().confirm('私钥明文会显示在屏幕上，确认继续？', '显示'))) return;
                const pem = await A().rpc('key.reveal', { id: k.id });
                A().sheet('私钥（请勿在公共场合展示）', pem);
              } },
            { label: '删除', cls: 'danger', fn: async () => {
                if (!(await A().confirm('删除密钥 ' + k.name + '？', '删除'))) return;
                await A().rpc('key.delete', { id: k.id }); this._loaded = false; await this.load(true); this.renderKeys();
              } }
          ]);
        });
      });

      el.querySelector('[data-act="key-gen"]').addEventListener('click', () => this.keyGenForm());
      el.querySelector('[data-act="key-imp"]').addEventListener('click', () => this.keyImportForm());
    },

    keyGenForm() {
      const box = document.getElementById('key-io');
      box.innerHTML = `
        <div class="card">
          <div class="field"><label>名称</label><input id="kg-name" value="key-${new Date().toISOString().slice(0, 10)}"></div>
          <div class="field"><label>算法</label>
            <select id="kg-algo">
              <option value="ed25519">Ed25519（推荐，短且快）</option>
              <option value="rsa">RSA 4096（兼容老服务器）</option>
              <option value="ecdsa">ECDSA P-256</option>
            </select></div>
          <div class="field"><label>私钥口令（可选）</label><input id="kg-pass" type="password" autocomplete="off" placeholder="留空 = 无口令"></div>
          <div class="btnrow">
            <button class="btn primary" id="kg-go">生成</button>
            <button class="btn" id="kg-cancel">取消</button>
          </div>
        </div>`;
      box.querySelector('#kg-cancel').addEventListener('click', () => box.innerHTML = '');
      box.querySelector('#kg-go').addEventListener('click', async () => {
        A().toast('生成中…');
        try {
          const meta = await A().rpc('key.generate', {
            name: box.querySelector('#kg-name').value.trim() || 'key',
            algo: box.querySelector('#kg-algo').value,
            passphrase: box.querySelector('#kg-pass').value
          }, 30000);
          this._loaded = false; await this.load(true); this.renderKeys();
          A().sheet('公钥已生成（复制到服务器 ~/.ssh/authorized_keys）', meta.publicKey + '\n\n指纹: ' + meta.fingerprint);
        } catch (e) { A().toast('生成失败: ' + e.message); }
      });
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    },

    keyImportForm() {
      const box = document.getElementById('key-io');
      box.innerHTML = `
        <div class="card">
          <div class="field"><label>名称</label><input id="ki-name" value="imported"></div>
          <div class="field"><label>私钥内容（PEM，含 BEGIN/END 行）</label><textarea id="ki-pem" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea></div>
          <div class="field"><label>私钥口令（如果有）</label><input id="ki-pass" type="password" autocomplete="off"></div>
          <div class="btnrow">
            <button class="btn primary" id="ki-go">导入并加密保存</button>
            <button class="btn" id="ki-cancel">取消</button>
          </div>
        </div>`;
      box.querySelector('#ki-cancel').addEventListener('click', () => box.innerHTML = '');
      box.querySelector('#ki-go').addEventListener('click', async () => {
        try {
          await A().rpc('key.import', {
            name: box.querySelector('#ki-name').value.trim() || 'imported',
            privatePem: box.querySelector('#ki-pem').value,
            passphrase: box.querySelector('#ki-pass').value
          }, 20000);
          this._loaded = false; await this.load(true); this.renderKeys(); A().toast('已导入');
        } catch (e) { A().toast('导入失败: ' + e.message); }
      });
    },

    /* ------------------------------------------------------------- 设置 */

    S: [
      { k: 'fontSize', label: '字号', type: 'num', min: 6, max: 48, def: 13, hint: '想要大字就往上调（最大 48）；列数会跟着字号自动变少，不会超出屏幕。也可以直接在终端上双指缩放' },
      { k: 'geomMode', label: 'TUI 列策略', type: 'sel', def: 'auto',
        opts: [['auto', '自动（按屏幕宽度铺满）'], ['fill', '铺满屏幕宽度'], ['fixed', '固定列数 + 横向平移']] },
      { k: 'tuiFidelity', label: 'TUI 保真（强行凑 ≥80 列）', type: 'bool', def: false,
        hint: '关（默认）：终端宽度不超过屏幕，不需要左右滑动。开：为了 TUI 框线不错位而凑够 80 列，字会更小且要左右滑动看全' },
      { k: 'fixedCols', label: '固定列数', type: 'sel', def: '100', opts: [['80', '80 列'], ['100', '100 列'], ['120', '120 列'], ['160', '160 列'], ['200', '200 列'], ['240', '240 列']] },
      { k: 'fixedRows', label: '固定行数（0 = 跟随屏幕高度）', type: 'num', min: 0, max: 200, def: 0, hint: '想随手改大小：长按终端 →「⇔ 窗口大小 / 字号」可以直接填任意列数/行数/字号' },
      { k: 'scrollback', label: '回滚缓冲（行）', type: 'sel', def: '5000', opts: [['1000', '1000'], ['5000', '5000'], ['20000', '20000'], ['100000', '100000']] },
      { k: 'touchMouse', label: '触摸转鼠标（TUI 里点按钮）', type: 'bool', def: true },
      { k: 'tapKeyboard', label: '点击终端弹出键盘', type: 'bool', def: false,
        hint: '默认关闭：手机上随手一点就被键盘盖住半屏。要打字请用功能键条的「⌨ 键盘」' },
      { k: 'longPressMenu', label: '长按弹出菜单', type: 'bool', def: true },
      { k: 'showKeybar', label: '显示功能键条', type: 'bool', def: true },
      { k: 'showComposer', label: '显示输入框（手机打字更顺手）', type: 'bool', def: true },
      { k: 'liveComposer', label: '输入框实时上屏（关掉＝攒着点「发送」整行送）', type: 'bool', def: true },
      { k: 'showTraffic', label: '顶栏显示下行流量（点击看详情）', type: 'bool', def: true },
      { k: 'eventChannel', label: '文件事件通道（另开一条 SSH 盯事件文件）', type: 'bool', def: true,
        hint: '服务端 home 下放一个只追加文件，我往里写一行，手机就弹系统通知' },
      { k: 'notifyAgent', label: '远端事件通知（文件通道，非授权类）', type: 'bool', def: true },
      { k: 'autoReconnect', label: '断线自动重连', type: 'bool', def: true },
      { k: 'autoInstallKey', label: '用密码登录后自动把公钥装到服务器', type: 'bool', def: true,
        hint: '就是 ssh-copy-id。**只在这台主机还记着"用密码登录"时跑一次**；装完会用密钥真连一次验证，' +
          '验证通过才把主机切成密钥登录（之后不再装，避免每次连接都上传一遍）' },
      { k: 'notifyCommandDone', label: '通知：命令跑完了', type: 'bool', def: true,
        hint: '按回车起算，输出静下来且回到提示符就认为跑完；只有超过 10 秒的命令才通知（不用远端做任何配置）' },
      { k: 'notifyBell', label: '通知：远端响铃（BEL）', type: 'bool', def: true, hint: '很多程序跑完/出错会响铃，是最经典的"叫我"信号' },
      { k: 'notifyOsc', label: '通知：脚本主动通知（OSC 777/9）', type: 'bool', def: true,
        hint: "远端脚本可以发 printf '\\e]777;notify;标题;正文\\a' 来主动通知" },
      { k: 'notifyChatState', label: '通知：聊天状态（结束 / 压缩）', type: 'bool', def: true,
        hint: '监听聊天输出判出来的「运行中 / 压缩中 / 已结束」；只在后台时打扰你，前台看顶栏那一行字' },
      { k: 'notifyAttention', label: '通知：需要授权 / 连接失败', type: 'bool', def: true, hint: '需要确认主机指纹、连接失败这类必须让你知道的事' },
      { k: 'notifyConn', label: '通知：连接断开', type: 'bool', def: false, hint: '默认关，避免频繁弹' },
      { k: 'reconnectDelay', label: '重连起始间隔（秒）', type: 'num', min: 1, max: 30, def: 3 },
      { k: 'keepAwake', label: '保持唤醒 + 前台服务（原生）', type: 'bool', def: true,
        hint: '开着链接最稳（能扛住整夜 Doze），代价是一直占着 CPU。省电模式会在息屏时**临时**放开它，亮屏立刻收回' },
      { k: 'powerSave', label: '省电模式', type: 'sel', def: 'screenOff',
        opts: [['off', '关（最稳、最费电）'], ['screenOff', '息屏时省电（推荐）'], ['background', '后台 + 息屏省电']],
        hint: '省电 ≠ 断连：后台**不渲染**（输出先落盘缓存，回前台再补渲染）、放开 CPU 唤醒锁、拉长心跳（不关，关了连接可能被中间设备掐掉）、暂停每秒统计；TCP 连接一直保留' },
      { k: 'powerSaveDelay', label: '息屏后延迟多久进入省电', type: 'sel', def: '0',
        opts: [['0', '立即'], ['60', '1 分钟'], ['300', '5 分钟'], ['900', '15 分钟']] },
      { k: 'rerunStartCmd', label: '重连后自动回到原会话（重跑启动命令）', type: 'bool', def: true,
        hint: '重连后是新的 shell；重跑启动命令（例如 tmux new -As hermes）才能回到你原来的会话' },
      { k: 'nerdFont', label: '加载 assets/ui/fonts/terminal.ttf 作为终端字体', type: 'bool', def: true, hint: '放一个 Nerd Font 进去就有完整图标字形' }
    ],

    /**
     * 刷新设置面板里的「通知权限」状态。
     * 没权限时系统的行为是**静默丢弃**，用户只会觉得"没收到" —— 所以状态要说得直白。
     */
    async refreshNotifyState() {
      const el = document.querySelector('#nt-state');
      if (!el) return;
      const st = await A().rpc('app.notification.state').catch(() => null);
      if (!st) { el.textContent = '不适用（当前是 Web 通道，没有系统通知）'; el.style.color = '#9fb3c8'; return; }
      if (st.granted) {
        el.textContent = '已授权 · 现在是「' + (st.foreground ? 'App 前台' : 'App 后台') + '」（前台时普通通知不打扰）';
        el.style.color = 'var(--accent)';
      } else {
        el.textContent = '未授权 ← 点下面「申请通知权限」，或去系统设置里打开';
        el.style.color = '#ff8a80';
      }
    },

    /* ------------------------------------------------------ Hermes 技能/记忆页 */

    /**
     * 「Hermes」页：看远端的技能清单 + 记忆内容。
     *
     * 数据都走**终端那条会话**上的临时 exec 通道取（原生 `hermes.info/memory/read`），
     * 只有真的停在这一页时才去读 —— 打开面板不该顺手拉 60 个文件。
     */
    async renderHermes(force) {
      const el = document.getElementById('tab-hermes');
      if (!el) return;
      if (!force && !el.classList.contains('on')) return;
      if (!A().sessionId) {
        el.innerHTML = '<div class="card"><div class="sub">还没连接 —— 连上后这里能看远端 Hermes 的技能与记忆</div></div>';
        return;
      }
      const bind = () => {
        el.querySelector('[data-h="reload"]')?.addEventListener('click', () => this.renderHermes(true));
        el.querySelectorAll('[data-skill]').forEach((r) => r.addEventListener('click', () =>
          this.openSkill(r.dataset.skill, r.dataset.name || r.dataset.skill)));
      };
      // 缓存：这页读的是**远端磁盘**（技能清单要扫目录、记忆要读两个文件），
      // 每切一次就重读一遍的话，来回切栏目就会一直"读取中…"。60 秒内直接拿缓存。
      const fresh = this._hermesCache && (Date.now() - this._hermesAt < 60000);
      if (fresh && !force) {
        el.innerHTML = this._hermesHtml(this._hermesCache.info, this._hermesCache.mem, this._hermesCache.prompt);
        this._fillRemoteRows(el, this._hermesCache.prompt, this._hermesCache.model);
        bind();
        return;
      }
      el.innerHTML = '<div class="card"><div class="sub">读取中…（技能清单 + 记忆 + 系统提示词）</div></div>';
      const { info, mem, prompt, model } = await this._fetchHermes();
      if (info.err) {
        el.innerHTML = '<div class="card"><div class="sub">读取技能失败：' + esc(info.err) + '</div>'
          + '<button class="btn" data-h="reload" style="margin-top:8px">重试</button></div>';
        el.querySelector('[data-h="reload"]')?.addEventListener('click', () => this.renderHermes(true));
        return;
      }
      this._hermesCache = { info, mem, prompt, model };
      this._hermesAt = Date.now();
      el.innerHTML = this._hermesHtml(info, mem, prompt);
      this._fillRemoteRows(el, prompt, model);
      bind();
    },

    /**
     * 读远端技能清单 + 记忆。**同一次读取只发一遍**（切栏目时 renderHermes 会被调用两次：
     * 一次是点栏目、一次是 renderAll），所以这里把 promise 记住；读的时候顺手量耗时。
     */
    _fetchHermes() {
      if (this._hermesPromise) return this._hermesPromise;
      const t0 = performance.now();
      this._hermesCalls = (this._hermesCalls || 0) + 1;
      // 三个远端读取一起发：技能清单 / 记忆 / **系统提示词**（都是只读，界面侧一次性拿到）
      // 超时给短一点：远端慢的时候不该让用户对着"读取中"等半分钟（以前是 30s/25s）
      this._hermesPromise = Promise.all([
        A().rpc('hermes.info', {}, 12000).catch((e) => ({ err: String(e.message || e) })),
        A().rpc('hermes.memory', {}, 10000).catch((e) => ({ err: String(e.message || e) })),
        HP.Remote.prompt({ chars: 1200 }),
        HP.Remote.model()
      ]).then(([info, mem, prompt, model]) => {
        this._hermesMs = Math.round(performance.now() - t0);
        this._hermesPromise = null;
        return { info, mem, prompt, model };
      });
      return this._hermesPromise;
    },

    /**
     * 往 Hermes 页塞「远端信息」那两行（系统提示词 / 模型）—— 行由统一渲染器 `HP.UI.row` 生成。
     * 数据来自只读 op：`hermes.prompt`（state.db 里真存过的那份提示词）、`hermes.model`（config.yaml 的 model 段）。
     */
    _fillRemoteRows(root, prompt, model) {
      const slot = (root || document).querySelector('#hp-prompt-slot');
      if (!slot) return;
      slot.textContent = '';
      slot.appendChild(HP.UI.row({
        title: '系统提示词',
        sub: HP.Remote.promptSummary(prompt),
        right: prompt && prompt.ok ? (prompt.total + ' 字符') : '',
        testid: 'remote-prompt',
        onTap: () => this.openPromptSheet(prompt)
      }));
      slot.appendChild(HP.UI.row({
        title: '模型',
        sub: HP.Remote.modelSummary(model),
        right: model && model.ok ? model.model : '',
        testid: 'remote-model',
        onTap: () => this.openModelSheet(model)
      }));
    },

    /**
     * 改模型的小窗：当前值可编辑 + 候选一键填入 + 一组动作。
     * 写回是**危险操作**，所以远端先备份再改，改完读回校验；小窗里同时给「还原上次」——
     * 能撤销，就不弹确认框拦人（用户的方法论 §20）。
     */
    async openModelSheet(m) {
      const cur = (m && m.ok) ? m : await HP.Remote.model();
      if (!cur.ok) { A().toast('取不到远端模型：' + (cur.err || '未知原因'), 3600); return; }
      const sheets = () => HP.UI.sheet({
        title: '远端模型（' + (cur.provider || '未知 provider') + '）',
        fields: [
          { key: 'model', label: '模型名（改完点「写回并校验」）', value: cur.model, editable: true },
          { label: '配置文件', value: cur.path + (cur.writable ? '' : '　⚠ 只读，写不进去') },
          { label: '接口地址', value: cur.base || '—' }
        ],
        choices: cur.candidates.slice(0, 4).map((c) => ({ key: 'model', label: c, value: c })),
        text: cur.backups && cur.backups.length ? ('已有备份：' + cur.backups.join('\n')) : undefined,
        actions: [
          {
            label: '写回并校验', primary: true, fn: async (box, values) => {
              const want = (values && values.model || '').trim();
              if (!want || want === cur.model) { A().toast(want ? '和现在一样，没改' : '先填模型名'); return; }
              A().toast('正在写回并校验…', 4000);
              const r = await HP.Remote.setModel(want);
              if (!r.ok) { A().toast('写回失败：' + (r.err || '未知原因'), 4200); return; }
              box.remove();
              A().toast('模型已改为 ' + r.model + '（读回校验通过 · yaml ' + r.yaml + '）', 4200);
              this._hermesCache = null; this._hermesAt = 0;   // 缓存里那份旧的不要了
              this.renderHermes(true);
            }
          },
          {
            label: '还原上次', fn: async (box) => {
              const r = await HP.Remote.undoModel();
              if (!r.ok) { A().toast('还原失败：' + (r.err || '未知原因'), 4200); return; }
              box.remove();
              A().toast('已还原到 ' + r.model + '（来自 ' + r.from + '）', 4200);
              this._hermesCache = null; this._hermesAt = 0;
              this.renderHermes(true);
            }
          },
          { label: '关闭' }
        ]
      });
      return sheets();
    },

    /** 点开看系统提示词：来源/长度 + 正文（可滚动）+ 一组动作（看更多 / 复制 / 关闭） */
    async openPromptSheet(p, offset) {
      const off = offset || 1;
      const cur = (off === 1 && p && p.ok) ? p : await HP.Remote.prompt({ offset: off, chars: 1200 });
      if (!cur.ok) { A().toast('取不到系统提示词：' + (cur.err || '未知原因'), 3600); return; }
      const shown = Math.min((cur.offset || 1) + (cur.chars || 1200) - 1, cur.total || 0);
      const atEnd = shown >= (cur.total || 0);
      HP.UI.sheet({
        title: '系统提示词（' + (cur.offset || 1) + '–' + shown + ' / ' + cur.total + ' 字符）',
        fields: [
          { label: '来源', value: '远端 state.db · system_prompts · ' + (cur.files || 0) + ' 份' + (cur.hash ? ' · hash ' + cur.hash : '') },
          { label: '开头一行', value: cur.head || '—' }
        ],
        text: cur.text,
        actions: [
          { label: atEnd ? '已到底' : '看更多', fn: (box) => { if (atEnd) { A().toast('已经到底了'); return; } box.remove(); this.openPromptSheet(cur, shown + 1); } },
          { label: '复制', fn: () => { HP.App.copy(cur.text || ''); } },
          { label: '关闭' }
        ]
      });
    },

    _pct(cur, lim) { return lim > 0 ? Math.round((cur / lim) * 100) + '%（' + cur + '/' + lim + ' 字符）' : cur + ' 字符'; },

    _hermesHtml(info, mem, prompt) {
      const skills = info.skills || [];
      // 按分类分组：目录结构就是 分类/技能名/SKILL.md
      const byCat = {};
      skills.forEach((s) => { (byCat[s.category] = byCat[s.category] || []).push(s); });
      const cats = Object.keys(byCat).sort();
      const skillRows = cats.map((c) => `
        <div class="sub" style="margin-top:10px;opacity:.75">${esc(c)} · ${byCat[c].length}</div>
        ${byCat[c].map((s) => `
          <div data-skill="${esc(s.path || s.rel)}" data-name="${esc(s.name)}"
               style="padding:7px 8px;margin:4px 0;border-radius:8px;background:#0a1119;border:1px solid var(--line)">
            <div style="font-weight:600;font-size:13px;color:var(--accent)">${esc(s.name)}</div>
            <div style="font-size:11.5px;opacity:.8;margin-top:2px">${esc(s.desc || '（没有 description）')}</div>
            <div style="font-size:10.5px;opacity:.55;margin-top:2px">${esc(s.rel)} · ${s.size} 字节</div>
          </div>`).join('')}`).join('');
      const memBlock = (title, text, cur, lim) => `
        <div class="sub" style="margin-top:10px">${title} · ${this._pct(cur, lim)}</div>
        <pre style="white-space:pre-wrap;font-size:11.5px;background:#0a1119;padding:8px;border-radius:8px;max-height:260px;overflow:auto;margin:4px 0">${esc((text || '').trim() || '（空）')}</pre>`;
      const memErr = mem.err ? `<div class="sub" style="color:#ff8a80">记忆读取失败：${esc(mem.err)}</div>` : '';
      return `
        <div class="card">
          <div class="sub" style="color:var(--fg)">远端 Hermes</div>
          <div class="sub" style="margin-top:4px">目录 <b>${esc(info.home || '?')}</b> · 技能 <b>${info.count || skills.length}</b> 个 · 读取耗时 <b>${this._hermesMs || 0} ms</b></div>
          <button class="btn" data-h="reload" style="margin-top:8px">刷新</button>
        </div>
        <div class="card"><div id="hp-prompt-slot"></div></div>
        <div class="card">
          <div class="sub" style="color:var(--fg)">记忆（§ 分隔的条目，就是"我记住的东西"）</div>
          ${memErr}
          ${memBlock('USER.md（关于你）', mem.user, mem.userChars || 0, info.userLimit || 0)}
          ${memBlock('MEMORY.md（我的笔记）', mem.memory, mem.memoryChars || 0, info.memoryLimit || 0)}
        </div>
        <div class="card">
          <div class="sub" style="color:var(--fg)">技能（点一个看内容）</div>
          ${skillRows || '<div class="sub">没找到技能目录</div>'}
        </div>`;
    },

    /** 看单个技能的内容（可「在终端打开」） */
    /** 技能行点开：读原文（带 sha256）→ 小窗看内容 → 〔下载到手机〕〔编辑并回写〕〔关闭〕 */
    async openSkill(rel, name) {
      const sk = await HP.Remote.skillRead(rel);
      if (!sk.ok) { A().toast('读技能失败：' + (sk.err || '未知原因'), 4200); return; }
      const fields = [
        { label: '远端路径', value: '~/.hermes/' + rel },
        { label: '字节数 / sha256', value: sk.size + ' 字节 · ' + sk.sha.slice(0, 12) }
      ];
      if (this._savedSkill && this._savedSkill.rel === rel) {
        fields.push({ label: '已存到手机', value: this._savedSkill.path + '（sha ' + this._savedSkill.sha.slice(0, 12) + '）' });
      }
      HP.UI.sheet({
        title: name,
        fields: fields,
        text: sk.text.length > 12000 ? (sk.text.slice(0, 12000) + '\n…（还长，改的时候点「编辑并回写」看全文）') : sk.text,
        actions: [
          {
            label: '下载到手机', primary: true, fn: async (box) => {
              A().toast('正在存到手机…', 3000);
              const fileName = name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) + '.md';
              const r = await HP.Remote.localSave(fileName, sk.text);
              if (!r.ok) { A().toast('存到手机失败：' + (r.err || '未知原因'), 4600); return; }
              this._savedSkill = { rel: rel, path: r.path, sha: r.sha };
              const verdict = (r.sha === sk.sha) ? '与远端一致' : '⚠ 与远端不一致';
              A().toast('已存到 ' + r.path + '（' + r.size + ' 字节 · sha ' + r.sha.slice(0, 12) + ' · ' + verdict + '）', 5200);
              box.remove();
              this.renderHermes(true);
            }
          },
          {
            label: '编辑并回写', fn: (box) => {
              if (sk.text.length > 300000) { A().toast('这篇太长（' + sk.text.length + ' 字符），手机上整篇回写这条通道没验过，先用终端改', 5200); return; }
              box.remove(); this._skillEditSheet(rel, name, sk);
            }
          },
          { label: '关闭' }
        ]
      });
    },

    /** 编辑小窗：整篇正文在多行框里改；回写时带**打开那一版的 sha256**，远端变了就拒绝写 */
    _skillEditSheet(rel, name, sk) {
      HP.UI.sheet({
        title: '编辑 ' + name,
        fields: [{ key: 'text', label: '正文', value: sk.text, editable: true, multiline: true, rows: 16 }],
        text: '打开时 sha256 ' + sk.sha.slice(0, 12) + ' · ' + sk.size + ' 字节',
        actions: [
          {
            label: '回写', primary: true, fn: async (box, values) => {
              const next = (values && values.text) || '';
              if (next === sk.text) { A().toast('和打开时一样，没改'); return; }
              A().toast('正在回写并校验…', 4000);
              const r = await HP.Remote.skillWrite(rel, next, sk.sha);
              if (!r.ok) { A().toast('回写失败：' + (r.err || '未知原因'), 5200); return; }
              box.remove();
              A().toast('已回写（' + r.size + ' 字节 · 新 sha ' + r.sha.slice(0, 12) + ' · 备份 ' + (r.backup || '无') + '）', 5200);
              this._hermesCache = null; this._hermesAt = 0;
              this.renderHermes(true);
            }
          },
          { label: '关闭' }
        ]
      });
    },

    /**
     * 把设置页里的控件值拉回**权威源**（`HP.App.prefs`），并把「现在真正生效的是什么」写成一行字。
     *
     * 为什么要有：改完设置如果界面上什么都没变，用户只能猜有没有生效 ——
     * 他报的「调节字体之类的无效」就是这么来的（改了、但看到的是旧值）。
     * 正在输入的那一栏不动（否则会把人打的字冲掉）。
     */
    syncPrefInputs(only) {
      const el = document.getElementById('tab-settings');
      if (!el) return;
      const p = this.prefs;
      el.querySelectorAll('[data-pref]').forEach((c) => {
        const k = c.dataset.pref;
        if (only && only !== k) return;
        if (c === document.activeElement) return;
        const s = this.S.find((x) => x.k === k) || {};
        const v = p[k] !== undefined ? p[k] : s.def;
        if (c.type === 'checkbox') c.checked = HP.truthy(v, s.def);
        else if (String(c.value) !== String(v)) c.value = String(v);
      });
      const eff = el.querySelector('#st-eff');
      const t = A().term;
      if (eff && t) {
        eff.textContent = `生效中：字号 ${t.options.fontSize}px · 终端 ${t.cols}×${t.rows}` +
          ` · 回滚 ${t.options.scrollback} 行 · 已保存`;
      }
    },

    renderSettings() {
      const el = document.getElementById('tab-settings');
      const row = (s) => {
        const v = this.prefs[s.k] !== undefined ? this.prefs[s.k] : s.def;
        let ctl = '';
        if (s.type === 'bool') ctl = `<input type="checkbox" data-pref="${s.k}" ${HP.truthy(v, s.def) ? 'checked' : ''} style="width:auto;transform:scale(1.25);margin-right:6px">`;
        else if (s.type === 'num') ctl = `<input type="number" inputmode="numeric" data-pref="${s.k}" value="${esc(v)}" min="${s.min}" max="${s.max}">`;
        else ctl = `<select data-pref="${s.k}">${s.opts.map(([a, b]) => `<option value="${a}" ${String(v) === a ? 'selected' : ''}>${b}</option>`).join('')}</select>`;
        return `<div class="field"><label>${esc(s.label)}</label>${ctl}${s.hint ? `<div class="hint">${esc(s.hint)}</div>` : ''}</div>`;
      };
      el.innerHTML = `
        <div class="card">
          <div class="sub" id="st-eff">生效中：—</div>
          ${this.S.map(row).join('')}
        </div>
        <div class="card">
          <div class="sub">运行通道：<b>${HP.hasNative() ? 'Android 原生 SSH（App 内直连，私钥不出设备）' : 'WebSocket → bridge/server.mjs'}</b></div>
          <div class="sub" style="margin-top:6px">协议版本 v${HP.PROTO}</div>
          <div class="sub" style="margin-top:6px">构建版本：<b>${esc(HP.BUILD)}</b>${HP.BUILDINFO ? ` · ${esc(HP.BUILDINFO.feature)}（${esc(HP.BUILDINFO.featureId)}）· 打包 ${esc(HP.BUILDINFO.builtAt)}` : ''}</div>
          ${this.prefs._vault ? `<div class="sub" style="margin-top:6px">密钥库：${esc(this.prefs._vault)}</div>` : ''}
        </div>
        <div class="card">
          <div class="field"><label>Hermes 会话命令</label><input id="st-attach" value="${esc(this.prefs.hermesAttach || HP.Hermes.attachCmd)}"></div>
          <div class="hint">连上后点功能键条最右边的「▤Hermes → 恢复/新建会话」一行搞定</div>
        </div>
        <div class="card">
          <div class="sub" style="color:var(--fg)">省电</div>
          <div class="sub" style="margin-top:6px">当前：<b id="pw-state">…</b></div>
          <div class="hint">
            <b>省电 ≠ 断连</b>。息屏/后台时只停掉"自己花 CPU 的活"：放开 CPU 唤醒锁、
            静音 SSH 心跳、暂停终端渲染看门狗（每帧）与每秒统计；
            <b>TCP 连接由内核维持着</b>，亮屏回来第一件事就是把睡着期间漏掉的输出补回来
            （环形缓冲 + seq）。<br>
            想更狠一点：把「保持唤醒」关掉 —— 链接在长时间 Doze 里可能会断，但会在亮屏时立刻重连。
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="btn" data-pw="now">立刻省电一次</button>
            <button class="btn" data-pw="wake">立刻退出省电</button>
            <button class="btn" data-pw="refresh">刷新状态</button>
          </div>
        </div>
        <div class="card">
          <div class="sub">通知权限：<b id="nt-state">检查中…</b></div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="btn" data-notif="ask">申请通知权限</button>
            <button class="btn" data-notif="settings">打开系统通知设置</button>
            <button class="btn" data-notif="test">发一条测试通知</button>
          </div>
          <div class="hint">没权限时系统会<b>静默丢掉</b>通知（不报错，所以你只会觉得"没收到"）。<br>
          国产系统（MIUI / EMUI / ColorOS…）还要在「设置 → 应用 → Hermes Pocket → 通知」里另外允许<b>通知</b>和<b>后台弹通知</b>，有的还要开<b>自启动</b>。</div>
        </div>
        <div class="card">
          <div class="field"><label>事件文件路径（服务端 home 下）</label><input id="st-evfile" value="${esc(this.prefs.eventFile || '~/hermes-pocket-events.log')}"></div>
          <div class="sub" style="margin-top:6px">事件通道：<b id="ev-state">未启动</b></div>
          <div class="hint">文件<b>只追加 + 限额</b>：用服务端的 <b>~/hpk-notify.sh</b> 写（协议见 <b>~/HERMES-POCKET-EVENTS.md</b>）。<br>
          一行一条，<code>kind: 标题 | 正文</code>，kind ∈ {auth, done, info}；<b>auth</b> 会当"需要授权"打扰你。</div>
        </div>`;

      el.querySelectorAll('[data-pref]').forEach((c) => {
        c.addEventListener('change', async () => {
          const k = c.dataset.pref;
          const v = c.type === 'checkbox' ? c.checked : c.value;
          await A().setPref(k, v);      // 唯一写入口：写内存 + 落盘 + 让设置当场生效
        });
      });
      el.querySelector('#st-attach')?.addEventListener('change', async (e) => {
        HP.Hermes.attachCmd = e.target.value;
        await A().setPref('hermesAttach', e.target.value, { apply: false });
      });
      // 省电：三个按钮（手动进/出省电、刷新状态）
      el.querySelectorAll('[data-pw]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.pw;
        if (a === 'now') await A().applyPowerSave(true, '手动');
        else if (a === 'wake') await A().applyPowerSave(false, '手动');
        else await A().refreshPowerState();
      }));
      A().renderPowerState();
      // 通知权限：状态 + 三个按钮（申请 / 去系统设置 / 测试通知）
      el.querySelectorAll('[data-notif]').forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.notif;
        if (a === 'ask') { A().rpc('app.permission.request').catch(() => { }); }
        else if (a === 'settings') { A().rpc('app.settings.notifications').catch(() => { }); }
        else {
          const r = await A().rpc('app.notify', {
            kind: 'test', title: '测试通知', body: '看到这条就说明通知没问题', urgent: true
          }).catch(() => null);
          A().toast(r ? (r.posted ? '已发出，去看通知栏' : (r.granted ? '没发出去（被前台抑制或节流）' : '没有通知权限')) : '发送失败');
        }
        setTimeout(() => this.refreshNotifyState(), 900);
      }));
      this.refreshNotifyState();
      this.syncPrefInputs();      // 「生效中」那一行要有数（设置页刚重建过）
      // 事件文件路径：改完立刻重启事件通道，省得用户不知道要重连
      el.querySelector('#st-evfile')?.addEventListener('change', async (e) => {
        const v = e.target.value.trim() || '~/hermes-pocket-events.log';
        await A().setPref('eventFile', v, { apply: false });
        A().stopEventChannel();
        A()._evWelcomed = false;
        A().startEventChannel();
        A().toast('事件文件已改为：' + v);
      });
    },

    /* ------------------------------------------------------ 会话（tmux）板块 */

    /**
     * 「会话」栏目：一行状态 + 一个会话一行（点行就切过去）。
     *
     * 规矩（用户 log 第 6 条）：**能看、能选、永不终止** —— 所以这里没有、也不许有 kill 之类的键。
     * 数据来自只读 op `tmux.list`，解析在 `HP.Sessions.parse`（纯函数，测试台能喂真实输出）。
     */
    async renderSessions(force) {
      const el = document.getElementById('tab-sessions');
      if (!el) return;
      if (!force && !el.classList.contains('on')) return;
      if (!A().sessionId) {
        el.innerHTML = '<div class="card"><div class="sub">还没连接 —— 连上后这里能看远端 tmux 会话并选一个进去</div></div>';
        return;
      }
      if (force || !HP.Sessions.at) {
        el.textContent = '';
        el.appendChild(HP.UI.status('读取中…（远端 tmux 会话）'));
        await HP.Sessions.refresh();
      }
      const S = HP.Sessions;
      el.textContent = '';
      const head = document.createElement('div');
      head.className = 'card';
      const online = A().state === 'connected' ? '已连接' : (A().state || '未知');
      head.appendChild(HP.UI.status('在线：' + online + ' · 远端 tmux：' + (S.list.length ? S.list.length + ' 个会话' : '没有会话') +
        (S.err ? '（' + S.err + '）' : '')));
      const cur = S.pick();
      head.appendChild(HP.UI.status(cur ? '当前选中：' + cur : (S.list.length ? '' : '连上后没会话会自己建一个')));
      const rf = document.createElement('button');
      rf.className = 'btn';
      rf.textContent = '刷新';
      rf.addEventListener('click', () => this.renderSessions(true));
      head.appendChild(rf);
      el.appendChild(head);

      const rows = S.list.map((s) => HP.UI.row({
        title: s.name,
        sub: '窗口 ' + s.windows + ' · 建了 ' + this._ago(s.ageSec) + (s.idleSec !== undefined ? ' · 最后活动 ' + this._ago(s.idleSec) + '前' : ''),
        right: s.attached ? 'attach 中' : '空闲',
        testid: 'session-' + s.name,
        cls: s.name === cur ? 'row-on' : '',
        onTap: () => { HP.Sessions.attach(s.name); this.renderSessions(); }
      }));
      el.appendChild(HP.UI.list(rows, HP.Sessions.err ? '远端没有 tmux 会话（' + HP.Sessions.err + '）' : '远端还没有 tmux 会话 —— 启动流程会自动建一个'));
    },

    /** 秒 → 人话（1 分钟内说"不到 1 分钟"） */
    _ago(sec) {
      const s = Math.max(0, Math.round(sec || 0));
      if (s < 60) return '不到 1 分钟';
      if (s < 3600) return Math.round(s / 60) + ' 分钟';
      if (s < 86400) return Math.round(s / 3600) + ' 小时';
      return Math.round(s / 86400) + ' 天';
    },

    /* ================================================== 网络（诊断）板块 */

    /**
     * 网络板块（log 第 2 条）：一行一个测试项，点行就跑。
     * 跑出来的数字写回行里（`HP.Net.*Summary` 一处出文案），要看原文再点「原始输出」那一行。
     */
    async renderNet(force) {
      const el = document.getElementById('tab-net');
      if (!el) return;
      if (!force && !el.classList.contains('on')) return;
      const t = HP.Net.target();
      const testing = this._netBusy;
      el.textContent = '';

      const head = document.createElement('div');
      head.className = 'card';
      head.appendChild(HP.UI.status(A().state === 'connected'
        ? ('从远端 ' + ((A().host && A().host.host) || '主机') + ' 上测 —— 丢包 / 延迟都是这一段链路的')
        : ('还没连接：目标先按回环 ' + t.host + ' 算，连上主机后再测')));
      head.appendChild(HP.UI.status('目标 ' + t.host + ' · ping ' + t.count + ' 次 · 端口 ' + t.port +
        (testing ? ' · ' + testing : '')));
      el.appendChild(head);

      const rows = [
        HP.UI.row({
          title: '测试目标', sub: '点行改地址 / 次数 / 端口', right: t.host, testid: 'net-target',
          onTap: () => this.openNetTargetSheet()
        }),
        HP.UI.row({
          title: '延迟与丢包', sub: HP.Net.pingSummary(this._ping), right: HP.Net.pingRight(this._ping),
          testid: 'net-ping', onTap: () => this.runPing()
        }),
        HP.UI.row({
          title: '端口连通', sub: HP.Net.tcpSummary(this._tcp), right: HP.Net.tcpRight(this._tcp),
          testid: 'net-tcp', onTap: () => this.runTcp()
        })
      ];
      if (this._ping || this._tcp) {
        rows.push(HP.UI.row({
          title: '原始输出', sub: '点行看这一把的原文（ping / 端口）', right: '', testid: 'net-raw',
          onTap: () => this.openNetRawSheet()
        }));
      }
      el.appendChild(HP.UI.list(rows, '还没测过 —— 点「延迟与丢包」或「端口连通」跑一次'));
    },

    /** ping 一把：行上先写"正在测"，跑完把结果写回行里（失败就说清原因，不装成功） */
    async runPing() {
      if (this._netBusy) return;
      const t = HP.Net.target();
      this._netBusy = '正在 ping ' + t.host + '（' + t.count + ' 次）…';
      this._netPaint();
      const p = await HP.Net.ping(t.host, t.count);
      this._ping = p;
      this._pingAt = Date.now();
      this._netBusy = '';
      this.renderNet(true);
      if (p.err) A().toast('ping 没跑成：' + p.err, 5000);
    },

    /** 端口连通一把 */
    async runTcp() {
      if (this._netBusy) return;
      const t = HP.Net.target();
      this._netBusy = '正在连 ' + t.host + ':' + t.port + '…';
      this._netPaint();
      const r = await HP.Net.tcp(t.host, t.port);
      this._tcp = r;
      this._tcpAt = Date.now();
      this._netBusy = '';
      this.renderNet(true);
      if (!r.ok) A().toast('端口不通：' + (r.err || '未知原因'), 5000);
    },

    /** 只重画"正在测"那一行状态，别把整页推倒重来（推倒会把行上的字抖一下） */
    _netPaint() {
      const el = document.getElementById('tab-net');
      if (!el) return;
      const statusRows = el.querySelectorAll('.card .sub');
      if (statusRows.length > 1) statusRows[statusRows.length - 1].textContent = '目标 ' + HP.Net.target().host + ' · ping ' +
        HP.Net.target().count + ' 次 · 端口 ' + HP.Net.target().port + (this._netBusy ? ' · ' + this._netBusy : '');
    },

    /** 改测试目标：三个可编辑字段（地址 / ping 次数 / 端口） */
    openNetTargetSheet() {
      const t = HP.Net.target();
      HP.UI.sheet({
        title: '测试目标',
        fields: [
          { key: 'host', label: '地址（域名或 IP）', value: t.host, editable: true },
          { key: 'count', label: 'ping 次数（1–20）', value: t.count, editable: true },
          { key: 'port', label: '端口（1–65535）', value: t.port, editable: true }
        ],
        actions: [
          {
            label: '保存', primary: true, fn: async (box, values) => {
              const saved = await HP.Net.saveTarget(values);
              box.remove();
              A().toast('已保存：' + saved.host + ' · ping ' + saved.count + ' 次 · 端口 ' + saved.port, 4200);
              this._ping = null; this._tcp = null;      // 换了目标，旧结果不算数
              this.renderNet(true);
            }
          },
          { label: '关闭' }
        ]
      });
    },

    /** 看这一把的原始输出（ping / 端口两段都在，带来源与耗时） */
    openNetRawSheet() {
      const t = HP.Net.target();
      const parts = [];
      if (this._ping) parts.push('$ ping -c ' + t.count + ' ' + t.host + '（这一把远端跑了 ' + (this._ping.tookMs == null ? '?' : this._ping.tookMs) + ' ms）\n' + (this._ping.text || '（没有输出）'));
      if (this._tcp) parts.push('$ 连接 ' + t.host + ':' + t.port + '\n' + (this._tcp.text || '（没有输出）'));
      HP.UI.sheet({
        title: '原始输出',
        fields: [{ label: '目标', value: t.host + ' · 端口 ' + t.port }],
        text: parts.join('\n\n') || '还没测过',
        actions: [
          { label: '重测 ping', fn: (box) => { box.remove(); this.runPing(); } },
          { label: '重测端口', fn: (box) => { box.remove(); this.runTcp(); } },
          { label: '关闭' }
        ]
      });
    },

    /**
     * 画**左侧隐藏栏**（栏目抽屉）。栏目全部由 `HP.Registry`（功能登记表）生成 ——
     * 这里只负责把它摆成「集合 ▸ 栏目」，**不许手写条目**（手写就又成了两套真身）。
     * 没做的栏目（status=planned）不摆出来，只在 `HP.Registry.check()` 里点名，避免"点不动的空块"。
     */
    renderDrawer() {
      const body = document.getElementById('dw-body');
      if (!body) return;
      body.textContent = '';
      HP.Registry.groups.forEach((g) => {
        const list = HP.Registry.boardsOf(g.id);
        if (!list.length) return;
        body.appendChild(HP.UI.el('div', 'dw-group', g.name));
        list.forEach((b) => body.appendChild(HP.UI.row({
          title: b.name, sub: b.sub, testid: 'board-' + b.id,
          onTap: () => HP.App.openBoard(b.id)
        })));
      });
    },

     /** 重绘三个页签。
     * 但**不要**在用户正在填表时把它们清掉 —— 之前 openPanel() 会无条件 renderAll()，
     * 表格里已经敲好的地址/用户名会被 innerHTML 替换掉，用户就得重打
     * （这正是「输入后过快刷新掉这一栏，要点击确定」那个现象的成因之一）。
     */
    renderAll() {
      const formOpen = (document.getElementById('host-form') || {}).innerHTML;
      const keyIoOpen = (document.getElementById('key-io') || {}).innerHTML;
      const ae = document.activeElement;
      const typingInSettings = ae && ae.closest && ae.closest('#tab-settings') &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);

      if (!formOpen) this.renderHosts();
      if (!keyIoOpen) this.renderKeys();
      if (!typingInSettings) this.renderSettings();
      this.renderHermes();      // 只有正停在这一页时才真的去读远端
      this.renderSessions();    // 同上：不在这一页就直接返回
      this.renderNet();         // 同上
    }
  };

  HP.Panels = Panels;
})();
