#!/usr/bin/env bash
# 一键出包：bash tools/build.sh --name "这包叫什么" --feature "这包做了什么" --feature-id "F1" [--note "…"]
#
# 出包顺序（版本串不会再有手写的机会）：
#   ① 盖章：自动写入这一包的版本串 + 打包时间（tools/stamp-build.py）→ 盖进 ui/app.js
#   ② 核对：源里盖的与 build-info.json 一致
#   ③ gradle assembleDebug（只用本机工具链，不联网下载）
#   ④ 对账：解开包，把包内 build-info.json / ui/app.js 的 HP.BUILD / ui 下每个文件与源树比哈希
#   ⑤ 归档：拷到 apk/测试版/hermes-pocket-<名字>-<日期>.apk，打印 sha256
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-$HOME/tools/jdk-17.0.2}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/tools/android-sdk}"
unset ANDROID_SDK_ROOT
GRADLE="${GRADLE_BIN:-$HOME/tools/gradle-8.7/bin/gradle}"
[ -x "$GRADLE" ] || GRADLE="$(command -v gradle)" || { echo "找不到 gradle（设 GRADLE_BIN=...）"; exit 1; }

NAME=""
PASSTHRU=()
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    *) PASSTHRU+=("$1"); shift ;;
  esac
done
SRC="$HERE/source/hermes-pocket"
cd "$SRC"

echo "=== ① 盖章（版本串 + 打包时间，按出包时刻自动写）==="
python3 tools/stamp-build.py "${PASSTHRU[@]}"

echo
echo "=== ② 核对源里盖的和 JSON 一致 ==="
python3 tools/stamp-build.py --check

echo
echo "=== ③ gradle assembleDebug ==="
"$GRADLE" assembleDebug --no-daemon -Pkotlin.compiler.execution.strategy=in-process
APK="$SRC/app/build/outputs/apk/debug/app-debug.apk"

echo
echo "=== ④ 包内 ↔ 源树 对账 ==="
python3 tools/stamp-build.py --verify "$APK"

if [ -n "$NAME" ]; then
  DEST_DIR="$HERE/apk/测试版"
  mkdir -p "$DEST_DIR"
  DEST="$DEST_DIR/hermes-pocket-$NAME-$(date +%Y%m%d).apk"
  cp "$APK" "$DEST"
  echo
  echo "=== ⑤ 归档 ==="
  echo "客户端好了：$DEST"
else
  echo
  echo "客户端好了：$APK"
fi
sha256sum "${DEST:-$APK}"
