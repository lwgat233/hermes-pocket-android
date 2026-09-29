给 tester 的「照抄即可」清单（R-49 第 3 步 · 2026-09-29）
=========================================================================
前置：宿主（NAS）上执行；App 已连着这台宿主。

1) 【宿主】挂靶子会话（幂等；只动 hptarget 这个名字）
   tmux kill-session -t hptarget 2>/dev/null; tmux new-session -d -s hptarget "bash __SCRIPT__ 300 5 240; exec bash"
   ▸ 读数该看：`tmux ls` 里出现 `hptarget`；`tmux capture-pane -p -t hptarget -S - | grep -c "终端靶子-"` = 300

2) 【App】打开左侧「会话」板块 ⇒ 点 **hptarget** 那一行 ⇒ 弹窗点 **「切过去」**
   ▸ 读数该看：终端里出现 `终端靶子-001`；顶栏 badge **不再**是 `TUI·鼠标`
   ▸ 若没看到：在 App 里再点一次「会话」板块刷新，确认列表里有 hptarget（`ui/panels.js:771-810`）

3) 【App/CDP】量滚动容器（DevTools console 或 CDP 里执行）
   `var v=document.querySelector('.xterm-viewport'); ({scrollHeight:v.scrollHeight, clientHeight:v.clientHeight, scrollTop:v.scrollTop, 离底:v.scrollHeight-v.clientHeight-v.scrollTop})`
   ▸ 该看到：**scrollHeight > clientHeight**（例：6367 / 643）；`离底 0`（进入即贴底）
   ▸ 若 scrollHeight == clientHeight：说明内容还是没超一屏 ⇒ 回第 1 步（或等靶子多打几行）

4) 【判"点一下到不到底"】先手动往上翻一段（手指拖或 `v.scrollTop = v.scrollTop - 400`），确认 `离底 ≈ 400`；
   再**点一下终端** ⇒ 下一帧/1 秒后再读 ⇒ 期望 **`离底 0`**

5) 【判"封底跟随"】保持贴底（`离底 0`），等靶子每 5 秒追加的那一行到达 ⇒ 期望**仍然 `离底 0`**、`scrollHeight` 变大了

6) 【判"上翻不被拽回"】再往上翻（`离底 > 0`），等 2~3 行新输出到达 ⇒ 期望 **`scrollTop` 基本不变（±2px）**、`离底` 只因为内容变多而增大
   ▸ 全程另记：控制台/页面 **报错 0 条**；`终端靶子-` 字样一直在（证明还是靶子）
