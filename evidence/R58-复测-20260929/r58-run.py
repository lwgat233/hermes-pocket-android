#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""跑一个验收 .mjs 并把结果打印成紧凑表（去掉 node 的额外输出）"""
import json
import subprocess
import sys

HARNESS = '/home/lwgat/hermes-pocket/tools/ui-harness'
ENV = {'PATH': '/home/lwgat/.local/bin:/usr/bin:/bin', 'HOME': '/home/lwgat'}
script = sys.argv[1]
r = subprocess.run(['node', 'dev-probe.mjs', script], capture_output=True, text=True, cwd=HARNESS, env=ENV)
s = (r.stdout or '') + (r.stderr or '')
open('/tmp/r58-last-run.txt', 'w', encoding='utf-8').write(s)
out = {'__exit': r.returncode}
i = s.find('{')
j = s.rfind('}')
if i >= 0 and j > i:
    try:
        d = json.loads(s[i:j + 1])
        for k, v in d.items():
            if k == 'pageErrors':
                out['pageErrors'] = v
            elif isinstance(v, dict):
                out.update(v.get('check') or {'error': v.get('error')})
    except Exception as e:
        out['__parse'] = str(e); out['__raw'] = s[-800:]
else:
    out['__raw'] = s[-500:]
for k in sorted(out):
    v = out[k]
    print('%-20s %s' % (k, json.dumps(v, ensure_ascii=False)[:320] if not isinstance(v, str) else v[:320]))
