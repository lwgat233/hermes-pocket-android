#!/bin/bash
# 省电细化验收：后台不渲染 → 落盘缓存 → 回前台补渲染；连接全程不断
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"; OUT=/vol1/1000/airesults; PKG=dev.hermes.pocket

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build32.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build32.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build32.log | head -30; exit 1; fi
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
snap() { run "(async()=>{const w=HP.App.watcher, b=HP.App.term.buffer.active; return JSON.stringify({省电中:HP.App._powerSave, 渲染水位:HP.App.renderSeq||0, 终端总行数:b.length, 终端底行:b.baseY+b.cursorY, 通道:await HP.App.rpc('app.power.state'), 页面隐藏:document.hidden});})()"; }
spill() { $A shell "run-as $PKG ls -l files/ 2>/dev/null | grep spill || echo '  (没有 spill 文件)'" | tr -d '\r' | sed 's/^/    /'; }
conns() { ss -tn state established '( sport = :2222 )' 2>/dev/null | tail -n +2 | wc -l; }

{
echo "### 省电细化：后台不渲染→落盘→回前台补渲染  $(date '+%F %T %Z')"
echo
echo "=== 连接 ==="
run "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} await HP.App.rpc('pref.set',{k:'powerSave',v:'background'}); HP.App.prefs.powerSave='background'; await HP.App.send('clear\\r'); await new Promise(r=>setTimeout(r,1500)); return HP.App.state; })()" 90000

echo
echo "=== ① 基线 ==="
snap
echo "  服务端连接数: $(conns)"

echo
echo "=== ② 切后台（应进入省电：不渲染、心跳拉长到 120s、唤醒锁释放）==="
$A shell input keyevent KEYCODE_HOME; sleep 4
snap
spill
echo "  服务端连接数（应仍是 2：**没断**）: $(conns)"

echo
echo "=== ③ 后台期间让远端产生 2000 行输出（应只落盘、不渲染）==="
run "(async()=>{ HP.App.send('clear; for i in \\$(seq 1 2000); do echo BG-LINE-\\$i; done; echo BG-DONE\\r'); return 'sent'; })()" 40000
sleep 8
snap
echo "  落盘缓存："
spill
echo "  服务端连接数: $(conns)"

echo
echo "=== ④ 回前台：应把落盘的那段补渲染出来 ==="
$A shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 6
snap
echo "  落盘缓存（应已被取走并清掉）："
spill
run "(async()=>{ const b=HP.App.term.buffer.active; let has1=false,has2000=false,hasDone=false; for(let i=0;i<=b.baseY+b.cursorY;i++){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('BG-LINE-1')>=0)has1=true; if(s.indexOf('BG-LINE-2000')>=0)has2000=true; if(s.indexOf('BG-DONE')>=0)hasDone=true;} return JSON.stringify({首行BG-LINE-1:has1, 末行BG-LINE-2000:has2000, 结束标记BG-DONE:hasDone, 提示:document.getElementById('toast').textContent.trim()});})()"
echo "  服务端连接数: $(conns)"

echo
echo "=== ⑤ 心跳没有被关掉（省电时 120s，恢复后 30s）==="
run "(async()=>{const a=await HP.App.rpc('app.power.state'); await HP.App.applyPowerSave(true,'验证'); await new Promise(r=>setTimeout(r,600)); const b=await HP.App.rpc('app.power.state'); await HP.App.applyPowerSave(false,'验证'); await new Promise(r=>setTimeout(r,600)); const c=await HP.App.rpc('app.power.state'); return JSON.stringify({正常时心跳:a.keepalive, 省电中心跳:b.keepalive, 恢复后心跳:c.keepalive});})()" 60000
# 复位成默认息屏模式
run "(async()=>{await HP.App.rpc('pref.set',{k:'powerSave',v:'screenOff'}); HP.App.prefs.powerSave='screenOff'; return '复位 screenOff';})()"
} > "$OUT/省电-后台缓存与补渲染-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/省电-后台缓存与补渲染-原始输出.txt"
echo SPILL_DONE
