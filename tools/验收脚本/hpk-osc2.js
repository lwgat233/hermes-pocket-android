(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = [];
  try {
    const calls = [];
    const orig = HP.App.notifyEvent.bind(HP.App);
    HP.App.notifyEvent = (k, t, b, u) => { calls.push({ k, t, b, u }); return orig(k, t, b, u); };

    HP.App.send('clear; printf "\\033]777;notify;标题T;正文B\\a"; sleep 1; echo LINE-AFTER\r');
    await sleep(3000);
    out.push('notifyEvent 被调用: ' + JSON.stringify(calls));
    out.push('notifyOsc 开关 = ' + HP.App.bool('notifyOsc', true));

    // 再直接调一次，看返回值
    const r = await HP.App.rpc('app.notify', { kind: 'osc', title: '直调标题', body: '直调正文', urgent: true }, 8000);
    out.push('直接 rpc app.notify(osc) → ' + JSON.stringify(r));

    // 再用 notifyEvent 走一遍
    HP.App.notifyEvent('osc', '走notifyEvent的标题', '走notifyEvent的正文', true);
    await sleep(800);
    out.push('（上面这几次都会往通知栏丢，下面看 dumpsys）');
  } catch (e) { out.push('EXCEPTION ' + (e && e.stack || e)); }
  return out.join('\n');
})()
