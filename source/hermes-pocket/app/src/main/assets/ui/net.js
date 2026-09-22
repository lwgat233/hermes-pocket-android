/* Hermes Pocket — 网络诊断与流量（HP.Net）
 * ===========================================================================
 * 干什么：
 *   ① 连通性 / 丢包 / 延迟（log 第 2 条）：远端只回**原始文本**（原生 op `net.ping` / `net.tcp`），
 *      解析全在这里 —— 纯函数，测试台可以直接喂**真实输出**做断言，界面只消费结果。
 *   ② 上下行的**区间采集 + 统计**（log 第 8 条）也在这里：采集存区间（带时间戳），
 *      统计只出一处（`bucketize`），绘图层（`bars` / `pie`）只画，不再自己算数。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});
  const R = () => HP.Remote;                       // section / has 复用 remote.js 的（同一套标记规矩）

  const num = (s) => {
    const v = parseFloat(String(s == null ? '' : s).replace(',', '.'));
    return isNaN(v) ? null : v;
  };
  const round1 = (v) => (v == null ? '—' : (Math.round(v * 10) / 10).toString());

  const Net = {
    /* ---------------------------------------------------------------- 目标 */

    /**
     * 测试目标（host / 次数 / 端口）：存 pref 的 `netTarget`（一条 JSON 字符串）。
     * 没设过就用当前连接的主机与端口（连都没连就用回环，界面上能看出来）。
     */
    target() {
      const A = HP.App;
      let t = null;
      try { t = JSON.parse(A.pref('netTarget', '') || 'null'); } catch (e) { t = null; }
      const h = A.host || {};
      return {
        host: String((t && t.host) || h.host || '127.0.0.1'),
        count: Math.max(1, Math.min(20, parseInt((t && t.count) || 5, 10) || 5)),
        port: Math.max(1, Math.min(65535, parseInt((t && t.port) || h.port || 22, 10) || 22)),
        fromHost: !!(t && t.host)
      };
    },

    /** 存目标（唯一写入口：App.setPref）；顺手夹好范围，别让手滑把测试跑爆 */
    async saveTarget(t) {
      const clean = {
        host: String((t && t.host) || '').trim(),
        count: Math.max(1, Math.min(20, parseInt((t && t.count) || 5, 10) || 5)),
        port: Math.max(1, Math.min(65535, parseInt((t && t.port) || 22, 10) || 22))
      };
      await HP.App.setPref('netTarget', JSON.stringify(clean), { apply: false });
      return clean;
    },

    /* ------------------------------------------------------------ ping */

    /**
     * 解析 `ping` 的原始输出（远端用 `LC_ALL=C` 跑，所以是英文固定格式）。
     * 返回 { ok, err, transmitted, received, loss, min, avg, max, times[], text }
     * 读不出来就如实写进 err（比如域名解析不了：`Name or service not known`）。
     */
    parsePing(raw) {
      const out = { ok: false, err: '', transmitted: 0, received: 0, loss: null, min: null, avg: null, max: null, times: [], text: '' };
      const rawS = String(raw == null ? '' : raw);
      out.text = rawS.trim();
      if (R().has(rawS, 'ERR')) { out.err = R().section(rawS, 'ERR') || '跑不了 ping'; return out; }
      const tx = rawS.match(/(\d+)\s+packets transmitted,\s+(\d+)\s+(?:packets\s+)?received/i);
      if (!tx) {
        const bad = out.text.split('\n').map((l) => l.trim())
          .find((l) => /^(ping|bash|sh):/i.test(l) || /not known|not found|Unreachable|permission/i.test(l));
        out.err = bad || '没读到 ping 的统计行';
        return out;
      }
      out.transmitted = parseInt(tx[1], 10);
      out.received = parseInt(tx[2], 10);
      const loss = rawS.match(/([\d.]+)%\s+packet loss/i);
      out.loss = loss ? num(loss[1])
        : (out.transmitted ? Math.round((out.transmitted - out.received) / out.transmitted * 1000) / 10 : null);
      const rtt = rawS.match(/rtt min\/avg\/max\/\w+ = ([\d.]+)\/([\d.]+)\/([\d.]+)/i);
      if (rtt) { out.min = num(rtt[1]); out.avg = num(rtt[2]); out.max = num(rtt[3]); }
      out.times = (rawS.match(/time[=<]([\d.]+)\s*ms/gi) || []).map((s) => num(String(s).replace(/[^\d.]/g, '')));
      out.ok = out.transmitted > 0;
      return out;
    },

    /** 解析 `net.tcp` 的输出（@@OK 0/1 / @@MS n / @@ERR 原因）→ { ok, err, ms, text } */
    parseTcp(raw) {
      const out = { ok: false, err: '', ms: null, text: '' };
      const rawS = String(raw == null ? '' : raw);
      out.text = rawS.trim();
      if (R().has(rawS, 'OK')) out.ok = R().section(rawS, 'OK') === '1';
      const msS = R().section(rawS, 'MS');
      if (msS) out.ms = num(msS);
      const err = R().section(rawS, 'ERR');
      if (err) out.err = err;
      if (!out.ok && !out.err) out.err = '连不上（原因没写清）';
      if (!out.ok && out.err === '连不上（原因没写清）') out.ok = false;
      return out;
    },

    /** 行里的一行字摘要（界面直接用，不在界面里再拼字符串） */
    pingSummary(p) {
      if (!p) return '没测过';
      if (p.err) return '测不了：' + p.err;
      if (!p.ok) return '没测过';
      return p.transmitted + ' 个包 · ' + round1(p.loss) + '% 丢包 · 平均 ' + round1(p.avg) + ' ms（' +
        round1(p.min) + '–' + round1(p.max) + ' ms）';
    },
    pingRight(p) {
      if (!p || !p.ok) return '';
      return round1(p.avg) + ' ms';
    },
    tcpSummary(t) {
      if (!t) return '没测过';
      if (t.ok) return '通 · ' + (t.ms == null ? '耗时未知' : t.ms + ' ms');
      return '不通：' + (t.err || '未知原因');
    },
    tcpRight(t) {
      if (!t) return '';
      return t.ok ? '通' : '不通';
    },

    /* --------------------------------------------------------------- 跑 */

    async ping(host, count) {
      let raw = null;
      try { raw = await HP.App.rpc('net.ping', { host: String(host || ''), count: parseInt(count, 10) || 5 }, 45000); }
      catch (e) { return Object.assign(this.parsePing(''), { err: String(e.message || e) }); }
      const body = (raw && raw.raw !== undefined) ? raw.raw : raw;
      const out = this.parsePing(body);
      out.tookMs = (raw && raw.ms !== undefined) ? raw.ms : null;   // 这条命令本身在远端跑了多久
      return out;
    },

    async tcp(host, port) {
      let raw = null;
      try { raw = await HP.App.rpc('net.tcp', { host: String(host || ''), port: parseInt(port, 10) || 22 }, 20000); }
      catch (e) { return Object.assign(this.parseTcp(''), { err: String(e.message || e) }); }
      const body = (raw && raw.raw !== undefined) ? raw.raw : raw;
      const out = this.parseTcp(body);
      out.tookMs = (raw && raw.ms !== undefined) ? raw.ms : null;
      return out;
    },

    /* ------------------------------------------------- 上下行：区间 → 统计 → 图 */

    /**
     * 采集：每次流量读数落成一条**区间**（存区间不存总计 —— cdp 的教训，只存累计就分不了桶）。
     * 一条 = { t0, t1, up, down }（毫秒时间戳 + 这段增量的字节数）。
     * 环形缓冲：只留最近 `MAX` 条（界面上的图也就这么宽）。
     */
    MAX: 120,
    pushSample(list, s) {
      const arr = Array.isArray(list) ? list.slice() : [];
      arr.push({
        t0: Math.round(s.t0), t1: Math.round(s.t1),
        up: Math.max(0, Math.round(s.up || 0)), down: Math.max(0, Math.round(s.down || 0))
      });
      while (arr.length > this.MAX) arr.shift();
      return arr;
    },

    /** 统计（**只此一处**）：把区间按"最近 N 段"分桶，出一条 {name,value,pct} 的上行/下行汇总 */
    bucketize(list, 每组) {
      const arr = Array.isArray(list) ? list.slice() : [];
      const n = Math.max(1, parseInt(每组, 10) || 1);
      const buckets = [];
      for (let i = 0; i < arr.length; i += n) {
        const sliceArr = arr.slice(i, i + n);
        buckets.push({
          t0: sliceArr[0].t0,
          t1: sliceArr[sliceArr.length - 1].t1,
          段数: sliceArr.length,
          up: sliceArr.reduce((a, s) => a + (s.up || 0), 0),
          down: sliceArr.reduce((a, s) => a + (s.down || 0), 0)
        });
      }
      const up = arr.reduce((a, s) => a + (s.up || 0), 0);
      const down = arr.reduce((a, s) => a + (s.down || 0), 0);
      const total = up + down;
      return {
        buckets,
        采集条数: arr.length,
        区间条数: buckets.length,
        up, down, total,
        share: [
          { name: '下行', value: down, pct: total ? Math.round(down / total * 1000) / 10 : 0 },
          { name: '上行', value: up, pct: total ? Math.round(up / total * 1000) / 10 : 0 }
        ]
      };
    },

    /** 字节数 → 人话（图上的数字都用它，保证一处口径） */
    bytes(n) {
      const v = Math.max(0, Number(n) || 0);
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      let x = v;
      while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
      const s = i === 0 ? String(Math.round(x)) : (Math.round(x * 10) / 10).toString();
      return s + u[i];
    },

    /**
     * 柱状图（纯 DOM，不引外部库）：返回一个元素，柱高按**同一分母**（所有桶里的最大值），
     * 每根柱子上标数字（`HP.Net.bytes`），下面标时间。图上数字之和 == 汇总数字（测试会算）。
     */
    bars(stats, opts) {
      const o = opts || {};
      const wrap = document.createElement('div');
      wrap.className = 'net-bars';
      wrap.dataset.testid = o.testid || 'net-bars';
      const max = Math.max(1, ...stats.buckets.map((b) => Math.max(b.up, b.down)));
      const dpr = o.height || 90;
      stats.buckets.forEach((b) => {
        const col = document.createElement('div');
        col.className = 'net-col';
        col.dataset.bucket = String(b.t0);
        col.title = this.bytes(b.down) + ' ↓ / ' + this.bytes(b.up) + ' ↑';
        // 两段叠一根柱：下面下行、上面上行（跟顶栏的 ↓/↑ 顺序一致）
        const up = document.createElement('div');
        up.className = 'net-seg net-up';
        up.style.height = Math.round(b.up / max * dpr) + 'px';
        up.dataset.v = String(b.up);
        const down = document.createElement('div');
        down.className = 'net-seg net-down';
        down.style.height = Math.round(b.down / max * dpr) + 'px';
        down.dataset.v = String(b.down);
        const bar = document.createElement('div');
        bar.className = 'net-stack';
        bar.appendChild(up);
        bar.appendChild(down);
        col.appendChild(bar);
        col.appendChild(document.createTextNode(''));
        wrap.appendChild(col);
      });
      return wrap;
    },

    /** 饼（纯 CSS conic-gradient）：上行/下行占比 + 数字 */
    pie(stats) {
      const wrap = document.createElement('div');
      wrap.className = 'net-pie-row';
      wrap.dataset.testid = 'net-pie';
      const downPct = stats.share[0].pct;
      const p = document.createElement('div');
      p.className = 'net-pie';
      p.style.background = 'conic-gradient(var(--accent) 0 ' + downPct + '%, #3a7 ' + downPct + '% 100%)';
      p.dataset.downPct = String(downPct);
      wrap.appendChild(p);
      const legend = document.createElement('div');
      legend.className = 'net-legend';
      stats.share.forEach((seg) => {
        const row = document.createElement('div');
        row.className = 'net-legend-row';
        row.dataset.name = seg.name;
        row.dataset.value = String(seg.value);
        row.dataset.pct = String(seg.pct);
        row.textContent = seg.name + ' ' + this.bytes(seg.value) + ' · ' + seg.pct + '%';
        legend.appendChild(row);
      });
      const sum = document.createElement('div');
      sum.className = 'net-legend-row net-sum';
      sum.dataset.testid = 'net-sum';
      sum.textContent = '合计 ' + this.bytes(stats.total) + '（' + stats.采集条数 + ' 条区间 → ' + stats.区间条数 + ' 组）';
      legend.appendChild(sum);
      wrap.appendChild(legend);
      return wrap;
    }
  };

  HP.Net = Net;
})();
