#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R48#4 复测 · 通路：临时 sshd → tmux 靶子 r48t（raw）→ App 建主机连上 → attach r48t"""
import json
import os
import subprocess
import time

HARNESS = '/home/lwgat/hermes-pocket/tools/ui-harness'
AUTH = '/tmp/r47probe-sshd/authorized_keys'
LOG = '/tmp/r48-probe.log'
ENV = dict(os.environ, PATH='/home/lwgat/tools/android-sdk/platform-tools:/home/lwgat/.local/bin:' + os.environ.get('PATH', ''))


def sh(c):
    return subprocess.run(['bash', '-c', c], capture_output=True, text=True, env=ENV).stdout.strip()


def node(script):
    r = subprocess.run(['node', 'dev-probe.mjs', script], capture_output=True, text=True, cwd=HARNESS, env=ENV)
    s = (r.stdout or '') + (r.stderr or '')
    open('/tmp/r48-last.txt', 'w', encoding='utf-8').write(s)
    i = s.find('{'); j = s.rfind('}')
    try:
        d = json.loads(s[i:j + 1])
        for k, v in d.items():
            if isinstance(v, dict):
                return v.get('check') or {'error': v.get('error')}
    except Exception as e:
        return {'__parse': str(e), 'raw': s[-200:]}
    return {'__raw': s[-200:]}


print('1) 等开机：', sh('for i in $(seq 1 40); do b=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\\r"); [ "$b" = "1" ] && { echo OK; break; }; sleep 5; done'))
print('2) 临时 sshd：', sh('bash /vol1/1000/aicache/tmp/r47-sshd-up.sh 2>&1 | tail -1'))
print('3) 靶子会话 r48t（raw + 300 行）：', sh('tmux kill-session -t r48t 2>/dev/null; R49_LOG=%s tmux new-session -d -s r48t "R49_LOG=%s R49_INIT=300 python3 -u /vol1/1000/aicache/tmp/r58-target.py"; sleep 3; tmux ls | tr "\\n" "|"' % (LOG, LOG)))
print('   靶子日志：', sh('head -2 %s' % LOG))
print('4) 起 App + CDP：', sh('adb shell am start -n dev.hermes.pocket/.MainActivity >/dev/null 2>&1; sleep 7; S=$(adb shell "cat /proc/net/unix | grep -o \'webview_devtools_remote_[0-9]*\' | head -1" | tr -d "\\r"); adb forward --remove-all >/dev/null 2>&1; adb forward tcp:9222 localabstract:$S >/dev/null; echo forward=$S'))
print('5) 建主机（第一次）：', json.dumps(node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r58-app-host-20260929.mjs'), ensure_ascii=False)[:300])
kj = sh('adb exec-out run-as dev.hermes.pocket cat /data/data/dev.hermes.pocket/files/pocket/keys.json')
try:
    keys = json.loads(kj)
    k = next((x for x in keys if x.get('name') in ('r58probe', 'r52probe', 'o14probe')), None)
    if k:
        with open(AUTH, 'a', encoding='utf-8') as f:
            f.write(k['publicKey'].strip() + '\n')
        print('6) 已授权 %s；authorized_keys 行数=%d' % (k.get('name'), len(open(AUTH).read().splitlines())))
except Exception as e:
    print('6) 取密钥失败：', e)
sh('adb shell "run-as dev.hermes.pocket sh -c \'printf [] > /data/data/dev.hermes.pocket/files/pocket/known_hosts.json\'"')
time.sleep(1)
print('7) 再连一次：', json.dumps(node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r58-app-host-20260929.mjs'), ensure_ascii=False)[:260])
print('8) attach r48t：', json.dumps(node('/vol1/1000/aicache/tmp/r48-attach.mjs'), ensure_ascii=False)[:400] if os.path.exists('/vol1/1000/aicache/tmp/r48-attach.mjs') else '(attach 脚本稍后写)')
print('9) tmux：', sh('tmux ls | tr "\\n" "|"'), '| NAS keys:', sh('wc -l < ~/.ssh/authorized_keys'))
