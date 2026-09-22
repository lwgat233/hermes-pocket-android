/* Hermes Pocket — 功能登记表（唯一的"有哪些功能"权威源）
 * ===========================================================================
 * 规矩（来自 `docs/界面渲染规范.md` §5）：
 *   ① 先**扁平登记**：一个功能一行 —— id / 名称 / 归类集合 / 载体 / 入口 / 稳定标识 / 状态 / 对应测试；
 *   ② 再归类：5~7 个集合，**一个功能只属于一个集合**，跨集合只放跳转入口，不复制控件；
 *   ③ 抽屉与板块**由这张表生成**，不手写栏目；
 *   ④ 定期跑 `HP.Registry.check()`：报「没归属 / 没挂上 / 没测」—— 这三类就是"开发不足"的清单。
 *
 * 状态：ready = 界面上能用；planned = 已登记、还没做（抽屉里**不显示**，只在自检里点名）。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  const GROUPS = [
    { id: 'conn', name: '连接' },
    { id: 'hermes', name: 'Hermes' },
    { id: 'roles', name: '角色' },
    { id: 'diag', name: '诊断' }
  ];

  const BOARDS = [
    { id: 'hosts', group: 'conn', name: '主机', sub: '地址 / 用户 / 启动命令', tab: 'hosts', status: 'ready', test: 't-drawer.mjs' },
    { id: 'keys', group: 'conn', name: '密钥', sub: '生成 / 导入 / 装到服务器', tab: 'keys', status: 'ready', test: 't-drawer.mjs' },
    { id: 'settings', group: 'conn', name: '设置', sub: '字号 / 回滚 / 省电 / 通知', tab: 'settings', status: 'ready', test: 't-settings.mjs' },
    { id: 'hermes', group: 'hermes', name: '技能与记忆', sub: '远端 SKILL.md / USER.md / MEMORY.md', tab: 'hermes', status: 'ready', test: 't-drawer.mjs' },
    { id: 'sessions', group: 'conn', name: '会话', sub: '远端 tmux 会话 · 点一下就切过去（永不终止）', tab: 'sessions', status: 'ready', test: 't-sessions.mjs' },

    /* ---- 多角色频道（roles-chat 那套的角色/对话） ---- */
    { id: 'talk', group: 'roles', name: '频道', sub: '角色与对话 · 点谁就是跟谁说话', tab: 'talk', status: 'ready', test: 'docs/频道面板验收.txt（人工清单）' },

    /* ---- 已登记、还没做（M4）：抽屉里不出现，自检里点名 ---- */
    { id: 'net', group: 'diag', name: '网络与流量', sub: '连通性 / 丢包 / 上下行', tab: 'net', status: 'ready', test: 't-net.mjs' },

    /* ---- 已经做完、但**不单独占栏目**的功能（长在别的栏目里的一行）----
     * kind:'row' + host(宿主栏目) + sel(宿主栏目里必须存在的选择器)：
     * 自检照样点名，只是判据从"有没有 #tab-x"换成"宿主栏目里有没有那一行"。 */
    { id: 'prompt', group: 'hermes', name: '系统提示词', sub: '只看，不改', kind: 'row', host: 'hermes', sel: '[data-testid="remote-prompt"]', status: 'ready', test: 't-prompt.mjs' },
    { id: 'model', group: 'hermes', name: '模型', sub: '看 / 改远端模型', kind: 'row', host: 'hermes', sel: '[data-testid="remote-model"]', status: 'ready', test: 't-model.mjs' },
    { id: 'skills-dl', group: 'hermes', name: '技能详情', sub: '下载到手机 / 改完回存', kind: 'row', host: 'hermes', sel: '[data-skill]', status: 'ready', test: 't-skill.mjs' },
    { id: 'traffic', group: 'diag', name: '流量统计', sub: '历史上下行 · 柱/饼（点顶栏 ↓）', kind: 'row', sel: '#tb-traffic', status: 'ready', test: 't-traffic.mjs' },
    { id: 'status', group: 'diag', name: '运行状态', sub: '运行中 / 压缩中 / 已结束', kind: 'row', sel: '[data-testid="chat-state"]', status: 'ready', test: 't-chatstate.mjs' }
  ];

  const Registry = {
    groups: GROUPS,
    boards: BOARDS,
    /** 哪些栏目**已经渲染过**。自检的判据全是"读 DOM"，而栏目是点开才渲染的 ——
     *  没渲染过就报"没挂上"是**假红**（实测：没连接时开抽屉会报系统提示词/模型/技能详情三条），
     *  所以"还没渲染"与"渲染了但缺行"必须分开报。 */
    rendered: new Set(),
    markRendered(id) { if (id) Registry.rendered.add(id); },

    /** 某个集合里**界面上能用**的栏目（抽屉就用它生成）。
     *  只收真栏目（有 tab 的）：`kind:'row'` 那些是长在别的栏目里的一行，摆进抽屉会变成"点不动的空块"。 */
    boardsOf(groupId) {
      return BOARDS.filter((b) => b.group === groupId && b.status === 'ready' && !b.kind && b.tab);
    },

    /** 一个栏目（按 id） */
    get(id) { return BOARDS.find((b) => b.id === id) || null; },

    /**
     * 覆盖自检。判据是**读回来的事实**：DOM 里有没有对应的 `#tab-<id>`、登记项有没有测试驱动。
     * 返回的每一项都是"开发不足"的名单，不许空着不报。
     */
    check(doc) {
      const d = doc || document;
      const ready = BOARDS.filter((b) => b.status === 'ready');
      const boardItems = ready.filter((b) => b.kind !== 'row');
      const rowItems = ready.filter((b) => b.kind === 'row');
      const notRenderedList = [];
      /** 宿主栏目里那一行在不在（判据是 DOM 里真的查得到，不是"我写了就算"） */
      const rowMounted = (b) => {
        // 没写 host 的（比如顶栏上的运行状态）直接在整篇文档里找
        if (!b.host) return !!(b.sel && d.querySelector(b.sel));
        const host = BOARDS.find((x) => x.id === b.host);
        if (!host || !host.tab) return false;
        const tabEl = d.getElementById('tab-' + host.tab);
        if (!tabEl) return false;
        // 宿主栏目**还没渲染过** ⇒ 这一行查不到是正常的，记进 "notRendered"，不算缺
        if (host.kind !== 'row' && !Registry.rendered.has(host.id)) { notRenderedList.push(b.id + '(row)'); return true; }
        return !!(tabEl.querySelector(b.sel || '[data-testid]'));
      };
      return {
        total: BOARDS.length,
        readyCount: ready.length,
        notRendered: notRenderedList,
        ungrouped: BOARDS.filter((b) => !GROUPS.some((g) => g.id === b.group)).map((b) => b.id),
        emptyGroups: GROUPS.filter((g) => !BOARDS.some((b) => b.group === g.id)).map((g) => g.id),
        uiEmptyGroups: GROUPS.filter((g) => !Registry.boardsOf(g.id).length).map((g) => g.id),
        notMounted: boardItems.filter((b) => !b.tab || !d.getElementById('tab-' + b.tab)).map((b) => b.id)
          .concat(rowItems.filter((b) => !rowMounted(b)).map((b) => b.id + '(row)')),
        untested: ready.filter((b) => !b.test).map((b) => b.id),
        notDone: BOARDS.filter((b) => b.status !== 'ready').map((b) => b.id)
      };
    }
  };

  HP.Registry = Registry;
})();
