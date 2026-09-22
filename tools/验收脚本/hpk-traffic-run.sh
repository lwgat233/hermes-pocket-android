#!/bin/bash
# 流量统计：用已知大小的下行/上行数据核对
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"
OUT=/vol1/1000/airesults

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build26.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build26.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build26.log | head -20; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
$A shell am force-stop dev.hermes.pocket; sleep 1
$A shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 8
PID=$($A shell pidof dev.hermes.pocket | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

{
echo "### 流量统计（下行/上行）验收  $(date '+%F %T %Z')"
echo
echo "=== 连接 ==="
node tools/cdp.mjs --expr "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} HP.App.send('clear\\r'); await new Promise(r=>setTimeout(r,1500)); return JSON.stringify({状态:HP.App.state, 顶栏:document.getElementById('tb-traffic').textContent, 有统计对象:!!HP.App.traffic}); })()" --timeout 90000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo
echo "=== 已知大小的数据核对 ==="
node tools/cdp.mjs --script /tmp/hpk-traffic.json --timeout 180000 > /tmp/tfraw.txt 2>&1
python3 - <<'PY'
import re, json
for line in open('/tmp/tfraw.txt'):
    m = re.search(r'"value":\s*(".*?")$', line.strip())
    if not m: continue
    v = json.loads(m.group(1))
    try: v = json.loads(v)
    except Exception: pass
    print('  ' + (json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v))
PY
} > "$OUT/流量统计-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/流量统计-原始输出.txt"
echo TRAFFIC_DONE
