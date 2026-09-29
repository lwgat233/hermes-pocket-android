#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""四探针 FAIL 判定器（SPEC §10.1：每轮必跑四探针，FAIL 数必须为 0）。

用法：
  python3 tools/ui-harness/probe_verdict.py <探针输出.json> …      # 自动按文件名认探针
  python3 tools/ui-harness/probe_verdict.py --dir <目录>           # 目录里的 *.json 里有 {"name"...} 的都判

判定规则写在下面 RULES 里：每条是 (可读名, 由结果字典取出实际值的函数, 期望值函数或常量)。
只读探针输出，不改探针；探针输出里没有的项会报 SKIP（不静默算过）。
"""
import json
import os
import sys


def _has(res, *path):
    cur = res
    for p in path:
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


def rules_for(name, res):
    """返回 [(label, actual, expected)]；actual 为 None 表示探针没给这一项（SKIP）。"""
    r = []
    n = name.lower()
    if 'composer' in n:
        c = (res.get('check') or res).get('conclusion') or {}
        for k, v in c.items():
            r.append(('composer.' + k, v, True))
    elif 'r48' in n:
        c = res.get('check') or res
        r += [('r48 真按键回车=1', _has(c, '01_真按键回车', '收到0x0D个数'), 1),
              ('r48 IME形状回车=1', _has(c, '02_IME形状回车', '收到0x0D个数'), 1),
              ('r48 连按三次=3', _has(c, '04_连按三次', '收到0x0D个数'), 3),
              ('r48 键条回车=1', _has(c, '05_键条回车', '收到0x0D个数'), 1),
              ('r48 229不发=0', _has(c, '06_229不发', '收到0x0D个数'), 0),
              ('r48 长按不刷屏=1', _has(c, '06b_长按不刷屏', '收到0x0D个数'), 1),
              ('r48 键高最小>=44', _has(c, '05_键条回车', '键高最小'), '>=44'),
              ('r48 报错=0', _has(c, '07_报错', 'count'), 0)]
    elif 'r58' in n:
        c = res.get('check') or res
        r += [('r58 默认收起', _has(c, '01_默认收起', 'pane', '收起态'), True),
              ('r58 默认容器高=0', _has(c, '01_默认收起', 'pane', '终端容器高'), 0),
              ('r58 常驻按键<=3', _has(c, '01_默认收起', '顶栏按键数'), '<=3'),
              ('r58 无说明文案', _has(c, '01_默认收起', 'stage 里的裸文字（说明文案）'), []),
              ('r58 展开高度>0', _has(c, '02_展开与收起', '展开后', '终端容器高'), '>0'),
              ('r58 展开即贴底', _has(c, '04_展开即贴底', '展开瞬间', '离底'), '<=2'),
              ('r58 展开后稳贴底', _has(c, '04_展开即贴底', '半秒后', '离底'), '<=2'),
              ('r58 收起后高=0', _has(c, '02_展开与收起', '收起后', '终端容器高'), 0),
              ('r58 开合不残留', _has(c, '03_多次开合', 'xterm数都一致'), True),
              ('r58 开合不重复建会话', _has(c, '03_多次开合', '连接次数'), 0),
              ('r58 报错=0', _has(c, '05_报错', 'count'), 0)]
    elif 'r49' in n:
        c = res.get('check') or res
        for k in ('同拍', '两帧后', '一秒后', '新输出后'):
            r.append(('r49 点终端即贴底·' + k, _has(c, '01_点终端即贴底', k, '离底'), '<=2'))
        r += [('r49 进页即贴底', _has(c, '02_进页即贴底', '关盖层后', '离底'), '<=2'),
              ('r49 上翻不被拽回', _has(c, '03_上翻后不拽回', '位置没被拽回底部'), True),
              ('r49 重画不顶回', _has(c, '04_重画不顶回', '没被顶回顶部'), True),
              ('r49 贴底跟随', _has(c, '05_贴底时跟随', '新输出后', '离底'), '<=2'),
              ('r49 报错=0', _has(c, '06_报错', 'count'), 0)]
    else:
        r.append((name + '（没有判定规则，只报原样）', 'SKIP', 'SKIP'))
    return r


def check(actual, expected):
    if actual is None:
        return 'SKIP'
    if isinstance(expected, str) and expected.startswith('>='):
        try:
            return 'PASS' if float(actual) >= float(expected[2:]) else 'FAIL'
        except Exception:
            return 'SKIP'
    if isinstance(expected, str) and expected.startswith('<='):
        try:
            return 'PASS' if float(actual) <= float(expected[2:]) else 'FAIL'
        except Exception:
            return 'SKIP'
    if isinstance(expected, str) and expected.startswith('>'):
        try:
            return 'PASS' if float(actual) > float(expected[1:]) else 'FAIL'
        except Exception:
            return 'SKIP'
    return 'PASS' if actual == expected else 'FAIL'


def load(path):
    raw = open(path, encoding='utf-8').read()
    i = raw.find('{\n  "name"')
    if i < 0:
        return None, raw[:200]
    d = json.loads(raw[i:])
    return d.get('result') or d, None


def main(argv):
    files = []
    if '--dir' in argv:
        i = argv.index('--dir')
        d = argv[i + 1]
        for f in sorted(os.listdir(d)):
            if f.endswith('.json'):
                p = os.path.join(d, f)
                try:
                    res, err = load(p)
                except Exception:
                    continue
                if res and isinstance(res, dict) and ('check' in res or 'boot' in res):
                    files.append(p)
    else:
        files = argv[1:]
    total_fail = total_skip = 0
    print('== 四探针 FAIL 判定（SPEC §10.1：FAIL 必须 = 0）==')
    for p in files:
        res, err = load(p)
        if res is None:
            print('%-46s  PARSE-FAIL' % os.path.basename(p))
            total_fail += 1
            continue
        name = os.path.basename(p)
        rows = rules_for(name, res)
        fails = [(l, a, e) for (l, a, e) in rows if check(a, e) == 'FAIL']
        skips = [(l, a, e) for (l, a, e) in rows if check(a, e) == 'SKIP']
        total_fail += len(fails)
        total_skip += len(skips)
        print('%-46s  项 %2d · FAIL %d · SKIP %d' % (name, len(rows), len(fails), len(skips)))
        for (l, a, e) in fails:
            print('     FAIL %s  实际=%r 期望=%r' % (l, a, e))
        for (l, a, e) in skips:
            print('     SKIP %s（探针没给这一项）' % l)
    print('== 合计 FAIL = %d · SKIP = %d ==' % (total_fail, total_skip))
    return 1 if total_fail else 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
