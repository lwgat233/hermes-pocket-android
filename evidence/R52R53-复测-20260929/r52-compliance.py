#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R52R53 复测⑤：合规 —— 隐藏只标记、不毁权威源（台账字节/sha 前后一致）+ 测完 restore 回去。"""
import os
import subprocess
import sys

ROOT = '/vol1/1000/airesults/roles-chat'
MSG = sys.argv[1] if len(sys.argv) > 1 else '1870'


def sh(c):
    return subprocess.run(['bash', '-c', c], capture_output=True, text=True, cwd=ROOT).stdout.strip()


def ledger():
    n = sh("find talk -name '*.md' | wc -l")
    b = sh("find talk -name '*.md' -printf '%s\\n' | awk '{s+=$1} END {print s}'")
    h = sh("find talk -name '*.md' | sort | xargs cat 2>/dev/null | sha256sum | cut -c1-16")
    return {'files': n, 'bytes': b, 'sha16(有序拼接)': h}


def counts():
    total = sh('sqlite3 talk.db "select count(*) from msg"')
    visible = sh('sqlite3 talk.db "select count(*) from msg where hidden_by_user is null or hidden_by_user=0"')
    hidden = sh('sqlite3 talk.db "select count(*) from msg where hidden_by_user=1"')
    row = sh('sqlite3 talk.db "select count(*) from msg where id=%s"' % MSG)
    return {'总行数': total, '可见': visible, '隐藏': hidden, '目标行还在': row}


print('== 台账（前）==', ledger())
print('== 计数（前）==', counts())
print('== hide 命令 ==')
print(sh('python3 tools/talk.py hidden --id %s --action hide' % MSG)[:300])
print('== 台账（隐藏后）==', ledger())
print('== 计数（隐藏后）==', counts())
print('== since-json 默认 / --show-hidden ==')
print(sh('python3 tools/talk.py since-json --id %s 2>/dev/null | head -c 200' % MSG))
print(sh('python3 tools/talk.py since-json --id %s --show-hidden 2>/dev/null | head -c 200' % MSG))
print('== restore ==')
print(sh('python3 tools/talk.py hidden --id %s --action restore' % MSG)[:300])
print('== 台账（还原后）==', ledger())
print('== 计数（还原后）==', counts())
