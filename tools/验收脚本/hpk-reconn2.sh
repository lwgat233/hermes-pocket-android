#!/bin/bash
# 真断线 → 自动重连 → 回到原会话（重跑启动命令）
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"; OUT=/vol1/1000/airesults; PKG=dev.hermes.pocket

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build33.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build33.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build33.log | head -30; exit 1; fi
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

{
echo "### 真断线 → 自动重连 → 回到原会话  $(date '+%F %T %Z')"
echo
echo "=== ① 配置测试主机（autoReconnect + 启动命令）并连上 ==="
run "(async()=>{ const ks=await HP.App.rpc('key.list'); const km=ks.find(x=>x.id==='b8f3599c9a884054'); const hs=await HP.App.rpc('host.list'); const h=hs.find(x=>x.port===2222); h.autoReconnect=true; h.startCmd='echo REATTACH-MARK-\$(date +%s); echo REATTACH-DONE'; await HP.App.rpc('host.save',{host:h}); await HP.Panels.load(); await HP.App.connect(h.id); await new Promise(r=>setTimeout(r,3500)); return JSON.stringify({状态:HP.App.state, 主机启动命令:HP.App.host&&HP.App.host.startCmd, autoReconnect:HP.App.host&&HP.App.host.autoReconnect}); })()" 90000
echo "  服务端连接数: $(ss -tn state established '( sport = :2222 )' 2>/dev/null | tail -n +2 | wc -l)"
echo
echo "=== ② 造一条"断线前的输出" ==="
run "(async()=>{ HP.App.send('echo BEFORE-DROP-3\\r'); await new Promise(r=>setTimeout(r,1500)); return 'ok'; })()" 60000
echo
echo "=== ③ 真断线（掐掉 sshd 会话进程）==="
LISTENER=$(ss -tlnp 2>/dev/null | grep ':2222' | grep -oP 'pid=\K[0-9]+' | head -1)
PIDS=$(ss -tnp state established '( sport = :2222 )' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u | grep -v "^$LISTENER$" | tr '\n' ' ')
for p in $PIDS; do kill $p 2>/dev/null && echo "  已杀 $p"; done
echo
echo "=== ④ 观察自动重连 + 启动命令重跑 ==="
for i in $(seq 1 8); do
  sleep 5
  run "(async()=>JSON.stringify({t:'$(date +%H:%M:%S)', 状态:HP.App.state, 连接数:'$(ss -tn state established "( sport = :2222 )" 2>/dev/null | tail -n +2 | wc -l)'}))()"
done
echo
echo "=== ⑤ 最终核对 ==="
run "(async()=>{const b=HP.App.term.buffer.active; let mark=null,before=false; for(let i=0;i<=b.baseY+b.cursorY;i++){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('REATTACH-MARK-')>=0&&mark===null)mark=s.trim(); if(s.indexOf('BEFORE-DROP-3')>=0)before=true;} return JSON.stringify({断线前输出还在:before, 重跑启动命令:!!mark, 输出:mark});})()"
} > "$OUT/真断线重连-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/真断线重连-原始输出.txt"
echo RECONN2_DONE
