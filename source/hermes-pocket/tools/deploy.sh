#!/usr/bin/env bash
# Hermes Pocket — 构建 + 部署 + 拉起 + 打开 CDP 通道
# 资源纪律：构建前过闸门；低堆 --no-daemon + kotlin in-process（单 JVM，峰值 ~500MB），
#           因为这台宿主只有 ~2GB 可用而模拟器独占 3.4GB 且无 cgroup 上限。
set -uo pipefail
ROOT=/home/lwgat/hermes-pocket
cd "$ROOT"
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH

SER=emulator-5554
A="adb -s $SER"
PKG=dev.hermes.pocket

tools/resguard.sh check "${1:-1100}" || exit 1

echo "— 构建"
BEFORE=$(stat -c %Y "$ROOT/app/build/outputs/apk/debug/app-debug.apk" 2>/dev/null || echo 0)
gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug 2>&1 \
  | grep -E "^e:|^w: file:///.*(Ssh|Bridge|Vault|Store|MainActivity|SessionService)\.kt|BUILD|FAILED|What went wrong|> " | head -25
GEXIT=${PIPESTATUS[0]}
APK=$ROOT/app/build/outputs/apk/debug/app-debug.apk
AFTER=$(stat -c %Y "$APK" 2>/dev/null || echo 0)

# 门槛只认 gradle 的退出码。之前踩过的坑是：依赖加错、构建其实在失败，而脚本
# 只看「APK 文件存在」就照装旧包，白跑三轮测试。退出码能准确抓住那种情况。
# 注意 **不要**要求产物时间戳必须更新 —— 构建 UP-TO-DATE 时产物本来就不变，那是正常状态。
if [ "$GEXIT" -ne 0 ]; then echo "!! gradle 退出码 $GEXIT，构建失败，终止部署"; exit 1; fi
if [ ! -f "$APK" ]; then echo "!! 没有产物"; exit 1; fi
if [ "$AFTER" -le "$BEFORE" ]; then
  echo "  （构建 UP-TO-DATE，产物未变 $(stat -c '%y' "$APK" | cut -c1-19) —— 正常）"
else
  echo "  产物已更新 $(stat -c '%s 字节  %y' "$APK" | cut -c1-40)"
fi

echo "— 安装"
$A install -r "$APK" 2>&1 | tail -1

echo "— 清空应用数据（每次都是全新首启：Keystore 重建、已知主机清空、TOFU 重新弹）"
$A shell pm clear $PKG 2>&1 | tail -1

echo "— 拉起"
$A shell am force-stop $PKG
$A logcat -c
$A shell am start -n $PKG/.MainActivity >/dev/null 2>&1
sleep 7

PID=$($A shell pidof $PKG | tr -d '\r')
[ -n "$PID" ] || { echo "!! 进程没起来"; $A logcat -d | grep -iE "AndroidRuntime|FATAL" | tail -20; exit 1; }
$A forward --remove-all >/dev/null 2>&1
$A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null
printf '  进程 pid=%s  CDP=http://127.0.0.1:9222\n' "$PID"
tools/resguard.sh show
