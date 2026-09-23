/* R-27 验收探针：网络统计留存与聚合（零新增采集）+ 定时探测设置项（默认关、省电档不跑）
 * 走真路径：HP.Panels.runPing/runTcp（真按键同一条路）、HP.App.onState（原生 state 事件）、HP.NetStats 的读数。
 * net.ping / net.tcp 的回包用平台真夹具（evidence/网络与流量/fixtures/net-samples.json）。
 *
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r27-netstats.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(HERE, '../../../../evidence/网络与流量/fixtures/net-samples.json');
const samples = JSON.parse(fs.readFileSync(FIX, 'utf8'));

export default {
  name: 'R-27 验收：ping/端口历史留存、按天聚合、连接计数、RTT 历史、定时探测默认关',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });

    const out = {};

    /* 装假桥：net.ping / net.tcp 回平台真夹具；顺手计数所有 net.* 调用 */
    await page.evaluate(({ pingText, tcpText }) => {
      window.__r27 = { ping: 0, tcp: 0, all: {} };
      window.__r27Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (!m) return window.__r27Orig(t);
        if (m.t && m.t.indexOf('net.') === 0) { window.__r27.all[m.t] = (window.__r27.all[m.t] || 0) + 1; }
        if (m.t === 'net.ping') { window.__r27.ping++; setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { raw: pingText, ms: 1280 } }) }), 20); return; }
        if (m.t === 'net.tcp') { window.__r27.tcp++; setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: { raw: tcpText, ms: 32 } }) }), 20); return; }
        return window.__r27Orig(t);
      };
      HP.NetStats.clear();                       /* 从干净状态开始 */
      window.__r27 = window.__r27;
      window.__r27.all = {};
    }, { pingText: samples['ping_loopback'], tcpText: samples['tcp_本机22'] });

    /* ① 跑 3 次 ping + 1 次端口（真路径 runPing/runTcp） */
    out['①_三次ping与一次端口'] = await page.evaluate(async () => {
      const P = HP.Panels;
      for (let i = 0; i < 3; i++) { await P.runPing(); await new Promise((r) => setTimeout(r, 120)); }
      await P.runTcp();
      const st = HP.NetStats.report();
      const times = HP.NetStats.recent('ping', 10).map((p) => p.at).reverse();
      return {
        ping条数: st.ping.n, 端口条数: st.tcp.n,
        平均丢包: st.ping.lossAvg, 平均延迟: st.ping.avgAvg, 最差: st.ping.maxMax,
        端口通: st.tcp.ok, 端口成功率: st.tcp.rate,
        时间递增: times.every((t, i) => i === 0 || t >= times[i - 1]),
        真发了网络调用: { ping: window.__r27.ping, tcp: window.__r27.tcp }
      };
    });

    /* ② 落盘：清掉内存再读，条数还在（等价于重启后仍在） */
    out['②_落盘后仍在'] = await page.evaluate(() => {
      const before = HP.NetStats.report().ping.n;
      HP.NetStats._d = null;                     /* 丢掉内存那份，等价于冷启动 */
      const after = HP.NetStats.report().ping.n;
      const raw = localStorage.getItem('HP_TALK_CACHE.net.stats') || '';
      return { 内存前: before, 重读后: after, 落盘字节: raw.length * 2, 落盘里有keys: /"ping"/.test(raw) };
    });

    /* ③ 环形上限：喂 70 条 → 只留 60 条，且留的是最新的 */
    out['③_环形上限'] = await page.evaluate(() => {
      for (let i = 0; i < 70; i++) HP.NetStats.addPing({ ok: true, transmitted: 5, loss: i, avg: i, max: i, tookMs: i + 100 });
      const st = HP.NetStats.report();
      const last = HP.NetStats.recent('ping', 1)[0];
      return { 条数: st.ping.n, 最新一条的平均延迟: last.avg, 上限: 60 };
    });

    /* ④ 按天聚合：喂跨两天的流量 → 昨天那桶归到昨天，且与区间统计相加一致 */
    out['④_按天聚合'] = await page.evaluate(() => {
      const now = Date.now();
      const y = now - 24 * 3600 * 1000;
      HP.NetStats.clear();
      HP.NetStats.trafficTick(1000, 2000, y);        /* 昨天的 1KB↑/2KB↓ */
      HP.NetStats.trafficTick(500, 700, y);
      HP.NetStats.trafficTick(300, 900, now);        /* 今天的 300B↑/900B↓ */
      const r = HP.NetStats.report();
      const sum = r.days.reduce((a, d) => a + d.up + d.down, 0);
      return {
        天数: r.days.length, 每天: r.days.map((d) => d.day + ':' + (d.up + d.down)),
        今天合计: (r.today ? (r.today.up + r.today.down) : 0),
        两天合计: sum, 预期合计: 1000 + 2000 + 500 + 700 + 300 + 900
      };
    });

    /* ⑤ 连接计数：推原生 state 事件（零网络），数一数 net.* 调用有没有增加 */
    out['⑤_连接计数'] = await page.evaluate(async () => {
      const before = window.__r27.all['net.ping'] || 0;
      window.__ev({ t: 'state', state: 'connected' });
      await new Promise((r) => setTimeout(r, 60));
      window.__ev({ t: 'state', state: 'failed', msg: 'Connection reset' });
      await new Promise((r) => setTimeout(r, 60));
      window.__ev({ t: 'state', state: 'connected' });          /* 第二次连接 = 一次重连 */
      await new Promise((r) => setTimeout(r, 60));
      const c = HP.NetStats.report().conn;
      return {
        连接次数: c.count, 失败次数: c.fail, 重连次数: c.reconnects, 失败率: c.rate, 最近原因: c.lastReason,
        没有新增网络调用: (window.__r27.all['net.ping'] || 0) === before
      };
    });

    /* ⑥ RTT 历史：走真心跳那条路（pingOnce 里的 addRtt） */
    out['⑥_RTT历史'] = await page.evaluate(async () => {
      HP.App.state = 'connected';
      for (let i = 0; i < 3; i++) { await HP.App.pingOnce(); await new Promise((r) => setTimeout(r, 30)); }
      const r = HP.NetStats.report().rtt;
      return { 条数: r.n, 最近: r.last, 平均: r.avg, 最差: r.max };
    });

    /* ⑦ 定时探测：默认关 → 一个请求都不发；开启 → probeTick 真跑；省电档停表 */
    out['⑦_定时探测开关'] = await page.evaluate(async () => {
      await HP.App.setPref('netProbe', false);
      window.__r27.ping = 0;
      const startedOff = HP.NetStats.startProbe();
      await new Promise((r) => setTimeout(r, 1500));
      const offPings = window.__r27.ping;
      await HP.App.setPref('netProbe', true);
      await HP.App.setPref('netProbeInterval', '300');
      const startedOn = HP.NetStats.startProbe();
      const ticked = await HP.NetStats.probeTick();              /* 手动触发一次，等价于到点 */
      const afterTick = window.__r27.ping;
      HP.App._powerSave = true;
      const startedInSave = HP.NetStats.startProbe();            /* 省电档必须不开表 */
      HP.App._powerSave = false;
      await HP.App.setPref('netProbe', false);
      HP.NetStats.stopProbe();
      return {
        关着_开表返回: startedOff, '关着_1_5s内ping次数': offPings,
        开着_开表返回: startedOn, 探测一次真发了ping: ticked && afterTick > 0,
        省电档_开表返回: startedInSave, 探测统计: HP.NetStats.report().probe
      };
    });

    /* ⑧ 网络页统计行读得回来 + 不回归（原生两行读数不变） */
    out['⑧_网络页读数'] = await page.evaluate(async () => {
      HP.NetStats.addPing({ ok: true, transmitted: 5, loss: 0, avg: 12.3, max: 20, tookMs: 1280, host: '127.0.0.1', count: 5 });
      HP.App.openBoard('net');
      await new Promise((r) => setTimeout(r, 500));
      const txt = (id) => { const e = document.querySelector('[data-testid="' + id + '"]'); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
      return {
        丢包历史行: txt('net-hist'), RTT行: txt('net-rtt-hist'), 按天行: txt('net-days'), 连接行: txt('net-conn'),
        原有两行还在: !!txt('net-ping') && !!txt('net-tcp'),
        原有ping行: txt('net-ping'), 目标行: txt('net-target')
      };
    });

    await page.waitForTimeout(200);
    out['⑨_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
