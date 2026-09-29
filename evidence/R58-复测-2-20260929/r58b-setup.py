#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R58 第 3 步 · 通路：等开机 → 临时 sshd → App 建 R58靶机（sel 钉 hptarget）→ 授权 → 重连。"""
import json
import os
import subprocess
import time

HARNESS = '/home/lwgat/hermes-pocket/tools/ui-harness'
AUTH = '/tmp/r47probe-sshd/authorized_keys'
KEYNAME = 'r58probe'
ENV = dict(os.environ, PATH='/home/lwgat/tools/android-sdk/platform-tools:/home/lwgat/.local/bin:' + os.environ.get('PATH', ''))


def sh(c):
    return subprocess.run(['bash', '-c', c], capture_output=True, text=True, env=ENV).stdout.strip()


def node(script):
    r = subprocess.run(['node', 'dev-probe.mjs', script], capture_output=True, text=True, cwd=HARNESS, env=ENV)
    s = (r.stdout or '') + (r.stderr or '')
    open('/tmp/r58b-last.txt', 'w', encoding='utf-8').write(s)
    i = s.find('{'); j = s.rfind('}')
    try:
        d = json.loads(s[i:j + 1])
        for k, v in d.items():
            if isinstance(v, dict):
                return v.get('check') or {'error': v.get('error')}
    except Exception as e:
        return {'__parse': str(e), 'raw': s[-300:]}
    return {'__raw': s[-300:]}


print('1) 等开机：', sh('for i in $(seq 1 40); do b=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\\r"); [ "$b" = "1" ] && { echo OK; break; }; sleep 5; done'))
print('2) 临时 sshd：', sh('bash /vol1/1000/aicache/tmp/r47-sshd-up.sh 2>&1 | tail -1'))
print('3) 起 App + CDP：', sh('adb shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 7; S=$(adb shell "cat /proc/net/unix | grep -o \'webview_devtools_remote_[0-9]*\' | head -1" | tr -d "\\r"); adb forward --remove-all >/dev/null 2>&1; adb forward tcp:9222 localabstract:$S >/dev/null; echo forward=$S'))
print('4) 第一次跑（建密钥+主机；连不上是预期）：')
print(json.dumps(node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r58-app-host-20260929.mjs'), ensure_ascii=False)[:500])
kj = sh('adb exec-out run-as dev.hermes.pocket cat /data/data/dev.hermes.pocket/files/pocket/keys.json')
try:
    keys = json.loads(kj)
    k = next((x for x in keys if x.get('name') == KEYNAME), None)
    if k:
        with open(AUTH, 'a', encoding='utf-8') as f:
            f.write(k['publicKey'].strip() + '\n')
        print('5) 已授权 %s；authorized_keys 行数=%d' % (k.get('name'), len(open(AUTH).read().splitlines())))
except Exception as e:
    print('5) 取密钥失败：', e)
print('   清 known_hosts（避免再撞 hostkey 变了）：', sh('adb shell "run-as dev.hermes.pocket sh -c \'printf [] > /data/data/dev.hermes.pocket/files/pocket/known_hosts.json\'"'))
time.sleep(1)
print('6) 第二次跑（这次应连上并 attach hptarget）：')
print(json.dumps(node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r58-app-host-20260929.mjs'), ensure_ascii=False)[:900])
print('7) NAS authorized_keys：', sh('wc -l < ~/.ssh/authorized_keys; stat -c %y ~/.ssh/authorized_keys'))
print('8) 宿主 tmux：', sh('tmux ls | tr "\\n" "|"'))
