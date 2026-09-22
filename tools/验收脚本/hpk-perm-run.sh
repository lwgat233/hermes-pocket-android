#!/bin/bash
# 通知权限链路：撤销 → App 内提示 → 系统弹窗 → 授权 → 自动自测
export JAVA_HOME=$HOME/tools/jdk-17.0.2
export ANDROID_HOME=$HOME/tools/android-sdk
export PATH=$JAVA_HOME/bin:$HOME/tools/gradle-8.7/bin:$ANDROID_HOME/platform-tools:$HOME/.local/bin:$PATH
cd /home/lwgat/hermes-pocket
A="adb -s emulator-5554"
OUT=/vol1/1000/airesults
PKG=dev.hermes.pocket
PERM=android.permission.POST_NOTIFICATIONS

gradle --no-daemon -Pkotlin.compiler.execution.strategy=in-process :app:assembleDebug > /tmp/hpk-build28.log 2>&1
GEXIT=$?; grep -E "BUILD SUCCESSFUL|BUILD FAILED" /tmp/hpk-build28.log
if [ "$GEXIT" -ne 0 ]; then grep -E "^e: |error:" /tmp/hpk-build28.log | head -30; exit 1; fi
$A install -r app/build/outputs/apk/debug/app-debug.apk 2>&1 | tail -1

cdp() { node tools/cdp.mjs --expr "$1" --timeout 40000 2>&1 | grep '"value"' | tail -1 | sed -E 's/.*"value": *"(.*)"/\1/; s/\\"/"/g'; }
state() { $A shell "dumpsys package $PKG | grep -A2 POST_NOTIFICATIONS | head -3" | tr -d '\r' | sed 's/^/    /'; }
wins() { $A shell "dumpsys window windows 2>/dev/null | grep -iE 'GrantPermission|permissioncontroller|AlertDialog' | head -3" | tr -d '\r' | sed 's/^/    /'; }

{
echo "### 通知权限链路验收  $(date '+%F %T %Z')"
echo
echo "=== ① 撤销通知权限并冷启动（模拟"用户第一次点了不允许"）==="
$A shell pm revoke $PKG $PERM 2>&1 | sed 's/^/  /'
: > "$HOME/hermes-pocket-events.log"
$A shell am force-stop $PKG; sleep 1
$A shell am start -n $PKG/.MainActivity >/dev/null 2>&1; sleep 6
echo "  启动后权限状态："; state
echo "  系统弹窗（启动时自动申请，应看到权限弹窗）："; wins
echo "  用返回键取消这个系统弹窗（= 用户点了不允许/忽略了）："
$A shell input keyevent KEYCODE_BACK; sleep 2
echo "  现在权限状态："; state

PID=$($A shell pidof $PKG | tr -d '\r')
$A forward --remove-all >/dev/null 2>&1; $A forward tcp:9222 localabstract:webview_devtools_remote_$PID >/dev/null

echo
echo "=== ② 连上后应主动提示"没有通知权限"（这就是"不知道在哪授权"的修法）==="
node tools/cdp.mjs --expr "(async()=>{ if(HP.App.state!=='connected'){await HP.App.connect((await HP.App.rpc('host.list')).find(h=>h.port===2222).id); for(let i=0;i<40;i++){await new Promise(r=>setTimeout(r,400)); const d=[...document.getElementById('stage').children].filter(e=>e.querySelector&&e.querySelector('[data-y]')).pop(); if(d)(d.querySelector('[data-y]')||{}).click(); if(HP.App.state==='connected')break;}} await new Promise(r=>setTimeout(r,2500));
  const dlg=[...document.getElementById('stage').children].filter(e=>e.classList&&e.classList.contains('hp-dialog')).pop();
  const st=await HP.App.rpc('app.notification.state');
  return JSON.stringify({已授权:st.granted, 提示框:!!dlg, 提示文字:dlg?dlg.textContent.replace(/\\s+/g,' ').trim().slice(0,80):null, 按钮:dlg?[...dlg.querySelectorAll('[data-y]')].map(b=>b.textContent):null}); })()" --timeout 90000 > /tmp/perm1.txt 2>&1
grep '"value"' /tmp/perm1.txt | tail -1 | python3 -c "
import sys,json,re
m=re.search(r'\"value\":\s*(\".*?\")$', sys.stdin.read().strip())
print('  '+json.dumps(json.loads(json.loads(m.group(1))),ensure_ascii=False) if m else '  (没拿到)')"

echo
echo "=== ③ 点提示框里的「去授权」→ 应拉起系统权限弹窗 ==="
node tools/cdp.mjs --expr "(()=>{const d=[...document.getElementById('stage').children].filter(e=>e.classList&&e.classList.contains('hp-dialog')).pop(); if(!d) return '没有提示框'; const y=d.querySelector('[data-y]'); y.click(); return '点了: '+y.textContent;})()" --timeout 40000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
sleep 3
echo "  系统弹窗："; wins

echo
echo "=== ④ 在系统弹窗上点「允许」（用 uiautomator 找按钮坐标，真点）==="
$A shell uiautomator dump /sdcard/perm.xml >/dev/null 2>&1
$A shell cat /sdcard/perm.xml 2>/dev/null > /tmp/perm.xml
python3 - <<'PY' > /tmp/permxy.txt
import re
x = open('/tmp/perm.xml', encoding='utf-8', errors='ignore').read()
best = None
for m in re.finditer(r'text="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', x):
    t, x1, y1, x2, y2 = m.group(1), *map(int, m.groups()[1:])
    if any(k in t for k in ('允许', 'Allow', '始终允许')):
        best = ((x1 + x2) // 2, (y1 + y2) // 2, t); break
print(f"{best[0]} {best[1]} {best[2]}" if best else "none")
PY
cat /tmp/permxy.txt | sed 's/^/  找到按钮: /'
read PX PY PT <<< "$(cat /tmp/permxy.txt)"
if [ "$PX" = "none" ] || [ -z "$PX" ]; then
  echo "  （没解析到按钮，改用 pm grant 直接授权）"
  $A shell pm grant $PKG $PERM
else
  $A shell input tap $PX $PY
fi
sleep 3
echo "  授权后权限状态："; state

echo
echo "=== ⑤ 授权成功应触发原生回调 → 自动发一条测试通知 ==="
cdp "JSON.stringify({授权:HP.App.prefs.eventFile?1:1})" >/dev/null
sleep 2
$A shell "dumpsys notification --noredact 2>/dev/null | grep -E 'pkg=dev.hermes.pocket|android.title|android.text'" | grep -A2 "pkg=dev.hermes.pocket" | grep -E "android.title|android.text" | head -6 | sed 's/^ */    /'

echo
echo "=== ⑥ 设置面板里的权限状态显示 ==="
node tools/cdp.mjs --expr "(async()=>{await HP.Panels.renderSettings(); await new Promise(r=>setTimeout(r,600)); const e=document.getElementById('nt-state'); return e?e.textContent:'(没有该元素)';})()" --timeout 40000 2>&1 | grep '"value"' | tail -1 | sed 's/^/  /'
} > "$OUT/通知权限链路-原始输出.txt" 2>&1

cp app/build/outputs/apk/debug/app-debug.apk "$OUT/hermes-pocket-debug.apk"
cd "$OUT" && sha256sum hermes-pocket-debug.apk > apk-sha256.txt
echo "  新构件: $(cat apk-sha256.txt)"
cat "$OUT/通知权限链路-原始输出.txt"
echo PERM_DONE
