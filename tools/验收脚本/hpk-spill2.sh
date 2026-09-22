#!/bin/bash
# 专测：后台不渲染 → 落盘 → 回前台补渲染
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"; OUT=/vol1/1000/airesults; PKG=dev.hermes.pocket
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
snap() { run "(async()=>{const b=HP.App.term.buffer.active; return JSON.stringify({省电中:HP.App._powerSave, 渲染水位:HP.App.renderSeq||0, 终端总行数:b.length, 通道:(await HP.App.rpc('app.power.state')).save});})()"; }
spill() { $A shell "run-as $PKG ls -l files/ 2>/dev/null | grep spill || echo NONE" | tr -d '\r' | sed 's/^/    /'; }
conns() { ss -tn state established '( sport = :2222 )' 2>/dev/null | tail -n +2 | wc -l; }

{
echo "### 省电：后台落盘 → 回前台补渲染（专项）  $(date '+%F %T %Z')"
echo
echo "=== ① 基线（前台）==="
snap
echo "  落盘缓存: $(spill | tr -d ' ')"
echo "  连接数: $(conns)"

echo
echo "=== ② 切后台 → 省电 ==="
$A shell input keyevent KEYCODE_HOME; sleep 4
snap
echo "  连接数（不许断）: $(conns)"

echo
echo "=== ③ 后台期间产生 2000 行（只该落盘，不该渲染）==="
run "(async()=>{ HP.App.send('clear; yes BG-LINE-TEST | head -n 2000; echo BG-DONE\\r'); return 'sent'; })()" 40000
sleep 10
snap
echo "  落盘缓存（应有 spill-*.log 且 > 0 字节）:"
spill
echo "  连接数: $(conns)"

echo
echo "=== ④ 回前台 → 先补渲染落盘的那段 ==="
$A shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 8
snap
echo "  落盘缓存（应已被取走清掉）:"
spill
run "(async()=>{ const b=HP.App.term.buffer.active; let n=0, done=false; for(let i=0;i<=b.baseY+b.cursorY;i++){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('BG-LINE-TEST')>=0) n++; if(s.indexOf('BG-DONE')>=0) done=true;} return JSON.stringify({缓冲里BG-LINE行数:n, 有结束标记:done, 提示:document.getElementById('toast').textContent.trim()});})()" 60000
echo "  连接数: $(conns)"
} > "$OUT/省电-落盘补渲染-专项.txt" 2>&1
cat "$OUT/省电-落盘补渲染-专项.txt"
echo SPILL2_DONE
