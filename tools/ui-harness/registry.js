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
    { id: 'diag', name: '诊断' }
  ];

  const BOARDS = [
    { id: 'hosts', group: 'conn', name: '主机', sub: '地址 / 用户 / 启动命令', tab: 'hosts', status: 'ready', test: 't-drawer.mjs' },
    { id: 'keys', group: 'conn', name: '密钥', sub: '生成 / 导入 / 装到服务器', tab: 'keys', status: 'ready', test: 't-drawer.mjs' },
    { id: 'settings', group: 'conn', name: '设置', sub: '字号 / 回滚 / 省电 / 通知', tab: 'settings', status: 'ready', test: 't-settings.mjs' },
    { id: 'hermes', group: 'hermes', name: '技能与记忆', sub: '远端 SKILL.md / USER.md / MEMORY.md', tab: 'hermes', status: 'ready', test: 't-drawer.mjs' },

    /* ---- 已登记、还没做（M2/M3/M4）：抽屉里不出现，自检里点名 ---- */
    { id: 'sessions', group: 'conn', name: '会话', sub: 'tmux 会话与在线状态（永不终止）', tab: null, status: 'planned', test: '' },
    { id: 'model', group: 'hermes', name: '模型', sub: '看 / 改远端模型', tab: null, status: 'planned', test: '' },
    { id: 'prompt', group: 'hermes', name: '系统提示词', sub: '只看，不改', tab: null, status: 'planned', test: '' },
    { id: 'skills-dl', group: 'hermes', name: '技能下载', sub: '下载到手机 / 改完回存', tab: null, status: 'planned', test: '' },
    { id: 'net', group: 'diag', name: '网络与流量', sub: '连通性 / 丢包 / 上下行', tab: null, status: 'planned', test: '' },
    { id: 'status', group: 'diag', name: '运行状态', sub: '运行中 / 压缩中 / 已结束', tab: null, status: 'planned', test: '' }
  ];

  const Registry = {
    groups: GROUPS,
    boards: BOARDS,

    /** 某个集合里**界面上能用**的栏目（抽屉就用它生成） */
    boardsOf(groupId) {
      return BOARDS.filter((b) => b.group === groupId && b.status === 'ready');
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
      return {
        总数: BOARDS.length,
        已做: ready.length,
        没归属: BOARDS.filter((b) => !GROUPS.some((g) => g.id === b.group)).map((b) => b.id),
        空集合: GROUPS.filter((g) => !BOARDS.some((b) => b.group === g.id)).map((g) => g.id),
        界面空集合: GROUPS.filter((g) => !Registry.boardsOf(g.id).length).map((g) => g.id),
        没挂上: ready.filter((b) => !b.tab || !d.getElementById('tab-' + b.tab)).map((b) => b.id),
        没测: ready.filter((b) => !b.test).map((b) => b.id),
        未做: BOARDS.filter((b) => b.status !== 'ready').map((b) => b.id)
      };
    }
  };

  HP.Registry = Registry;
})();
