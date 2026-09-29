#!/bin/bash
# R49 第 2 步：等开机 → 装包 → 从设备读回（包名/版本/build-info/base.apk 哈希）
export PATH="/home/lwgat/tools/android-sdk/platform-tools:/home/lwgat/.local/bin:$PATH"
cd /vol1/1000/airesults/hermes-pocket || exit 1
APK=apk/测试版/hermes-pocket-R49-终端到底-20260929.apk
echo "== 等开机完成 =="
for i in $(seq 1 60); do
  bc=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  if [ "$bc" = "1" ]; then echo "  boot_completed=1（第 $i 轮，约 $((i*5)) 秒）"; break; fi
  sleep 5
done
adb shell getprop sys.boot_completed; adb shell getprop ro.build.version.release
echo "== 装包 =="
adb install -r "$APK" 2>&1 | tail -3
echo "== 设备侧读回：包名/版本 =="
adb shell "dumpsys package dev.hermes.pocket | grep -E 'versionName|versionCode|firstInstallTime|lastUpdateTime' | head -4"
echo "== 设备侧 base.apk 路径 + 哈希（run-as）=="
P=$(adb shell pm path dev.hermes.pocket 2>/dev/null | tr -d '\r' | sed 's/package://' | head -1)
echo "  path=$P"
adb exec-out run-as dev.hermes.pocket cat "$P" 2>/dev/null | sha256sum | sed 's/^/  sha256=/'
adb shell "stat -c '%n %s 字节' $P 2>/dev/null" | head -2
echo "== 设备侧 build-info.json =="
adb shell "run-as dev.hermes.pocket ls -l /data/data/dev.hermes.pocket/files/ 2>/dev/null" | head -8
for f in /data/data/dev.hermes.pocket/files/build-info.json /data/data/dev.hermes.pocket/files/ui/build-info.json; do
  echo "  -- $f"
  adb shell "run-as dev.hermes.pocket cat $f 2>/dev/null" | head -6
done
echo "== 设备侧 UI 资源哈希（ui/panels.js、ui/app.js）=="
for u in ui/panels.js ui/app.js ui/style.css; do
  echo -n "  $u = "
  adb exec-out run-as dev.hermes.pocket cat "/data/data/dev.hermes.pocket/files/$u" 2>/dev/null | sha256sum | cut -c1-24
done
echo "== 设备侧 App 私有 data/ 基线（红线用）=="
adb shell "run-as dev.hermes.pocket sh -c 'find /data/data/dev.hermes.pocket/files -type f | wc -l'" 2>/dev/null
