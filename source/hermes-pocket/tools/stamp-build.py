#!/usr/bin/env python3
"""打包盖章：把 assets/build-info.json 的内容盖进 ui/app.js（界面版本串从这份 JSON 来，不再手写死）。
用法：python3 tools/stamp-build.py            # 按 build-info.json 盖章
      python3 tools/stamp-build.py --check    # 只核对已盖的是不是和 JSON 一致（打包前必跑）
为什么不用 fetch 读 JSON：本地测试台是 file:// 打开 index.html，fetch 会被浏览器挡掉，
界面就只会在测试台上显示不出真实版本 —— 盖进源里两边一致，JSON 仍打进包供外部核对。
"""
import io, json, re, sys

ROOT = '/home/lwgat/hermes-pocket'
JSON = ROOT + '/app/src/main/assets/build-info.json'
APP = ROOT + '/app/src/main/assets/ui/app.js'
开始 = '  /* —— 打包信息（由 tools/stamp-build.py 从 assets/build-info.json 盖进来，别手改这一段）—— */'
结束 = '  /* —— 打包信息结束 —— */'


def 块(info):
    return '\n'.join([
        开始,
        "  HP.BUILD = %s;" % json.dumps(info['testVersion']),
        "  HP.BUILDINFO = %s;" % json.dumps(info, ensure_ascii=False, sort_keys=True).replace('"}', '"}'),
        结束,
    ])


def main():
    info = json.load(io.open(JSON, encoding='utf-8'))
    t = io.open(APP, encoding='utf-8').read()
    新 = 块(info)
    if 开始 in t:
        i = t.index(开始); j = t.index(结束) + len(结束)
        旧块 = t[i:j]
    else:                                     # 首次：替换旧的裸 HP.BUILD 行（含它上面的注释行）
        m = re.search(r"  /\* 本轮构建标记.*?\n  HP\.BUILD = '[^']*';\n", t, re.S)
        assert m, '找不到 HP.BUILD 那一行'
        旧块 = m.group(0)
        i, j = m.start(), m.end()
    if '--check' in sys.argv:
        if 旧块.strip() != 新.strip():
            print('✗ 源里的打包信息与 build-info.json **不一致**，先跑一次不带参数的盖章'); sys.exit(1)
        print('✓ 打包信息一致：%s（%s）' % (info['testVersion'], info['feature'])); return
    if 旧块.strip() == 新.strip():
        print('已是最新：%s' % info['testVersion']); return
    io.open(APP, 'w', encoding='utf-8').write(t[:i] + 新 + t[j:])
    print('盖章完成：%s / %s / %s' % (info['testVersion'], info['featureId'], info['builtAt']))


main()
