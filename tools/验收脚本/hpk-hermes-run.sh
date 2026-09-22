#!/bin/bash
# Hermes 技能/记忆页 验收
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"
OUT=/vol1/1000/airesults

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build30.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build30.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build30.log | head -30; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
$A shell am force-stop dev.hermes.pocket; sleep 1
$A shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 8
PID=$($A shell pidof dev.hermes.pocket | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

run() { node tools/cdp.mjs --expr "$1" --timeout "${2:-60000}" 2>&1 | grep '"value"' | tail -1 | python3 -c "
import sys,json,re
s=sys.stdin.read().strip()
m=re.search(r'\"value\":\s*(\"(?:[^\"\\\\]|\\\\.)*\")', s)
if not m: print('  (没拿到)'); raise SystemExit
v=json.loads(m.group(1))
try: v=json.loads(v)
except Exception: pass
print('  '+(json.dumps(v,ensure_ascii=False) if not isinstance(v,str) else v))
"; }

{
echo "### 「Hermes 技能 / 记忆」页验收  $(date '+%F %T %Z')"
echo
echo "=== 连接 ==="
run "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} await new Promise(r=>setTimeout(r,1500)); return HP.App.state; })()" 90000

echo
echo "=== ① hermes.info：技能清单（原生取数）==="
run "(async()=>{const i=await HP.App.rpc('hermes.info',{},30000); const cats=[...new Set(i.skills.map(s=>s.category))]; const one=i.skills.find(s=>s.rel.indexOf('github')>=0); return JSON.stringify({目录:i.home, 技能数:i.count, 分类数:cats.length, 分类:cats, 记忆上限:i.memoryLimit, 用户画像上限:i.userLimit, 样例:one});})()" 60000

echo
echo "=== ② hermes.memory：记忆内容（和本地文件核对首行）==="
run "(async()=>{const m=await HP.App.rpc('hermes.memory',{},30000); return JSON.stringify({内存字符数:m.memoryChars, 用户字符数:m.userChars, 条目数:m.memoryEntries, MEMORY首行:(m.memory||'').split('\\n')[0].slice(0,60), USER首行:(m.user||'').split('\\n')[0].slice(0,50)});})()" 60000
echo "  本地核对 MEMORY.md 首行: $(head -1 /home/lwgat/.hermes/memories/MEMORY.md | cut -c1-60)"
echo "  本地 MEMORY.md 字符数: $(tr -d '\n' < /home/lwgat/.hermes/memories/MEMORY.md | wc -m)  USER.md: $(tr -d '\n' < /home/lwgat/.hermes/memories/USER.md | wc -m)"

echo
echo "=== ③ 打开面板 → 切到 Hermes 页 → 渲染结果 ==="
run "(async()=>{ HP.App.openPanel(); await new Promise(r=>setTimeout(r,900)); document.querySelector('.tabs button[data-tab=\"hermes\"]').click(); await new Promise(r=>setTimeout(r,3500)); const el=document.getElementById('tab-hermes'); const txt=el.textContent.replace(/\\s+/g,' '); return JSON.stringify({技能行数:el.querySelectorAll('[data-skill]').length, 含分类标题:txt.indexOf('software-development')>=0, 片段:txt.slice(0,160)});})()" 90000

echo
echo "=== ④ 点开一个技能（github）看内容 ==="
run "(async()=>{ const r=document.querySelector('[data-skill*=\"github\"]'); if(!r) return '找不到 github 行'; r.click(); await new Promise(r2=>setTimeout(r2,3000)); const d=[...document.getElementById('stage').children].filter(e=>e.classList&&e.classList.contains('hp-dialog')).pop(); const pre=d?d.querySelector('#sk-body'):null; return JSON.stringify({弹窗:d?true:false, 内容前120字:pre?pre.textContent.replace(/\\s+/g,' ').slice(0,120):null});})()" 60000

echo
echo "=== ⑤ 「在终端打开」→ 终端里应出现该技能内容 ==="
run "(async()=>{ const d=[...document.getElementById('stage').children].filter(e=>e.classList&&e.classList.contains('hp-dialog')).pop(); if(!d) return '没有弹窗'; d.querySelector('[data-term]').click(); await new Promise(r=>setTimeout(r,2500)); const b=HP.App.term.buffer.active; let hit=0, lines=[]; for(let i=Math.max(0,b.baseY-25); i<=b.baseY+b.cursorY; i++){const l=b.getLine(i); if(!l) continue; const s=l.translateToString(true); if(s.indexOf('github')>=0||s.indexOf('SKILL')>=0||s.indexOf('GitHub via gh')>=0){hit++; if(lines.length<3)lines.push(s.trim());}} return JSON.stringify({终端命中行:hit, 样例:lines});})()" 60000
echo "  （在终端里按 q 退出 less）"
run "(async()=>{ HP.App.send('q'); return 'sent q'; })()" 30000
} > "$OUT/Hermes技能与记忆-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/Hermes技能与记忆-原始输出.txt"
echo HERMES_DONE
