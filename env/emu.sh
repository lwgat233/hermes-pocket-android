#!/usr/bin/env bash
# 在 Docker 里跑无头 Android 模拟器（用 docker 组权限拿到 /dev/kvm，无需宿主机 sudo）
#
#   tools/emu.sh build        构建模拟器镜像（已存在则跳过，不会重复下载/构建）
#   tools/emu.sh build --force  强制重建镜像
#   tools/emu.sh create       创建 AVD（首次）
#   tools/emu.sh start        启动模拟器并等待开机完成
#   tools/emu.sh stop         停止（只删容器，镜像/AVD/SDK 全部保留，下次秒起）
#   tools/emu.sh status       状态 + 磁盘占用
#   tools/emu.sh clean        清理临时文件与容器（保留镜像/AVD/SDK）
#   tools/emu.sh clean --all  彻底清理（含镜像与 AVD，谨慎）
#
# 设计原则：SDK / 镜像 / AVD 都是“下载一次、长期复用”的资产，
# 只重建缺失的东西，绝不为了“干净”而删掉它们；临时文件用 mktemp 并在退出时删除。
set -uo pipefail

SDK="${ANDROID_HOME:-$HOME/tools/android-sdk}"
JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-17.0.2}"
AVD="${AVD:-test34}"
IMG="${IMG:-system-images;android-34;google_apis;x86_64}"
IMAGE="notifbridge-emu:34"
BASE_LOCAL="emu-base:12"
BASE_REMOTE="docker.m.daocloud.io/library/debian:12"
CONTAINER="notifbridge-emu"
PORT_CONSOLE=5554
TMP_EXTRA=("/tmp/emu.Dockerfile")   # 历史版本留下的残留文件，一并清掉

export PATH="$JAVA_HOME/bin:$SDK/platform-tools:$SDK/cmdline-tools/latest/bin:$PATH"

have_image() { docker image inspect "$1" >/dev/null 2>&1; }
have_volume() { docker volume inspect "$1" >/dev/null 2>&1; }

case "${1:-status}" in
  build)
    FORCE=0
    [ "${2:-}" = "--force" ] && FORCE=1
    if [ "$FORCE" = "0" ] && have_image "$IMAGE"; then
      echo "镜像 $IMAGE 已存在 → 跳过构建（要重建：tools/emu.sh build --force）"
      exit 0
    fi
    # 基础镜像：只在本地没有时才联网拉取，拉完打成本地 tag 供 Dockerfile 复用
    if ! have_image "$BASE_LOCAL"; then
      echo "本地缺少基础镜像，拉取 $BASE_REMOTE（国内直连 docker hub 通常不通，所以走镜像站）…"
      docker pull "$BASE_REMOTE" || exit 1
      docker tag "$BASE_REMOTE" "$BASE_LOCAL"
    fi
    # Dockerfile 写在临时目录里，退出时自动删除（不在磁盘上留残留）
    BUILD_DIR="$(mktemp -d)"
    trap 'rm -rf "$BUILD_DIR"' EXIT
    cat > "$BUILD_DIR/Dockerfile" <<EOF
