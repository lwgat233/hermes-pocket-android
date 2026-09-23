/* Hermes Pocket — 网络统计留存（HP.NetStats）
 * ============================================================================
 * 为什么要它（R-27 定位③）：
 *   丢包/延迟、流量、连接状态三样**本来就在采**，但只有"最近一把"和 120 条 30s 区间桶，
 *   切栏目/重启就没了；连接次数与失败率、端到端 RTT 更是压根没留存。
 *
 * 口径（经理 2026-09-23 定）：
 *   A = 零新增采集：把已在采的三样留成历史 + 按时/按天聚合 —— 本文件不做任何网络调用；
 *   B = 定时探测（默认关）：真去跑 net.ping 的只有 probeTick()，由设置项 netProbe 控制，
 *       且**省电档一律不跑**（onPowerSave 会停表）。
 * 落盘走 HP.Cache（R-26 的唯一入口，节流 + 上限 + 满配额护栏）。
 */
(function () {
  const HP = (window.HP = window.HP || {});
  const KEY = 'net.stats';
  const RING = 60;      /* 每类历史留最近 60 条 */
  const DAYS = 7;       /* 按天留 7 天 */

  const dayKey = (ts) => {
    const d = new Date(ts || Date.now());
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const today = () => dayKey(Date.now());

  const NetStats = {
    _d: null,
    _saveAt: 0,

    data() {
      if (this._d) return this._d;
      const d = HP.Cache.get(KEY, null) || {};
      d.ping = Array.isArray(d.ping) ? d.ping : [];
      d.tcp = Array.isArray(d.tcp) ? d.tcp : [];
      d.rtt = Array.isArray(d.rtt) ? d.rtt : [];
      d.days = (d.days && typeof d.days === 'object') ? d.days : {};
      d.conn = d.conn || { count: 0, fail: 0, reconnects: 0, lastReason: '', lastAt: 0 };
      this._d = d;
      return d;
    },
    _pushRing(list, item, key) {
      list.push(item);
      while (list.length > RING) list.shift();       /* 环形：超了按最旧丢 */
      return list;
    },
    _save(now) {
      const t = Date.now();
      if (!now && t - this._saveAt < 5000) return;   /* 流量那种高频的：5s 合并写（省电/省流量的分内事） */
      this._saveAt = t;
      HP.Cache.set(KEY, this.data(), {
        now: !!now,                                  /* 重要事件（ping/端口/连接状态）立刻落盘，重启不丢 */
        throttle: 5000, maxBytes: 24 * 1024,
        trim: (v) => {
          const keys = Object.keys(v.days || {}).sort();
          while (keys.length > DAYS) delete v.days[keys.shift()];   /* 只留最近 7 天 */
          return v;
        }
      });
    },

    /* ---- 采集入口（都是"已经有的事"顺手记一笔，不新增任何请求）---- */
    addPing(p) {
      if (!p) return;
      this._pushRing(this.data().ping, {
        at: Date.now(), host: p.host || '', count: p.count || p.transmitted || 0,
        ok: !!p.ok,
        loss: (p.loss == null ? null : Math.round(p.loss * 10) / 10),
        avg: (p.avg == null ? null : Math.round(p.avg * 10) / 10),
        max: (p.max == null ? null : Math.round(p.max * 10) / 10),
        took: (p.tookMs == null ? null : Math.round(p.tookMs)), err: p.err || ''
      });
      this._save(true);
    },
    addTcp(t) {
      if (!t) return;
      this._pushRing(this.data().tcp, { at: Date.now(), host: t.host || '', port: t.port || 0, ok: !!t.ok, ms: t.ms == null ? null : t.ms, err: t.err || '' });
      this._save(true);
    },
    addRtt(ms) {
      if (ms == null || !isFinite(ms)) return;
      this._pushRing(this.data().rtt, { at: Date.now(), ms: Math.round(ms) });
      this._save();
    },
    /* 每秒流量的增量 → 归到「今天」的桶（不新增采集；数据源就是顶栏那个采样） */
    trafficTick(up, down, at) {
      const d = this.data();
      const k = dayKey(at);
      const b = d.days[k] || (d.days[k] = { up: 0, down: 0, conn: 0, fail: 0, reconnects: 0, first: at, last: at });
      b.up += (up || 0); b.down += (down || 0); b.last = at || Date.now();
      this._save();
    },
    /* 连接状态（原生 state 事件顺手记；零网络） */
    connState(state, reason) {
      const d = this.data();
      const k = today();
      const b = d.days[k] || (d.days[k] = { up: 0, down: 0, conn: 0, fail: 0, reconnects: 0, first: Date.now(), last: Date.now() });
      if (state === 'connected') {
        d.conn.count++; b.conn++;
        if (d.conn.count > 1) { d.conn.reconnects++; b.reconnects++; }   /* 第 2 次起算重连 */
      } else if (state === 'failed' || state === 'disconnected' || state === 'error' || state === 'closed') {
        d.conn.fail++; b.fail++;
        d.conn.lastReason = reason || state || '';
        d.conn.lastAt = Date.now();
      }
      this._save(true);
    },

    /* ---- 读数（界面只读这里）---- */
    report() {
      const d = this.data();
      const pings = d.ping.slice(-RING);
      const okPings = pings.filter((p) => !p.err);
      const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10 : null);
      const days = Object.keys(d.days).sort().map((k) => Object.assign({ day: k }, d.days[k]));
      const tcps = d.tcp.slice(-RING);
      return {
        ping: {
          n: pings.length, last: pings.length ? pings[pings.length - 1] : null,
          lossAvg: avg(okPings.map((p) => p.loss == null ? 0 : p.loss).filter((x) => x != null)),
          avgAvg: avg(okPings.map((p) => p.avg).filter((x) => x != null)),
          maxMax: okPings.length ? Math.max.apply(null, okPings.map((p) => p.max || 0)) : null
        },
        tcp: {
          n: tcps.length, ok: tcps.filter((t) => t.ok).length,
          rate: tcps.length ? Math.round(tcps.filter((t) => t.ok).length / tcps.length * 100) : null,
          last: tcps.length ? tcps[tcps.length - 1] : null
        },
        rtt: {
          n: d.rtt.length, last: d.rtt.length ? d.rtt[d.rtt.length - 1].ms : null,
          avg: avg(d.rtt.map((r) => r.ms)), max: d.rtt.length ? Math.max.apply(null, d.rtt.map((r) => r.ms)) : null
        },
        conn: Object.assign({}, d.conn, {
          rate: (d.conn.count + d.conn.fail) ? Math.round(d.conn.fail / (d.conn.count + d.conn.fail) * 100) : null
        }),
        days: days,
        today: d.days[today()] || null,
        probe: { on: this.probeOn(), interval: this.probeInterval(), lastAt: this._probeAt || 0, runs: this._probeRuns || 0 }
      };
    },
    /* 明细：最近 N 条（小窗用） */
    recent(kind, n) {
      const d = this.data();
      const list = kind === 'rtt' ? d.rtt : (kind === 'tcp' ? d.tcp : d.ping);
      return list.slice(-(n || 10)).reverse();
    },

    /* ---- B：定时探测（默认关；省电档不跑）---- */
    probeOn() { try { return HP.App.bool('netProbe', false); } catch (e) { return false; } },
    probeInterval() {
      let v = 900;
      try { v = parseInt(HP.App.pref('netProbeInterval', 900), 10) || 900; } catch (e) { /* 用默认 */ }
      return Math.max(60, v);
    },
    _powerSave() { try { return !!HP.App._powerSave; } catch (e) { return false; } },
    startProbe() {
      this.stopProbe();
      if (!this.probeOn()) return false;             /* 默认关：一个请求都不发 */
      if (this._powerSave()) return false;           /* 省电档不跑（硬规矩） */
      const ms = this.probeInterval() * 1000;
      this._timer = setInterval(() => this.probeTick(), ms);
      return true;
    },
    stopProbe() { if (this._timer) { clearInterval(this._timer); this._timer = null; } },
    /** 跑一次探测（只有这条路会真发 net.ping） */
    async probeTick() {
      if (!this.probeOn() || this._powerSave()) return false;
      const t = HP.Net.target();
      const r = await HP.Net.ping(t.host, Math.min(5, t.count || 5)).catch(() => null);
      this._probeAt = Date.now();
      this._probeRuns = (this._probeRuns || 0) + 1;
      if (r) this.addPing(r);
      return true;
    },
    onPowerSave(on) {
      this._powerSave = !!on;
      this.stopProbe();                              /* 进省电一律停表 */
      if (!on) this.startProbe();                    /* 回前台按设置决定要不要开 */
      if (on) this._save(true);                      /* 进省电先把历史落盘 */
    },
    clear() {
      this._d = null;
      HP.Cache.del(KEY);
      this._save(true);
    }
  };

  HP.NetStats = NetStats;
})();
