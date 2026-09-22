#!/usr/bin/env python3
"""把 Bridge.kt 里跟 skill 有关的两段远端 python 原样抽出来跑一遍（读 + 带 sha 对账的写）。

直接在**临时 HOME** 上跑（真 ~/.hermes 不动）：先造一个 skills/tmp-x/SKILL.md，
读 → 校验 sha/size/正文一致；写 → 校验 sha 对账（改过就拒）、备份、读回；再拿旧 sha 写 → 必须被拒。
"""
import io, os, re, subprocess, sys, tempfile, shutil, hashlib, base64, pathlib

KT = pathlib.Path(__file__).resolve().parents[1] / 'app/src/main/java/dev/hermes/pocket/Bridge.kt'
src = io.open(KT, encoding='utf-8').read()


def grab(name):
    m = re.search(r'val ' + name + r' = """(.*?)"""\.trimIndent\(\)', src, re.S)
    if not m:
        raise SystemExit('没在 Bridge.kt 里找到 ' + name)
    return m.group(1).replace("${'$'}", '$')


def run(script, home):
    env = dict(os.environ); env['HOME'] = home
    p = subprocess.run(['python3', '-'], input=script, capture_output=True, text=True, env=env, timeout=60)
    return p.stdout, p.stderr


def sect(out, key):
    m = re.search(r'@@' + key + r'[ \t]?(.*)', out)
    return m.group(1).strip() if m else ''


tmp = tempfile.mkdtemp(prefix='hpk-skill-')
os.makedirs(os.path.join(tmp, '.hermes/skills/tmp-x'), exist_ok=True)
真实 = ('---\nname: tmp-x\ndescription: 试一下\n---\n\n# 标题\n\n正文一行\n中文与 emoji ✅\n').encode('utf-8')
open(os.path.join(tmp, '.hermes/skills/tmp-x/SKILL.md'), 'wb').write(真实)

ok = True
print('=== SKILL_READ_PY（读：sha / 字节数 / 正文）===')
out, err = run('REL = "skills/tmp-x/SKILL.md"\n' + grab('SKILL_READ_PY'), tmp)
size, sha = sect(out, 'SIZE'), sect(out, 'SHA')
body = base64.b64decode((re.search(r'@@B64\n(.*)', out) or [None, ''])[1].strip())
print('@@SIZE', size, '/ @@SHA', sha[:12], '/ 正文', len(body), '字节')
ok = ok and size == str(len(真实)) and sha == hashlib.sha256(真实).hexdigest() and body == 真实
if err.strip():
    print('stderr:', err.strip()[:200]); ok = False

print('\n=== SKILL_WRITE_PY（写：对账 -> 备份 -> 读回）===')
新 = 真实 + '加了一行\n'.encode('utf-8')
script = 'REL = "skills/tmp-x/SKILL.md"\nEXPECT = "%s"\nB64 = "%s"\n' % (sha, base64.b64encode(新).decode()) + grab('SKILL_WRITE_PY')
out, err = run(script, tmp)
print(out.strip())
good = sect(out, 'OK') == '1' and sect(out, 'NEW') == hashlib.sha256(新).hexdigest() and sect(out, 'BAK')
disk = open(os.path.join(tmp, '.hermes/skills/tmp-x/SKILL.md'), 'rb').read()
ok = ok and good and disk == 新
print('盘上内容 == 写进去的:', disk == 新)
if err.strip():
    print('stderr:', err.strip()[:200]); ok = False

print('\n=== 对账失败必须拒绝（拿旧 sha 再写一次）===')
out, err = run(script, tmp)
print(out.strip())
ok = ok and sect(out, 'ERR') != ''
print('盘上内容没被动:', open(os.path.join(tmp, '.hermes/skills/tmp-x/SKILL.md'), 'rb').read() == 新)

print('\n结论:', '全部通过' if ok else '有失败')
shutil.rmtree(tmp, ignore_errors=True)
sys.exit(0 if ok else 1)
