#!/usr/bin/env python3
"""把 Bridge.kt 里的网络诊断命令**原样抽出来跑一遍**（ping 那条 shell 命令 + net.tcp 里的 python），
并把真实输出写进测试台的样本文件 `tools/ui-harness/fixtures/net-samples.json` —— 解析器就拿真样本断言，
不靠我手写的"看起来像"的输出。

只打回环和保留地址（192.0.2.1 = TEST-NET-1，不会真发到外网），不碰任何真实外部主机。
"""
import io, json, os, re, subprocess, sys, pathlib

KT = pathlib.Path(__file__).resolve().parents[1] / 'app/src/main/java/dev/hermes/pocket/Bridge.kt'
src = io.open(KT, encoding='utf-8').read()


def grab(name):
    m = re.search(r'val ' + name + r' = """(.*?)"""\.trimIndent\(\)', src, re.S)
    if not m:
        raise SystemExit('没在 Bridge.kt 里找到 ' + name)
    return m.group(1).replace("${'$'}", '$')


def grab_ping_cmd():
    m = re.search(r'exec\("(LC_ALL=C ping[^"]*)"', src)
    if not m:
        raise SystemExit('没在 Bridge.kt 里找到 ping 命令')
    return m.group(1)


def sh(cmd, timeout=60):
    p = subprocess.run(['bash', '-lc', cmd], capture_output=True, text=True, timeout=timeout)
    return p.stdout


def py(script, timeout=60):
    p = subprocess.run(['python3', '-'], input=script, capture_output=True, text=True, timeout=timeout)
    return p.stdout + (('\n[stderr] ' + p.stderr.strip()) if p.stderr.strip() else '')


ping_cmd = grab_ping_cmd()
tcp_py = grab('TCP_PY')
print('抽到的 ping 命令 :', ping_cmd)
print('抽到的 python 片段长度 :', len(tcp_py), '字符')

样本 = {}
样本['ping_loopback'] = sh(ping_cmd.replace('$n', '3').replace('$host', '127.0.0.1'))
样本['ping_丢失100'] = sh(ping_cmd.replace('$n', '2').replace('$host', '192.0.2.1'))
样本['ping_域名解析失败'] = sh(ping_cmd.replace('$n', '1').replace('$host', 'no-such-host.invalid'))
样本['ping_不行时也要有输出'] = ('有输出' if 样本['ping_丢失100'].strip() else '没输出')

# TCP：真连本机 22（Hermes 这台机器开着 sshd）与一个没人听的端口
样本['tcp_本机22'] = py('HOST = "127.0.0.1"\nPORT = 22\n' + tcp_py)
样本['tcp_没人听'] = py('HOST = "127.0.0.1"\nPORT = 9\n' + tcp_py)

print('\n--- ping 回环（真实输出）---\n' + 样本['ping_loopback'])
print('--- ping 全丢包 ---\n' + 样本['ping_丢失100'])
print('--- ping 域名错 ---\n' + 样本['ping_域名解析失败'])
print('--- tcp 22 ---\n' + 样本['tcp_本机22'].strip())
print('--- tcp 9 ---\n' + 样本['tcp_没人听'].strip())

out = pathlib.Path(__file__).resolve().parents[1] / 'tools/ui-harness/fixtures/net-samples.json'
out.parent.mkdir(parents=True, exist_ok=True)
io.open(out, 'w', encoding='utf-8').write(json.dumps(样本, ensure_ascii=False, indent=2) + '\n')
print('\n样本已写入:', out)

ok = ('rtt min/avg/max' in 样本['ping_loopback'] and '% packet loss' in 样本['ping_loopback']
      and '100% packet loss' in 样本['ping_丢失100'] and 'Name or service not known' in 样本['ping_域名解析失败']
      and '@@OK 1' in 样本['tcp_本机22'] and '@@OK 0' in 样本['tcp_没人听'])
print('\n结论:', '全部通过' if ok else '有失败')
sys.exit(0 if ok else 1)
