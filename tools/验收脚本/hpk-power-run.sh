#!/bin/bash
# 省电板块验收：省电 ≠ 断连
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"; OUT=/vol1/1000/airesults
PKG=dev.hermes.pocket

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build31.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build31.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build31.log | head -30; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
$A shell am force-stop $PKG; sleep 1
$A shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 8
PID=$($A shell pidof $PKG | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

run() { node tools/cdp.mjs --expr "$1" --timeout "${2:-60000}" 2>&1 | grep '"value"' | tail -1 | python3 -c "
import sys,json,re
s=sys.stdin.read().strip(); m=re.search(r'\"value\":\s*(\"(?:[^\"\\\\]|\\\\.)*\")', s)
if not m: print('  (没拿到)'); raise SystemExit
v=json.loads(m.group(1))
try: v=json.loads(v)
except Exception: pass
print('  '+(json.dumps(v,ensure_ascii=False) if not isinstance(v,str) else v))
"; }
wl() { $A shell "dumpsys power | grep -i 'hermes-pocket'" | tr -d '\r' | sed 's/^ */    /'; echo "    (空=没有持有唤醒锁)"; }
conns() { ss -tn state established '( sport = :2222 )' 2>/dev/null | tail -n +2 | wc -l; }

{
echo "### 省电板块验收  $(date '+%F %T %Z')"
echo
echo "=== 连接 ==="
run "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} await new Promise(r=>setTimeout(r,2000)); return HP.App.state; })()" 90000

echo
echo "=== ① 基线（前台）：唤醒锁应被持有 ==="
run "(async()=>{const p=await HP.App.rpc('app.power.state'); return JSON.stringify({省电中:HP.App._powerSave, 原生:p, 定时器:{流量:!!HP.App._trafficTimer, 命令判定:!!HP.App._tickTimer, 心跳:!!HP.App.ping.timer}, 看门狗:!!HP.App._watchRaf});})()"
wl
echo "  服务端连接数: $(conns)"

echo
echo "=== ② 切到后台（模式=background）→ 应进入省电 ==="
run "(async()=>{ await HP.App.rpc('pref.set',{k:'powerSave',v:'background'}); HP.App.prefs.powerSave='background'; return '模式=background'; })()"
$A shell input keyevent KEYCODE_HOME; sleep 4
run "(async()=>{const p=await HP.App.rpc('app.power.state'); return JSON.stringify({省电中:HP.App._powerSave, 原生:p, 定时器:{流量:!!HP.App._trafficTimer, 命令判定:!!HP.App._tickTimer, 心跳:!!HP.App.ping.timer}, 看门狗:!!HP.App._watchRaf, 页面隐藏:document.hidden});})()"
wl
echo "  服务端连接数（应仍是 2 = 终端 + 事件通道，**没断**）: $(conns)"

echo
echo "=== ③ 睡着期间让远端产生输出（连接还在，输出不该丢）==="
run "(async()=>{ HP.App.send('echo DOZE-OUTPUT-\$(date +%s); echo SECOND-LINE\\r'); return 'sent'; })()" 40000
sleep 4

echo
echo "=== ④ 回到前台 → 应退出省电、收回唤醒锁 ==="
$A shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 5
run "(async()=>{const p=await HP.App.rpc('app.power.state'); return JSON.stringify({省电中:HP.App._powerSave, 原生:p, 定时器:{流量:!!HP.App._trafficTimer, 命令判定:!!HP.App._tickTimer, 心跳:!!HP.App.ping.timer}, 看门狗:!!HP.App._watchRaf, 会话状态:HP.App.state});})()"
wl
echo "  服务端连接数: $(conns)"

echo
echo "=== ⑤ 睡着期间那条输出在不在（终端缓冲）==="
run "(async()=>{ const b=HP.App.term.buffer.active; let hit=[]; for(let i=b.baseY+b.cursorY;i>=0 && i>b.baseY-40;i--){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('DOZE-OUTPUT')>=0||s.indexOf('SECOND-LINE')>=0) hit.push(s.trim());} return JSON.stringify({命中:hit, 收到总量:HP.App.traffic?HP.App.traffic.down:0}); })()"

echo
echo "=== ⑥ 息屏路径（模式=screenOff）：息屏应省电、亮屏应恢复 ==="
run "(async()=>{ await HP.App.rpc('pref.set',{k:'powerSave',v:'screenOff'}); HP.App.prefs.powerSave='screenOff'; return '模式=screenOff'; })()"
$A shell input keyevent KEYCODE_SLEEP; sleep 4
run "(async()=>{const p=await HP.App.rpc('app.power.state'); return JSON.stringify({省电中:HP.App._powerSave, 原生:p, 页面隐藏:document.hidden});})()"
wl
$A shell input keyevent KEYCODE_WAKEUP; sleep 4
run "(async()=>{const p=await HP.App.rpc('app.power.state'); return JSON.stringify({省电中:HP.App._powerSave, 原生:p, 页面隐藏:document.hidden});})()"
wl
} > "$OUT/省电板块-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/省电板块-原始输出.txt"
echo POWER_DONE
