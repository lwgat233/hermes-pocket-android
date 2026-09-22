#!/bin/bash
# 文件事件通道验收：另开一条 SSH + 写入事件 → 手机系统通知
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"
OUT=/vol1/1000/airesults
EV="$HOME/hermes-pocket-events.log"

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build27.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build27.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build27.log | head -30; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
$A shell am force-stop dev.hermes.pocket; sleep 1
: > "$EV"      # 干净起步
$A shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 8
PID=$($A shell pidof dev.hermes.pocket | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

conns() { ss -tn state established '( sport = :2222 )' 2>/dev/null | tail -n +2 | wc -l; }

{
echo "### 文件事件通道（独立 SSH + 手机系统通知）  $(date '+%F %T %Z')"
echo
echo "=== 连接前的连接数（到 :2222）==="
echo "  $(conns) 条"
echo
echo "=== 连接终端 ==="
node tools/cdp.mjs --expr "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} await new Promise(r=>setTimeout(r,4000)); return JSON.stringify({状态:HP.App.state, 事件通道:HP.App.eventState, 事件通道开:!!HP.App.eventOn, 事件文件设定:HP.App.pref('eventFile','(默认)')}); })()" --timeout 90000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo
echo "=== 服务端核验：应该有 **2 条** 到 :2222 的连接（终端 + 事件通道）==="
echo "  当前 $(conns) 条："
ss -tnp state established '( sport = :2222 )' 2>/dev/null | tail -n +2 | sed 's/^/    /'
echo
echo "=== ① 写一条 auth（需要授权）→ 应该弹系统通知 ==="
./hpk-notify.sh auth "需要你点一下确认" "远端在等你输入 sudo 密码" | sed 's/^/  /'
sleep 5
$A shell "dumpsys notification --noredact 2>/dev/null | grep -E 'pkg=dev.hermes.pocket|android.title|android.text'" | grep -A2 "pkg=dev.hermes.pocket" | grep -E "android.title|android.text" | head -4 | sed 's/^/  /'
echo
echo "=== ② 写一条 done（做完了）→ 应该弹系统通知 ==="
./hpk-notify.sh done "构建完成" "hermes-pocket 调试包已生成" | sed 's/^/  /'
sleep 5
$A shell "dumpsys notification --noredact 2>/dev/null | grep -E 'pkg=dev.hermes.pocket|android.title|android.text'" | grep -A2 "pkg=dev.hermes.pocket" | grep -E "android.title|android.text" | head -6 | sed 's/^/  /'
echo
echo "=== ③ 写一条不带 kind 的（格式写错也不该丢通知）→ 整行当标题 ==="
echo "随手写一句没有格式的话" >> "$EV"
sleep 5
node tools/cdp.mjs --expr "JSON.stringify({累计收到条数:HP.App.eventSeen, 最近一条:HP.App.lastEvent})" --timeout 30000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo
echo "=== ④ 终端会话不受影响（事件通道是另一条连接）==="
node tools/cdp.mjs --expr "(async()=>{HP.App.send('echo TERM-STILL-OK; echo \$((1+1))\\r'); await new Promise(r=>setTimeout(r,2000)); const b=HP.App.term.buffer.active; let out=[]; for(let i=b.baseY+b.cursorY;i>=0&&out.length<12;i--){const l=b.getLine(i); if(l){const s=l.translateToString(true); if(s.trim())out.push(s.trim());}} return JSON.stringify({状态:HP.App.state, 事件通道:HP.App.eventState, 末几行:out.slice(0,6)}); })()" --timeout 60000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo
echo "=== ⑤ 事件文件内容（只追加）==="
cat "$EV" | sed 's/^/  /'
echo
echo "=== ⑥ 关掉事件通道开关 → 通道应停止 ==="
node tools/cdp.mjs --expr "(async()=>{await HP.App.rpc('pref.set',{k:'eventChannel',v:false}); HP.App.stopEventChannel(); await new Promise(r=>setTimeout(r,1500)); const s=await HP.App.rpc('events.state'); return JSON.stringify(s);})()" --timeout 40000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo "  连接数（关掉后应回到 1）: $(conns) 条"
node tools/cdp.mjs --expr "(async()=>{await HP.App.rpc('pref.set',{k:'eventChannel',v:true}); return '开关已恢复';})()" --timeout 30000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
} > "$OUT/事件通道-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/事件通道-原始输出.txt"
echo EVENTS_DONE
