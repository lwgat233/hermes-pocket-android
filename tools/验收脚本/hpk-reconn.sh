#!/bin/bash
# ① 补渲染内容核对 ② 真断线 → 重连 → 信息恢复 + 回到原会话
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"; OUT=/vol1/1000/airesults; PKG=dev.hermes.pocket
PID=$($A shell pidof $PKG | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

run() { node tools/cdp.mjs --expr "$1" --timeout "${2:-90000}" 2>&1 | grep '"value"' | tail -1 | python3 -c "
import sys,json,re
s=sys.stdin.read().strip(); m=re.search(r'\"value\":\s*(\"(?:[^\"\\\\]|\\\\.)*\")', s)
if not m: print('  (没拿到)'); raise SystemExit
v=json.loads(m.group(1))
try: v=json.loads(v)
except Exception: pass
print('  '+(json.dumps(v,ensure_ascii=False) if not isinstance(v,str) else v))
"; }

{
echo "### 补渲染内容 + 断线重连恢复  $(date '+%F %T %Z')"
echo
echo "=== ① 补渲染出来的内容（应能看到 2000 行里的首尾与结束标记）==="
run "(async()=>{ const b=HP.App.term.buffer.active; let first=null,last=null,done=false; for(let i=0;i<=b.baseY+b.cursorY;i++){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('BG-LINE-TEST')>=0){ if(first===null)first=s.trim(); last=s.trim(); } if(s.indexOf('BG-DONE')>=0)done=true;} return JSON.stringify({第一条:first, 最后一条:last, 有BG-DONE:done, 终端行数:b.length});})()" 120000

echo
echo "=== ② 断线前先产生一点输出 ==="
run "(async()=>{ HP.App.send('echo BEFORE-DROP-MARK\\r'); await new Promise(r=>setTimeout(r,1500)); return 'ok'; })()" 60000

echo
echo "=== ③ 把服务端 sshd 停掉（模拟真断线）==="
tools/testssh.sh stop 2>&1 | tail -2 | sed 's/^/  /'
sleep 6
run "(async()=>{return JSON.stringify({连接状态:HP.App.state, 顶栏:document.getElementById('tb-title').textContent});})()" 60000

echo
echo "=== ④ 重新起 sshd → 应自动重连、回到原会话、并且旧输出还在 ==="
tools/testssh.sh start 2>&1 | tail -2 | sed 's/^/  /'
sleep 14
run "(async()=>{const b=HP.App.term.buffer.active; let before=false,rc=false; for(let i=Math.max(0,b.baseY-60);i<=b.baseY+b.cursorY;i++){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('BEFORE-DROP-MARK')>=0)before=true; if(s.indexOf('重连')>=0||s.indexOf('回到原会话')>=0)rc=true;} return JSON.stringify({连接状态:HP.App.state, 断线前的输出还在:before, 重连提示:rc, 会话id:HP.App.sessionId, 提示条:document.getElementById('toast').textContent.trim()});})()" 90000
} > "$OUT/断线重连恢复-原始输出.txt" 2>&1
cat "$OUT/断线重连恢复-原始输出.txt"
echo RECONN_DONE
