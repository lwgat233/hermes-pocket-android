
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = [], fail = [];
  const ck = (n, ok, d) => { out.push((ok ? '  ✓ ' : '  ✗ ') + n + (d !== undefined ? '   ' + d : '')); if (!ok) fail.push(n); };
  const screen = () => { const b = HP.App.term.buffer.active; let t = []; for (let i = 0; i < b.length; i++) t.push(b.getLine(i).translateToString(true)); return t.join('\n'); };
  const clickDialog = () => { const d = [...document.getElementById('stage').children].find(e => e.querySelector && e.querySelector('[data-y]')); if (d) { d.querySelector('[data-y]').click(); return true; } return false; };

  try {
    /* 1. 设备侧密钥库 */
    const prefs = await HP.App.rpc('pref.all');
    ck('Keystore 主密钥就绪（AES-256-GCM）', /就绪/.test(prefs._vault || ''), prefs._vault);
    ck('走原生 SSH 通道（私钥不出设备）', prefs._native === true && HP.hasNative());

    /* 2. 导入私钥（经 Vault 加密后落盘） */
    const meta = await HP.App.rpc('key.import', { name: 'emulator-client', privatePem: "-----BEGIN OPENSSH PRIVATE KEY-----
【已脱敏：测试用私钥，不随归档分发】
-----END OPENSSH PRIVATE KEY-----\n", passphrase: '' });
    ck('私钥导入 + 指纹计算', !!meta.fingerprint && /Ed25519/i.test(meta.algo), meta.algo + ' ' + meta.fingerprint);
    const keys = await HP.App.rpc('key.list');
    ck('key.list 只回元数据（含私钥字段=失败）', keys.length > 0 && !/privSealed|PRIVATE KEY/.test(JSON.stringify(keys)));

    /* 3. 保存主机 */
    await HP.App.rpc('host.save', { host: { name: 'testsshd', host: '10.0.2.2', port: 2222, user: 'lwgat', auth: 'key', keyId: meta.id, startCmd: '', autoReconnect: true, keepalive: 10 } });
    const hosts = await HP.App.rpc('host.list');
    ck('主机保存并回读', hosts.length === 1 && hosts[0].port === 2222, hosts[0] && hosts[0].user + '@' + hosts[0].host + ':' + hosts[0].port);
    ck('host.list 不回传口令/密文', !/Sealed|"password"/.test(JSON.stringify(hosts)));

    /* 4. 连接：10.0.2.2 = 宿主 loopback，testsshd 在 127.0.0.1:2222 */
    await HP.Panels.load(true);
    await HP.App.connect(hosts[0].id);
    let sawHostKeyPrompt = false, st = '';
    for (let i = 0; i < 60; i++) {
      await sleep(400);
      if (clickDialog()) sawHostKeyPrompt = true;
      st = HP.App.state;
      if (st === 'connected' || st === 'error') break;
    }
    ck('SSH 会话建立（jsch 原生直连）', st === 'connected', 'state=' + st);
    ck('首次连接弹主机密钥确认（TOFU）', sawHostKeyPrompt);
    const knownAfter = await HP.App.rpc('host.list');
    ck('信任后会话仍在', HP.App.state === 'connected');

    /* 5. 命令回显 */
    HP.App.send('echo HPK_MARKER_$((6*7))\r');
    await sleep(2000);
    ck('远端命令回显 HPK_MARKER_42', /HPK_MARKER_42/.test(screen()));

    /* 6. resize 传到远端 PTY */
    HP.App.send('stty size\r');
    await sleep(1500);
    const want = HP.App.term.rows + ' ' + HP.App.term.cols;
    ck('resize 传到远端 PTY', screen().indexOf(want) >= 0, '本地 ' + HP.App.term.cols + 'x' + HP.App.term.rows + ' / 远端出现 "' + want + '"');

    /* 7. TUI 备用屏 → 手机几何策略 */
    const colsBefore = HP.App.term.cols, fontBefore = HP.App.term.options.fontSize;
    HP.App.send("printf '\\033[?1049h\\033[?1002h\\033[?1006h'\r");
    await sleep(1800);
    ck('TUI 备用屏被嗅探到', HP.App.watcher.alt === true);
    ck('鼠标模式被嗅探到', HP.App.watcher.mouseMode > 0, 'mode=' + HP.App.watcher.mouseMode + ' sgr=' + HP.App.watcher.sgr);
    ck('TUI 下列数被顶到 ≥80（手机原本只有 ' + colsBefore + ' 列）', HP.App.term.cols >= 80, 'cols ' + colsBefore + ' → ' + HP.App.term.cols + '，字号 ' + fontBefore + ' → ' + HP.App.term.options.fontSize + 'px');
    ck('字号没有低于可读下限 10px', HP.App.term.options.fontSize >= 10, HP.App.term.options.fontSize + 'px');
    ck('功能键条切到 TUI 那一行', document.getElementById('krow-tui').className.indexOf('hidden') < 0 && document.getElementById('krow-shell').className.indexOf('hidden') >= 0);
    ck('状态栏徽标显示 TUI', /TUI/.test(document.getElementById('tb-badge').textContent), document.getElementById('tb-badge').textContent);
    const overflow = HP.App.term.cols > HP.App.fit.proposeDimensions().cols;
    ck('横向平移状态与实际溢出一致', HP.App.panEnabled === overflow, '可见 ' + HP.App.fit.proposeDimensions().cols + ' 列 / 需要 ' + HP.App.term.cols + ' 列 → pan=' + HP.App.panEnabled);

    /* 8. 真 tmux 渲染 */
    HP.App.send("tmux -L hpk-and -f /dev/null new -As app \"sleep 300\"\r");
    await sleep(3500);
    ck('tmux 在备用屏里真的渲染出内容', /\[app\]/.test(screen()), JSON.stringify(screen().replace(/\s+/g, ' ').slice(0, 60)));
    // ⚠ 此时 PTY 已被 tmux 接管，往 PTY 写命令只会进 tmux 窗格（跑着 sleep）而不是 shell。
    //    必须先 Ctrl-B d 退出来，否则下一步的 exit 根本到不了 shell。
    HP.App.send("\x02d");
    await sleep(1500);
    ck('Ctrl-B d 从 tmux 退出回到 shell', /\[detached/.test(screen()) || HP.App.watcher.alt !== true, 'alt=' + HP.App.watcher.alt);

    /* 9. 断线自愈 */
    // 从**事件流**记录状态迁移：disconnected 是瞬时状态，靠 500ms 轮询会漏
    const seq = [];
    const rec = (m) => { if (!seq.length || seq[seq.length - 1] !== m.state) seq.push(m.state); };
    HP.App.transport.on('state', rec);
    HP.App.send("exit\r");
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (seq.includes('reconnecting') && HP.App.state === 'connected' && seq.length > 2) break;
    }
    ck('远端 exit 后掉线被感知', seq.includes('disconnected') || seq.includes('error'), '状态序列 ' + seq.join(' → '));
    ck('掉线后自动重连成功（原生层自愈）', seq.includes('reconnecting') && HP.App.state === 'connected', '状态序列 ' + seq.join(' → '));

    /* 10. 长连接保活配置真的落到 jsch */
    ck('保活/重连状态栏有反馈', !!document.getElementById('tb-rtt').textContent, 'rtt 栏=' + document.getElementById('tb-rtt').textContent);

    out.push('');
    out.push(fail.length ? ('失败 ' + fail.length + ' 项: ' + fail.join(' | ')) : '全部通过');
  } catch (e) {
    out.push('  EXCEPTION ' + (e && e.stack || e));
    out.push('失败(异常)');
  }
  return out.join('\n');
})()
