#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R58/R49 靶子（在宿主的 tmux 会话里跑；App 会 attach 这个会话）：
· 自己把 tty 设成"无回显/无规范/保留 CR"（ICANON/ECHO/ICRNL 关掉）
· 记 stdin 收到的字节（数 0x0D）→ $R49_LOG
· 由 /tmp/r49-feed.trigger（内容＝行数，mtime 变化即触发）往 stdout 吐行
· 首次打 INIT 行（默认 300）⇒ 内容超一屏
行格式与作者配方一致：`终端靶子-%03d HH:MM:SS 行号=%d`（页面上一眼认出跑的是靶子）
"""
import os
import select
import sys
import termios
import time

LOG = os.environ.get('R49_LOG', '/tmp/r49-probe.log')
TRIG = '/tmp/r49-feed.trigger'
INIT = int(os.environ.get('R49_INIT', '300'))
try:
    os.remove(TRIG)
except FileNotFoundError:
    pass


def logmsg(s):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(s + '\n')


def emit(n, tag, base=1):
    for i in range(base, base + n):
        sys.stdout.write('终端靶子-%s%03d %s 行号=%d\r\n' % (tag, i, time.strftime('%H:%M:%S'), i))
    sys.stdout.flush()


fd = sys.stdin.fileno()
a = termios.tcgetattr(fd)
a[3] &= ~(termios.ICANON | termios.ECHO | termios.ICRNL)
a[6][termios.VMIN] = 1
a[6][termios.VTIME] = 0
termios.tcsetattr(fd, termios.TCSANOW, a)
logmsg('== start %s（icanon=off echo=off icrnl=off）==' % time.strftime('%H:%M:%S'))
emit(INIT, '', 1)
n = INIT
cr = 0
nbytes = 0
last = 0.0
lastauto = time.time()
while True:
    r, _w, _x = select.select([sys.stdin], [], [], 0.25)
    if r:
        b = os.read(fd, 8192)
        if not b:
            logmsg('== EOF ==')
            break
        nbytes += len(b)
        cr += b.count(b'\x0d')
        logmsg('RX %d 字节 0x0D=%d 本批hex=%s' % (len(b), b.count(b'\x0d'), b.hex()))
    else:
        try:
            m = os.stat(TRIG).st_mtime
        except FileNotFoundError:
            continue
        if m != last:
            last = m
            try:
                k = int(open(TRIG).read().strip() or '40')
            except Exception:
                k = 40
            logmsg('== feed %d 行（累计 RX %d 字节 / 0x0D %d）==' % (k, nbytes, cr))
            emit(k, '追加', n + 1)
            n += k
        # 自动追加（R49_AUTO 秒一行，给"封底跟随/上翻不被拽回"用）
        try:
            au = float(os.environ.get('R49_AUTO', '0') or '0')
        except Exception:
            au = 0
        if au > 0 and (time.time() - lastauto) >= au:
            lastauto = time.time()
            emit(1, '追加', n + 1)
            n += 1
