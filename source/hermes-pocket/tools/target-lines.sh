#!/usr/bin/env bash
# 终端页"靶子"（R-49 第 3 步）：往终端里打出**超过一屏**的内容，用来量"到不到底 / 封底跟随 / 上翻不被拽回"。
#
# 用法（在宿主上跑；不要放进 App 的 startCmd 里 —— 见派活说明，App 有 tmux 就只 attach、不执行 startCmd）：
#   bash tools/target-lines.sh                 # 打 300 行就停（内容超一屏，量"一进/一点是否到底"）
#   bash tools/target-lines.sh 300 5 240       # 300 行之后每 5 秒再打 1 行、共 240 次（量"封底跟随"与"上翻不被拽回"）
#
# 目标行格式固定带「终端靶子-序号 时间戳」，页面上一眼能认出"跑的是靶子、不是 App 自带的 TUI"。
set -u
n="${1:-300}"        # 一次打多少行
every="${2:-0}"      # 之后每隔几秒追加一行（0 = 不追加）
times="${3:-0}"      # 追加多少次
i=1
while [ "$i" -le "$n" ]; do
  printf '终端靶子-%03d %s 行号=%d\n' "$i" "$(date +%H:%M:%S)" "$i"
  i=$((i + 1))
done
if [ "$every" -gt 0 ] && [ "$times" -gt 0 ]; then
  k=1
  while [ "$k" -le "$times" ]; do
    sleep "$every"
    printf '终端靶子-追加%03d %s\n' "$k" "$(date +%H:%M:%S)"
    k=$((k + 1))
  done
fi
printf '终端靶子-结束 %s（首发 %d 行）\n' "$(date +%H:%M:%S)" "$n"