FROM $BASE_LOCAL
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \\
      libnss3 libx11-6 libx11-xcb1 libxcb1 libxcb-glx0 libxcb-xfixes0 libxcb-shm0 \\
      libgl1 libglu1-mesa libgbm1 libdrm2 libpulse0 libasound2 libxdamage1 \\
      libxcomposite1 libxrandr2 libxcursor1 libxi6 libxtst6 libxkbcommon0 \\
      libstdc++6 libxml2 zlib1g ca-certificates curl procps \\
    && rm -rf /var/lib/apt/lists/*
EOF
    docker build -f "$BUILD_DIR/Dockerfile" -t "$IMAGE" "$BUILD_DIR" || exit 1
    echo "镜像 $IMAGE 构建完成（会一直保留，下次直接用）"
    ;;
  create)
    [ -d "$SDK/system-images/android-34" ] || { echo "system image 未安装，先跑 sdkmanager"; exit 1; }
    [ -d "$HOME/.android/avd/$AVD.avd" ] && { echo "AVD $AVD 已存在 → 跳过创建"; exit 0; }
    yes "no" | avdmanager create avd -n "$AVD" -k "$IMG" --device "pixel_5" --force
    ;;
  start)
    have_image "$IMAGE" || { echo "镜像不存在，先跑 tools/emu.sh build"; exit 1; }
    docker rm -f "$CONTAINER" >/dev/null 2>&1   # 只删容器，镜像与 AVD 保留
    # 关键：容器被强杀时 emulator 来不及清理 AVD 锁文件，
    # 留着会让下次启动报 “Running multiple emulators with the same AVD”
    rm -f "$HOME/.android/avd/$AVD.avd"/*.lock 2>/dev/null
    rm -rf "$HOME/.android/avd/$AVD.avd"/*.lock.d 2>/dev/null
    docker run -d --name "$CONTAINER" \
      --device /dev/kvm \
      --network host \
      -e ANDROID_SDK_ROOT="$SDK" \
      -e ANDROID_AVD_HOME="$HOME/.android/avd" \
      -e ANDROID_HOME="$SDK" \
      -v "$SDK:$SDK" \
      -v "$HOME/.android:$HOME/.android" \
      "$IMAGE" \
      "$SDK/emulator/emulator" -avd "$AVD" \
        -no-window -no-audio -no-boot-anim -no-snapshot-save \
        -gpu swiftshader_indirect -memory 2048 -cores 4 \
        -netdelay none -netspeed full -port "$PORT_CONSOLE"
    echo "容器已启动，等待 adb…"
    adb start-server >/dev/null 2>&1
    die_if_exited() {
      if ! docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -q "$CONTAINER"; then
        echo
        echo "模拟器已退出，容器日志尾部："
        docker logs --tail 15 "$CONTAINER" 2>&1 | sed 's/^/  /'
        exit 1
      fi
    }
    for i in $(seq 1 90); do
      adb devices | grep -q "emulator-$PORT_CONSOLE" && break
      die_if_exited
      sleep 2
    done
    adb -s "emulator-$PORT_CONSOLE" wait-for-device
    echo -n "等待开机完成"
    for i in $(seq 1 120); do
      b=$(adb -s "emulator-$PORT_CONSOLE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
      [ "$b" = "1" ] && { echo " OK"; break; }
      echo -n "."
      die_if_exited
      sleep 3
    done
    adb -s "emulator-$PORT_CONSOLE" shell settings put global window_animation_scale 0 >/dev/null 2>&1
    adb -s "emulator-$PORT_CONSOLE" shell input keyevent 82 >/dev/null 2>&1
    adb devices
    ;;
  stop)
    docker rm -f "$CONTAINER" >/dev/null 2>&1
    echo "已停止（镜像 / AVD / SDK 保留，下次 tools/emu.sh start 秒起）"
    ;;
  clean)
    if [ "${2:-}" = "--all" ]; then
      echo "彻底清理：容器 + 镜像 + AVD（下次需要重新下载，会慢很多）"
      docker rm -f "$CONTAINER" >/dev/null 2>&1
      docker rmi "$IMAGE" "$BASE_LOCAL" "$BASE_REMOTE" >/dev/null 2>&1
      rm -rf "$HOME/.android/avd/$AVD.avd" "$HOME/.android/avd/$AVD.ini"
    else
      docker rm -f "$CONTAINER" >/dev/null 2>&1
      rm -rf "$HOME/.android/avd/$AVD.avd"/*.lock 2>/dev/null
      for f in "${TMP_EXTRA[@]}"; do rm -f "$f"; done
      echo "已清理容器与临时文件（镜像 / AVD / SDK 保留）"
    fi
    ;;
  status)
    echo "容器："; docker ps -a --filter "name=$CONTAINER" --format '  {{.Names}}  {{.Status}}'
    echo "镜像："; docker images --format '  {{.Repository}}:{{.Tag}}  {{.Size}}' | grep -E "notifbridge-emu|emu-base|debian" || true
    echo "设备："; adb devices | tail -n +2 | sed 's/^/  /'
    echo "占用："
    du -sh "$SDK" 2>/dev/null | sed 's/^/  SDK   /'
    du -sh "$HOME/.android/avd" 2>/dev/null | sed 's/^/  AVD   /'
    docker system df --format '  Docker {{.Type}}  {{.Size}}' 2>/dev/null | head -2
    ;;
esac
