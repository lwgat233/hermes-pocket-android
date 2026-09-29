#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""R49 靶子：记 stdin 收到的字节（数 0x0D）＋ 可由宿主触发吐行（给"新输出"用）
触发文件：/tmp/r49-feed.trigger，内容＝要吐的行数（默认 40），mtime 变化即触发一次。
"""
import os
import select
import sys
import time

LOG = os.environ.get('R49_LOG', '/tmp/r49-probe.log')
TRIG = '/tmp/r49-feed.trigger'
try:
    os.remove(TRIG)
except FileNotFoundError:
    pass


def logmsg(s):
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(s + '\n')


def emit(n, tag):
    for i in range(n):
        sys.stdout.write('OUT-%s-%03d ............................\r\n' % (tag, i))
    sys.stdout.flush()


logmsg('== start %s ==' % time.strftime('%H:%M:%S'))
emit(int(os.environ.get('R49_INIT', '150')), 'init')
cr = 0
nbytes = 0
last = 0.0
while True:
    r, _w, _x = select.select([sys.stdin], [], [], 0.25)
    if r:
        b = os.read(sys.stdin.fileno(), 8192)
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
                n = int(open(TRIG).read().strip() or '40')
            except Exception:
                n = 40
            logmsg('== feed %d 行（累计 RX %d 字节 / 0x0D %d）==' % (n, nbytes, cr))
            emit(n, 'feed')
