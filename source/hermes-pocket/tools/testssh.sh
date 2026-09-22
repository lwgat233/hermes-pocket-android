#!/usr/bin/env bash
# Hermes Pocket — 本地测试用 SSH 服务端
#   * 独立 sshd 实例（127.0.0.1:2222），自己的 host key 和 authorized_keys
#   * 以当前用户身份运行，不动 ~/.ssh，不需要 root
#   * 真 PTY —— TUI / tmux / Hermes 的窗口尺寸和备用屏行为都是真的
# 用法: testssh.sh start | stop | status | info
set -uo pipefail

D=${HPK_SSHD_DIR:-/tmp/hpk-sshd}
PORT=${HPK_SSHD_PORT:-2222}
CONF=$D/sshd_config
PID=$D/sshd.pid

gen() {
  mkdir -p "$D"; chmod 700 "$D"
  [ -f "$D/host_ed25519" ]   || ssh-keygen -q -t ed25519 -f "$D/host_ed25519" -N '' -C hpk-testhost
  [ -f "$D/client_ed25519" ] || ssh-keygen -q -t ed25519 -f "$D/client_ed25519" -N '' -C hpk-testclient
  cp "$D/client_ed25519.pub" "$D/authorized_keys"; chmod 600 "$D/authorized_keys"
  cat > "$CONF" <<EOF
Port $PORT
ListenAddress 127.0.0.1
HostKey $D/host_ed25519
PidFile $PID
AuthorizedKeysFile $D/authorized_keys
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PermitRootLogin no
AllowUsers $(id -un)
LogLevel VERBOSE
PrintMotd no
EOF
}

alive() { [ -f "$PID" ] && kill -0 "$(cat "$PID" 2>/dev/null)" 2>/dev/null; }

case "${1:-start}" in
  start)
    gen
    if alive; then echo "已在运行 (pid $(cat "$PID")) port $PORT"; exit 0; fi
    /usr/sbin/sshd -f "$CONF" -E "$D/sshd.log"
    sleep 0.6
    if ss -ltn | grep -q ":$PORT "; then
      echo "testsshd 已启动: 127.0.0.1:$PORT  用户=$(id -un)"
      echo "  客户端私钥: $D/client_ed25519"
    else
      echo "启动失败："; tail -5 "$D/sshd.log"; exit 1
    fi
    ;;
  stop)
    if alive; then kill "$(cat "$PID")" && echo "已停止"; else echo "未在运行"; fi
    rm -f "$PID"
    ;;
  status)
    alive && echo "running pid=$(cat "$PID") port=$PORT" || echo "stopped"
    ;;
  info)
    gen
    printf '{"dir":"%s","port":%s,"clientKey":"%s","user":"%s"}\n' "$D" "$PORT" "$D/client_ed25519" "$(id -un)"
    ;;
  *) echo "用法: $0 start|stop|status|info"; exit 2 ;;
esac
