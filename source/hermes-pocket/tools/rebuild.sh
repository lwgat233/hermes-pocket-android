#!/bin/bash
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket || exit 1

echo "=== 1. 停模拟器腾内存 ==="
adb -s emulator-5554 emu kill 2>/dev/null
sleep 6
pkill -f qemu-system-x86_64-headless 2>/dev/null
sleep 4
pgrep -f qemu-system >/dev/null && echo "  模拟器仍在运行！" || echo "  模拟器已停"
free -m | head -2

echo "=== 2. 构建 ==="
gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build3.log 2>&1
GEXIT=$?
echo "  gradle 退出码 = $GEXIT"
if [ "$GEXIT" -ne 0 ]; then
  echo "  !! 构建失败，日志尾部："
  grep -E "error:|e: |FAILURE|What went wrong" /tmp/hpk-build3.log | head -20
  exit 1
fi
grep -E "BUILD SUCCESSFUL|warning:" /tmp/hpk-build3.log | tail -3
ls -l app/build/outputs/apk/debug/app-debug.apk

echo "=== 3. 重启模拟器 ==="
nohup $ANDROID_HOME/emulator/qemu/linux-x86_64/qemu-system-x86_64-headless \
  -avd test34 -no-window -no-audio -no-boot-anim -no-snapshot-save \
  -gpu swiftshader_indirect -memory 2048 -cores 4 -netdelay none -netspeed full \
  -port 5554 > /tmp/hpk-emu2.log 2>&1 &
adb wait-for-device
B=""
for i in $(seq 1 72); do
  B=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$B" = "1" ] && break
  sleep 5
done
echo "  boot_completed=$B"

echo "=== 4. 安装 ==="
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -3
echo "=== 5. 资源 ==="
free -m | head -2
echo "BUILD_DEPLOY_DONE"
