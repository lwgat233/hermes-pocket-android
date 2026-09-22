#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打包盖章：每出一包，**自动**把这一包的版本串与打包时间写进 assets/build-info.json，
再把这份 JSON 盖进 ui/app.js 的 HP.BUILD / HP.BUILDINFO（界面与包内同源，不再手写常量）。

为什么这么做（F1）：以前版本串靠人手写，出包时忘了改，就会出现「设备上跑的这版
版本串还是上一包的时间」，测试者没法证明装的到底是哪一版。

用法：
  python3 tools/stamp-build.py                    # 打包自动跑：刷新版本串/打包时间 → 写 JSON → 盖进 app.js
  python3 tools/stamp-build.py --feature "…" --feature-id "F1" --note "…" [--acceptance "…"]
                                                  # 顺带把这一轮的人写字段换掉（不用手改 JSON）
  python3 tools/stamp-build.py --check            # 核对源里盖的是不是和 JSON 一致（不一致退出码 1）
  python3 tools/stamp-build.py --verify <apk>     # 核对包内读数：assets/build-info.json、ui/app.js 的 HP.BUILD、
                                                  # ui/ 下每个文件（含 talk.js）与源树逐个比哈希；不一致退出码 1

版本串形如 unified-20260923-011530（轮次名-日期-时分秒），打包时间形如 2026-09-23 01:15 CST，
都由本脚本按出包时刻生成 —— 同一天出几个包也不会重名。
"""
import argparse
import datetime
import hashlib
import io
import json
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # source/hermes-pocket
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
JSON_PATH = os.path.join(ASSETS, 'build-info.json')
UI_DIR = os.path.join(ASSETS, 'ui')
APP_JS = os.path.join(UI_DIR, 'app.js')
MARK_BEGIN = '  /* —— 打包信息（由 tools/stamp-build.py 从 assets/build-info.json 盖进来，别手改这一段）—— */'
MARK_END = '  /* —— 打包信息结束 —— */'
DEFAULT_PREFIX = 'unified'
CST = datetime.timezone(datetime.timedelta(hours=8))
PREFIX_RE = re.compile(r'^(.+?)-\d{8}-\d{4,6}[a-z]?$')


def now():
    return datetime.datetime.now(CST)


def new_version(old, prefix=None):
    """轮次名沿用上一包的（unified / kbd …），日期时间永远取这一次出包的时刻。"""
    name = prefix
    if not name:
        m = PREFIX_RE.match((old or '').strip())
        name = m.group(1) if m else DEFAULT_PREFIX
    return '%s-%s' % (name, now().strftime('%Y%m%d-%H%M%S'))


def build_block(info):
    return '\n'.join([
        MARK_BEGIN,
        '  HP.BUILD = %s;' % json.dumps(info['testVersion']),
        '  HP.BUILDINFO = %s;' % json.dumps(info, ensure_ascii=False, sort_keys=True).replace('"}', '"}'),
        MARK_END,
    ])


def find_block(text):
    """返回 (开始下标, 结束下标)；没有盖章块时按旧的裸 HP.BUILD 行找。"""
    if MARK_BEGIN in text:
        i = text.index(MARK_BEGIN)
        return i, text.index(MARK_END, i) + len(MARK_END)
    m = re.search(r"  /\* 本轮构建标记.*?\n  HP\.BUILD = '[^']*';\n", text, re.S)
    if not m:
        raise SystemExit('✗ ui/app.js 里找不到 HP.BUILD 那一行（也没找到盖章块）')
    return m.start(), m.end()


def load_json():
    with io.open(JSON_PATH, encoding='utf-8') as f:
        return json.load(f)


def save_json(info):
    with io.open(JSON_PATH, 'w', encoding='utf-8') as f:
        f.write(json.dumps(info, ensure_ascii=False, indent=2, sort_keys=False) + '\n')


def stamp(refresh=True, prefix=None, fields=None):
    info = load_json()
    if refresh:
        info['testVersion'] = new_version(info.get('testVersion'), prefix)
        info['builtAt'] = now().strftime('%Y-%m-%d %H:%M CST')
    for k, v in (fields or {}).items():
        if v:
            info[k] = v
    if refresh or fields:
        save_json(info)

    text = io.open(APP_JS, encoding='utf-8').read()
    i, j = find_block(text)
    old = text[i:j]
    new = build_block(info)
    if old.strip() == new.strip():
        print('盖章信息已是最新：%s（%s）' % (info['testVersion'], info.get('feature', '')))
        return info
    io.open(APP_JS, 'w', encoding='utf-8').write(text[:i] + new + text[j:])
    print('盖章完成：%s / %s / %s' % (info['testVersion'], info.get('featureId', ''), info['builtAt']))
    return info


def check():
    info = load_json()
    text = io.open(APP_JS, encoding='utf-8').read()
    i, j = find_block(text)
    if text[i:j].strip() != build_block(info).strip():
        print('✗ 源里盖的打包信息与 build-info.json **不一致**：先跑一次不带参数的盖章')
        return 1
    print('✓ 打包信息一致：%s（%s · 打包 %s）' % (info['testVersion'], info.get('feature', ''), info.get('builtAt', '')))
    return 0


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def source_ui_files():
    """源树 ui/ 下的全部文件（相对 assets/ 的路径），排序后返回。"""
    rels = []
    for dirpath, _dirnames, filenames in os.walk(UI_DIR):
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rels.append(os.path.relpath(full, ASSETS).replace(os.sep, '/'))
    return sorted(rels)


def verify(apk):
    """包内读数 ↔ 源树读数，逐个文件比。任何一条不一致就 FAIL（退出码 1）。"""
    info = load_json()
    ok = True

    with zipfile.ZipFile(apk) as z:
        names = set(z.namelist())
        print('包：%s' % apk)
        print('包 sha256：%s' % sha256_file(apk))
        print()
        print('=== ① 包内 build-info.json ↔ 源 build-info.json ===')
        raw = z.read('assets/build-info.json')
        in_apk = json.loads(raw.decode('utf-8'))
        same = in_apk == info
        ok &= same
        print('  包内 testVersion=%s builtAt=%s' % (in_apk.get('testVersion'), in_apk.get('builtAt')))
        print('  源   testVersion=%s builtAt=%s' % (info.get('testVersion'), info.get('builtAt')))
        print('  %s 两份逐字段相同' % ('✓' if same else '✗'))

        print()
        print('=== ② 包内 ui/app.js 的 HP.BUILD / HP.BUILDINFO ↔ 源 ===')
        apk_app = z.read('assets/ui/app.js').decode('utf-8')
        src_app = io.open(APP_JS, encoding='utf-8').read()
        m = re.search(r'HP\.BUILD = ("(?:[^"\\]|\\.)*");', apk_app)
        apk_build = json.loads(m.group(1)) if m else None
        hit = apk_build == info['testVersion']
        ok &= hit
        print('  包内 HP.BUILD = %s' % apk_build)
        print('  %s 与 build-info.testVersion 一致' % ('✓' if hit else '✗'))
        si, sj = find_block(src_app)
        ai, aj = find_block(apk_app)
        blk_src, blk_apk = src_app[si:sj].strip(), apk_app[ai:aj].strip()
        hit2 = blk_src == blk_apk
        ok &= hit2
        print('  %s 包内盖章块与源逐字节相同' % ('✓' if hit2 else '✗'))
        if not hit2:
            print('     源  ：%s' % blk_src[:400])
            print('     包内：%s' % blk_apk[:400])

        print()
        print('=== ③ 包内 ui/ 每个文件 ↔ 源（含 talk.js）===')
        for rel in source_ui_files():
            src = os.path.join(ASSETS, rel)
            apk_rel = 'assets/' + rel
            if apk_rel not in names:
                print('  ✗ %s：包里没有' % apk_rel)
                ok = False
                continue
            a, b = sha256_file(src), hashlib.sha256(z.read(apk_rel)).hexdigest()
            hit = a == b
            ok &= hit
            print('  %s %s\n     源  %s\n     包内%s' % ('✓' if hit else '✗', apk_rel, a, b))

    print()
    print('%s 包内 ↔ 源树 对账' % ('PASS' if ok else 'FAIL'))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(add_help=True, description='打包盖章 + 包内对账')
    ap.add_argument('--check', action='store_true', help='只核对源里盖的是不是和 JSON 一致')
    ap.add_argument('--verify', metavar='APK', help='核对包内读数与源树是否一致')
    ap.add_argument('--no-refresh', action='store_true', help='不刷新版本串/时间（重盖用）')
    ap.add_argument('--prefix', help='轮次名（默认沿用上一包的）')
    ap.add_argument('--feature', help='这一包做了什么（人写）')
    ap.add_argument('--feature-id', dest='feature_id', help='对应的功能/缺陷号（人写）')
    ap.add_argument('--note', help='给装包的人的一句话（人写）')
    ap.add_argument('--acceptance', help='这一包验过什么（人写）')
    a = ap.parse_args()

    if a.verify:
        sys.exit(verify(a.verify))
    if a.check:
        sys.exit(check())
    fields = {'feature': a.feature, 'featureId': a.feature_id, 'note': a.note, 'acceptance': a.acceptance}
    stamp(refresh=not a.no_refresh, prefix=a.prefix, fields=fields)
    sys.exit(check())


main()
