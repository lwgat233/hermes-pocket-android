#!/bin/bash
# 最终验收：键条真实手势 + 焦点保留 + 无杂散键 + 输入框 Ctrl 组合 + 真 tmux detach
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"
OUT=/vol1/1000/airesults

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build25.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build25.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build25.log | head -20; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1
$A shell settings put secure show_ime_with_hard_keyboard 1
$A shell am force-stop dev.hermes.pocket; sleep 1
$A shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 8
PID=$($A shell pidof dev.hermes.pocket | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

stat -c '  tmux 护栏 before: inode=%i ctime=%z' /tmp/tmux-1000/default
{
echo "### 最终验收：键条手势 / 焦点保留 / 修饰键 / tmux detach  $(date '+%F %T %Z')"
echo
node tools/cdp.mjs --expr "(async()=>{ if(HP.App.closePanel) HP.App.closePanel(); if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} HP.App.send('clear\\r'); await new Promise(r=>setTimeout(r,1500)); return JSON.stringify({状态:HP.App.state}); })()" --timeout 90000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
echo
node tools/cdp.mjs --script /tmp/hpk-final2.json --timeout 240000 > /tmp/f2raw.txt 2>&1
python3 - <<'PY'
import re, json
for line in open('/tmp/f2raw.txt'):
    m = re.search(r'"value":\s*(".*?")$', line.strip())
    if m:
        v = json.loads(m.group(1))
        try: v = json.loads(v)
        except Exception: pass
        print('  ' + (json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v))
    elif 'tapGesture' in line or '"err' in line:
        print('   · ' + line.strip()[:130])
PY
echo
echo "=== tmux 端核对 ==="
echo "  客户端: $(tmux -L hpk-cb list-clients 2>&1 | tr '\n' ' ')  ← 空＝已脱离"
echo "  会话:   $(tmux -L hpk-cb list-sessions 2>&1 | tr '\n' ' ')  ← 还在＝只是 detach"
} > "$OUT/键条手势与焦点-最终验收.txt" 2>&1

tmux -L hpk-cb kill-server 2>/dev/null && echo "  已杀 hpk-cb" || echo "  hpk-cb 不存在"
stat -c '  tmux 护栏 after:  inode=%i ctime=%z' /tmp/tmux-1000/default
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/键条手势与焦点-最终验收.txt"
echo FINAL2_DONE
