#!/bin/bash
# 按功能键时软键盘不应被收起
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"
OUT=/vol1/1000/airesults

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build22.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build22.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build22.log | head -20; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
# 让模拟器真的弹出软键盘（默认接硬件键盘时它不弹）
$A shell settings put secure show_ime_with_hard_keyboard 1
$A shell am force-stop dev.hermes.pocket; sleep 1
$A shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 8
PID=$($A shell pidof dev.hermes.pocket | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

{
echo "### 按功能键时不收软键盘  $(date '+%F %T %Z')"
echo
echo "=== 连接 ==="
node tools/cdp.mjs --expr "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} HP.App.send('clear\\r'); await new Promise(r=>setTimeout(r,1500)); return JSON.stringify({状态:HP.App.state}); })()" --timeout 90000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo
echo "=== 坐标（Esc 键 / 顶栏对照按钮）==="
XY=$(node tools/cdp.mjs --script /tmp/hpk-coords.json --timeout 60000 2>&1 | grep '"value"' | tail -1)
echo "  $XY"
EX=$(echo "$XY" | python3 -c "import sys,json,re;s=sys.stdin.read();m=re.search(r'\"value\":\s*(\".*?\")$',s.strip());d=json.loads(json.loads(m.group(1))) if m else {};print((d.get('Esc坐标') or {}).get('x',''))" 2>/dev/null)
EY=$(echo "$XY" | python3 -c "import sys,json,re;s=sys.stdin.read();m=re.search(r'\"value\":\s*(\".*?\")$',s.strip());d=json.loads(json.loads(m.group(1))) if m else {};print((d.get('Esc坐标') or {}).get('y',''))" 2>/dev/null)
TX=$(echo "$XY" | python3 -c "import sys,json,re;s=sys.stdin.read();m=re.search(r'\"value\":\s*(\".*?\")$',s.strip());d=json.loads(json.loads(m.group(1))) if m else {};print((d.get('顶栏对照按钮') or {}).get('x',''))" 2>/dev/null)
TY=$(echo "$XY" | python3 -c "import sys,json,re;s=sys.stdin.read();m=re.search(r'\"value\":\s*(\".*?\")$',s.strip());d=json.loads(json.loads(m.group(1))) if m else {};print((d.get('顶栏对照按钮') or {}).get('y',''))" 2>/dev/null)
if [ -z "$EX" ]; then echo "  ！拿不到 Esc 坐标，用默认值"; EX=28; EY=752; fi
if [ -z "$TX" ]; then TX=196; TY=20; fi
echo "  Esc=(x=$EX y=$EY)  顶栏=(x=$TX y=$TY)"
sed "s/@ESCX@/$EX/; s/@ESCY@/$EY/; s/@TOPX@/$TX/; s/@TOPY@/$TY/" /tmp/hpk-ime-keep.json > /tmp/hpk-ime-keep-run.json
echo
echo "=== 真实触摸：聚焦终端 → 点 Esc → 点顶栏(对照) → 聚焦输入框 → 点 Esc ==="
node tools/cdp.mjs --script /tmp/hpk-ime-keep-run.json --timeout 180000 2>&1 | grep -E '"value"' > /tmp/hpk-keep-out.txt
python3 - <<'PY'
import re, json
for line in open('/tmp/hpk-keep-out.txt'):
    m = re.search(r'"value":\s*(".*?")$', line.strip())
    if not m: continue
    v = json.loads(m.group(1))
    try: v = json.loads(v)
    except Exception: pass
    print('  ' + (json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v))
PY
} > "$OUT/功能键不收键盘-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/功能键不收键盘-原始输出.txt"
echo KEEP_DONE
