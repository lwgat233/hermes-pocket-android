#!/usr/bin/env python3
"""把 Bridge.kt 里的四段远端 python **原样**抽出来跑一遍（证明脚本本身是对的，不是"复制一份来测"）。

用法: python3 tools/check_bridge_py.py            # 只读那两段（提示词/模型）
      python3 tools/check_bridge_py.py --write    # 额外在**临时 HOME** 上试写 + 还原（不动真 config.yaml）
"""
import io, os, re, subprocess, sys, tempfile, shutil, pathlib

KT = pathlib.Path(__file__).resolve().parents[1] / 'app/src/main/java/dev/hermes/pocket/Bridge.kt'
src = io.open(KT, encoding='utf-8').read()

def grab(name):
    m = re.search(r'val ' + name + r' = """(.*?)"""\.trimIndent\(\)', src, re.S)
    if not m:
        raise SystemExit('没在 Bridge.kt 里找到 ' + name)
    # Kotlin 里 ${'$'} 是转义过的 $，跑之前还原
    return m.group(1).replace("${'$'}", '$')

def run(script, home=None, env_extra=None):
    env = dict(os.environ)
    if home:
        env['HOME'] = home
    env.update(env_extra or {})
    p = subprocess.run(['python3', '-'], input=script, capture_output=True, text=True, env=env, timeout=60)
    return p.stdout.strip(), p.stderr.strip()

ok = True
print('=== PROMPT_PY（读系统提示词）===')
out, err = run('OFF = 1\nN = 300\n' + grab('PROMPT_PY'))
print('\n'.join(out.split('\n')[:6]))
ok = ok and '@@STAT' in out and '@@TEXT' in out and len(out.split('@@TEXT\n')[-1]) > 100

print('\n=== MODEL_READ_PY（读模型）===')
out, err = run(grab('MODEL_READ_PY'))
print(out)
ok = ok and '@@MODEL' in out

if '--write' in sys.argv:
    tmp = tempfile.mkdtemp(prefix='hpk-model-')
    os.makedirs(os.path.join(tmp, '.hermes'), exist_ok=True)
    shutil.copy2(os.path.expanduser('~/.hermes/config.yaml'), os.path.join(tmp, '.hermes/config.yaml'))
    for f in ('provider_models_cache.json',):
        s = os.path.expanduser('~/.hermes/' + f)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(tmp, '.hermes/' + f))
    print('\n=== MODEL_WRITE_PY（在临时 HOME 上试写，真 config.yaml 不动）===')
    out, err = run('NEW = "hpk-test-model"\n' + grab('MODEL_WRITE_PY'), home=tmp)
    print(out)
    ok = ok and '@@OK 1' in out and '@@YAML ok' in out
    print('\n=== 读回 ===')
    out2, _ = run(grab('MODEL_READ_PY'), home=tmp)
    print('\n'.join([l for l in out2.split('\n') if l.startswith('@@MODEL') or l.startswith('@@BAKS')]))
    ok = ok and '@@MODEL hpk-test-model' in out2
    print('\n=== MODEL_UNDO_PY（还原）===')
    out3, _ = run(grab('MODEL_UNDO_PY'), home=tmp)
    print(out3)
    ok = ok and '@@OK 1' in out3
    out4, _ = run(grab('MODEL_READ_PY'), home=tmp)
    print('\n还原后：' + '\n'.join([l for l in out4.split('\n') if l.startswith('@@MODEL')]))
    ok = ok and '@@MODEL deepseek-v4-flash' in out4
    shutil.rmtree(tmp, ignore_errors=True)

print('\n结论:', '全部通过' if ok else '有失败')
sys.exit(0 if ok else 1)
