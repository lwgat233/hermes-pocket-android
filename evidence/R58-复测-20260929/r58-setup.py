#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R58 复测 · 通路：临时 sshd → 授 App 侧 r58probe 公钥 → 起 App（含 CDP 转发）→ 建 R58靶机 并连上。"""
import json
import os
import subprocess
import time

HARNESS = '/home/lwgat/hermes-pocket/tools/ui-harness'
LOG = '/vol1/1000/airesults/hermes-pocket/evidence/R58-复测-20260929/靶子日志-原始.log'
AUTH = '/tmp/r47probe-sshd/authorized_keys'
KEYNAME = 'r58probe'
ENV = dict(os.environ, PATH='/home/lwgat/tools/android-sdk/platform-tools:/home/lwgat/.local/bin:' + os.environ.get('PATH', ''))


def sh(c):
    return subprocess.run(['bash', '-c', c], capture_output=True, text=True, env=ENV).stdout.strip()


def node(script):
    r = subprocess.run(['node', 'dev-probe.mjs', script], capture_output=True, text=True, cwd=HARNESS, env=ENV)
    s = (r.stdout or '') + (r.stderr or '')
    i = s.find('{')
    try:
        return list(json.loads(s[i:]).values())[0]['check']
    except Exception as e:
        return {'__err': str(e), 'raw': s[-400:]}


os.makedirs(os.path.dirname(LOG), exist_ok=True)
open(LOG, 'w').close()
print('1) 临时 sshd：', sh('bash /vol1/1000/aicache/tmp/r47-sshd-up.sh 2>&1 | tail -1'))
print('   2222 监听数：', sh('ss -ltn | grep -c 2222'))
print('2) 启动 App + CDP 转发：')
sh('adb shell am start -n dev.hermes.pocket/.MainActivity')
time.sleep(7)
sock = sh("adb shell \"cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1\"").strip()
sh('adb forward --remove-all')
sh('adb forward tcp:9222 localabstract:%s' % sock)
print('   forward =', sock, '|', sh('curl -s --max-time 4 http://127.0.0.1:9222/json/version | head -2 | tr "\\n" " "'))
print('3) App 建 R58靶机（startCmd＝靶子）并连上：')
res = node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r58-app-host-20260929.mjs')
print(json.dumps(res, ensure_ascii=False, indent=1)[:1500])
print('4) 从 App 取 r58probe 公钥 → 授到临时 sshd（不碰 NAS）：')
kj = sh('adb exec-out run-as dev.hermes.pocket cat /data/data/dev.hermes.pocket/files/pocket/keys.json')
try:
    keys = json.loads(kj)
    k = next((x for x in keys if x.get('name') == KEYNAME), None)
    if k:
        with open(AUTH, 'a', encoding='utf-8') as f:
            f.write(k['publicKey'].strip() + '\n')
        print('   已授权 %s（%s）；authorized_keys 行数=%d' % (k.get('name'), k.get('fingerprint'), len(open(AUTH).read().splitlines())))
    else:
        print('   ！没找到 %s' % KEYNAME)
except Exception as e:
    print('   取密钥失败：', e)
print('   NAS ~/.ssh/authorized_keys：', sh('wc -l < ~/.ssh/authorized_keys; stat -c %y ~/.ssh/authorized_keys'))
print('5) 重连一次（让 startCmd 在新连接里打字进去）：')
print(json.dumps(node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r58-app-host-20260929.mjs'), ensure_ascii=False)[:900])
print('6) 靶子日志尾：', sh('tail -3 %s' % LOG) or '(空)')
print('   sshd 尾：', sh('tail -2 /tmp/r47probe-sshd/sshd.log'))
