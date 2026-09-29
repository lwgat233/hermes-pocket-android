#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R49 复测 · 靶子通路：把 App 里那把测试密钥授到临时 sshd；在 App 建 R49靶机 并连上。"""
import json
import os
import subprocess
import time

P = 'emulator-5554'
HARNESS = '/home/lwgat/hermes-pocket/tools/ui-harness'
LOG = '/vol1/1000/airesults/hermes-pocket/evidence/R49-复测-20260929/靶子日志-原始.log'
AUTH = '/tmp/r47probe-sshd/authorized_keys'
KEYNAME = 'o14probe'
ENV = dict(os.environ, PATH='/home/lwgat/tools/android-sdk/platform-tools:/home/lwgat/.local/bin:' + os.environ.get('PATH', ''))


def sh(c):
    return subprocess.run(['bash', '-c', c], capture_output=True, text=True, env=ENV).stdout.strip()


def node(script):
    r = subprocess.run(['node', 'dev-probe.mjs', script], capture_output=True, text=True, cwd=HARNESS, env=ENV)
    s = r.stdout
    i = s.find('{')
    try:
        return list(json.loads(s[i:]).values())[0]['check']
    except Exception as e:
        return {'__err': str(e), 'raw': s[-300:]}


os.makedirs(os.path.dirname(LOG), exist_ok=True)
open(LOG, 'w').close()
try:
    os.remove('/tmp/r49-feed.trigger')
except FileNotFoundError:
    pass
print('1) 临时 sshd：')
print('  ', sh('bash /vol1/1000/aicache/tmp/r47-sshd-up.sh 2>&1 | tail -2'))
print('2) 从 App 取测试密钥公钥并授权到临时 sshd（不碰 NAS 的 authorized_keys）：')
kj = sh('adb exec-out run-as dev.hermes.pocket cat /data/data/dev.hermes.pocket/files/pocket/keys.json')
try:
    keys = json.loads(kj)
    k = next((x for x in keys if x.get('name') == KEYNAME), None) or keys[0]
    pub = k['publicKey']
    print('   用密钥：%s（%s）' % (k.get('name'), k.get('fingerprint')))
    with open(AUTH, 'a', encoding='utf-8') as f:
        f.write(pub.strip() + '\n')
    print('   已写入 %s；现在 authorized_keys 行数=%d' % (AUTH, len(open(AUTH).read().splitlines())))
    print('   本机 NAS ~/.ssh/authorized_keys：%s' % sh('wc -l < ~/.ssh/authorized_keys; stat -c %y ~/.ssh/authorized_keys'))
except Exception as e:
    print('   取密钥失败：', e)
print('3) App 建 R49靶机 并连上：')
res = node('/vol1/1000/airesults/hermes-pocket/tools/验收脚本/r49-app-host-20260929.mjs')
print(json.dumps(res, ensure_ascii=False, indent=1)[:1400])
time.sleep(3)
print('4) 靶子日志尾：')
print(sh('tail -3 %s' % LOG))
print('   sshd 尾：', sh('tail -2 /tmp/r47probe-sshd/sshd.log'))
