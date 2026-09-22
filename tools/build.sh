#!/usr/bin/env bash
# 一键构建客户端 APK：bash tools/build.sh
# 只用本机工具链（不联网下载）：JAVA_HOME / ANDROID_HOME / gradle 可用环境变量覆盖
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-17.0.2}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/tools/android-sdk}"
unset ANDROID_SDK_ROOT
GRADLE="${GRADLE_BIN:-$HOME/tools/gradle-8.7/bin/gradle}"
[ -x "$GRADLE" ] || GRADLE="$(command -v gradle)" || { echo "找不到 gradle（设 GRADLE_BIN=...）"; exit 1; }
cd "$HERE/source/hermes-pocket"
"$GRADLE" assembleDebug --no-daemon -Pkotlin.compiler.execution.strategy=in-process
APK="$HERE/source/hermes-pocket/app/build/outputs/apk/debug/app-debug.apk"
echo; echo "客户端好了：$APK"; sha256sum "$APK"
