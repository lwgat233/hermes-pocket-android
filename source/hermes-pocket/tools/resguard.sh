#!/usr/bin/env bash
# Hermes Pocket — 资源闸门
# 目的：这台机器内存本来就紧（可用 ~2GB，模拟器单体 3GB 且无 cgroup 上限，
#        swap 已用 1GB+），重活（gradle 构建 / 模拟器）必须串行且带闸门，
#        否则会撞上内核 OOM killer —— 那会杀掉 qemu 或 hermes 本身。
# 用法:
#   resguard.sh show            看快照
#   resguard.sh check 700       可用内存低于 700MB 就退出码 1（供脚本前置判断）
#   resguard.sh watch 15 <file> 后台每 15s 采一次样，追加到 CSV（用于事后出资源曲线）
set -uo pipefail

avail_mb() { awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo; }
swap_mb()  { awk '/SwapFree/{printf "%d", $2/1024}' /proc/meminfo; }
used_mb()  { awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf "%d",(t-a)/1024}' /proc/meminfo; }

show() {
  local a s u l
  a=$(avail_mb); s=$(swap_mb); u=$(used_mb); l=$(cut -d' ' -f1 /proc/loadavg)
  printf '  可用=%-5sMB  已用=%-5sMB  swap剩余=%-5sMB  负载=%s\n' "$a" "$u" "$s" "$l"
  printf '  内存前 3:\n'
  ps -eo rss,comm --sort=-rss | awk 'NR>1 && $1>50000 {printf "    %7.0f MB  %s\n", $1/1024, $2}' | head -3
  local qemu
  qemu=$(pgrep -c qemu-system-x86 2>/dev/null || echo 0)
  printf '  模拟器进程数=%s\n' "$qemu"
}

case "${1:-show}" in
  show) show ;;
  check)
    min=${2:-700}; a=$(avail_mb)
    if [ "$a" -lt "$min" ]; then
      echo "  资源闸门：可用 ${a}MB < ${min}MB 阈值 —— 拒绝执行重活" >&2
      show >&2
      exit 1
    fi
    echo "  资源闸门通过：可用 ${a}MB ≥ ${min}MB"
    ;;
  watch)
    iv=${2:-15}; out=${3:-/tmp/hpk-res.csv}
    [ -f "$out" ] || echo "ts,avail_mb,used_mb,swap_free_mb,load1,qemu_rss_mb,hermes_rss_mb" > "$out"
    while true; do
      q=$(ps -eo rss,comm --sort=-rss | awk '/qemu-system/{printf "%d",$1/1024; exit}')
      h=$(ps -eo rss,comm --sort=-rss | awk '/hermes/{s+=$1} END{printf "%d",s/1024}')
      echo "$(date +%H:%M:%S),$(avail_mb),$(used_mb),$(swap_mb),$(cut -d' ' -f1 /proc/loadavg),${q:-0},${h:-0}" >> "$out"
      sleep "$iv"
    done ;;
  *) echo "用法: $0 show|check <minMB>|watch <间隔秒> <csv路径>" >&2; exit 2 ;;
esac
