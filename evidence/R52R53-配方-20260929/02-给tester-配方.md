给 tester 的「聊天页怎么装数据」配方（R52R53#4 · 2026-09-29 · 作者：pipeline.author）
=========================================================================
先记住一条：**平台根不在界面里配**，它写死在 App 代码 —— `Bridge.kt:98`
  `private val talkRoot = "/vol1/1000/airesults/roles-chat"`
跑的每条命令都是**绝对路径**：`python3 '/vol1/1000/airesults/roles-chat/tools/talk.py' <子命令>`（经 **exec 通道**，不是那条 PTY）。
⇒ **与"会话的 cwd"无关**、也不靠 `startCmd`；**唯一的硬条件＝App 连的那台机器上真有这个目录、且能找到 python3**。
   · 本步已把命令前钉了 `PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`（改前在精简/临时 sshd 上可能直接 `python3: command not found`）。

一、钉住会话（`sel`）
1) 左侧「会话」栏目 → 点要用的那条（如 `r52t`）→ 弹窗点「切过去」。这一步就是把 `HP.Sessions.sel` 钉住。
2) 确认：`HP.Sessions.sel` 等于那条会话名；**并且**看启动返回/提示 —— 改后「多条会话 + 没钉住」时**不会自己连**，
   而是 `HP.Sessions.lastPick.action === 'need-pick'`、toast「…请在「会话」里点一条，我不替你挑」，同时会话栏目被打开。
3) 为什么必须钉：它决定终端里跑的是哪条 shell（tester 上一轮就是 App 自己 attach 到了 `hermes`，跟 `r52t` 不是一条）。

二、怎么看出"跑的是真平台"（三个读数，缺一不可）
1) `talk.since` 回的是 **JSON**（不是 `{raw,cmd}`）：`HP.Talk.rpcErr === ''`；失败时页面会出现**独立一行「取数失败：…」**（本步新增）+ toast「频道取数失败：…」。
2) **模型层拿到条数**：`HP.Talk.last` / `HP.Talk.msgs.length`。本机真平台现成读数：**`last = 927`、`msgs = 200`**（`talk.py since-json --id 0` 原样回包）。
3) **频道页那几路也得回**：`talk.roles`（形状 `{scenes:[{scene, roles:[…]}], channels:{}}`）、`talk.asks`、`talk.sessions`、以及"服务端就绪"那行。
   实测口径：`talk.roles` 回空 ⇒ 页面写「还没拉到角色」；服务端没就绪 ⇒ 写「服务端：还没搭建」**且不画气泡流**。

三、0 气泡的自查顺序（照这个顺序走，每步给该读的东西）
1) **会话钉住没**：`HP.Sessions.sel`、`HP.Sessions.lastPick`；终端里有没有发出 `tmux attach -t '<你钉的>'`（`HP.App.send` 打点或会话页 toast）。
2) **那台机器上平台在不在**：`ls -l /vol1/1000/airesults/roles-chat/tools/talk.py`、`command -v python3`（exec 通道非交互，PATH 很窄）。
3) **`talk.since` 报不报错**：页面「取数失败：…」那一行 / `HP.Talk.rpcErr` / toast ⇒ 有 = 命令失败，**不是"没有数据"**。
4) **四路都打一遍**：`talk.roles`、`talk.asks`、`talk.sessions`、`talk.doctor` ⇒ 看 `{scenes:…}` / `{asks:…}` / `{sessions:…}` / `{doctor:…}` 有没有回。
5) **页面状态行**：`#tk-serverline`（「服务端：还没搭建」= 未就绪）；角色卡片出没出；气泡选择器是 **`.tk-bub`**（在 `.tk-chat` 流里 ——
   **注意 `#tk-chat` 是错的写法，它是 class 不是 id**）。

四、我这边验到哪（如实）
- 会话显式化：改后读数齐 ✓（改前=tester 那条；改后=没发出任何 attach）。
- 装数据：**能证明数据到得了模型层**（真回包 ⇒ `msgs=200`）；**但本地测试台里画不出气泡**（要 `roles/asks/sessions/服务端就绪` 四路齐），
  **我复现不了你那个临时 sshd 装置** ⇒ 请按第三节顺序走，重点看第 2、3、4 步。
