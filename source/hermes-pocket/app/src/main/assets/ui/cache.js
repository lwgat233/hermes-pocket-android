/* Hermes Pocket — 本地缓存（唯一写入口）
 * ============================================================================
 * 为什么要它（R-26 定位的三处）：
 *   a) 以前 talk.js 的 CACHE.set 是裸 setItem 且 catch 是空的 —— 配额满了**静默吞**，缓存悄悄不再更新；
 *   b) 每次重画都整份重写 thread.<角色>（实测 22.5KB/次，owner.me 那份 81KB），没有节流、没有上限、没有淘汰；
 *   c) app.js 兜底写 hp.<k> 没有护栏，配额满时异常会冒到 setPref 调用方。
 *
 * 所以：所有落盘都走 `HP.Cache.set(k, v, {throttle, maxItems, maxBytes, trim})`，
 *       里面统一做「合并写（节流）/ 上限 + 丢最旧 / 满配额护栏 + 一次可读提示」；
 *       读数走 `HP.Cache.report()`，清理走 `HP.Cache.cleanup()`。
 *
 * 省电/省流量：本文件**不做任何定时器** —— 读数与清理都只在被调用时算一次
 *              （设置页进入/按「看明细」「清理」各算一次），档位不吃亏。
 * 存储格式：值仍是**原样 JSON**（跟老版本一致，老数据照样读得到）；
 *           时间戳/条数记在旁路键 `HP_TALK_CACHE.__meta`（{k:{at,bytes,items}}），不动老键的形状。
 */
(function () {
  const HP = (window.HP = window.HP || {});
  const PREFIX = 'HP_TALK_CACHE.';
  const META = PREFIX + '__meta';
  const PREF_PREFIX = 'hp.';

  const b64 = () => 2;                       /* localStorage 按 UTF-16 字符计（1 字符 ≈ 2 字节），实测配额≈5.23M 字符 */

  const Cache = {
    degraded: false,                         /* 满过一次配额 → 降级为「不落盘」，只留内存 */
    lastError: '',
    toldOnce: false,                         /* 提示只给一次，不反复弹 */
    _pending: {},                            /* 节流：还没来得及落盘的值 */
    _timers: {},
    _writes: 0,                              /* 真落盘次数（探针/自检读它，也用在占用读数里） */
    _skipped: 0,                             /* 因节流被合并掉的次数 */

    _meta() { try { return JSON.parse(localStorage.getItem(META) || '{}') || {}; } catch (e) { return {}; } },
    _metaSave(m) { try { localStorage.setItem(META, JSON.stringify(m)); } catch (e) { /* meta 丢了不影响数据 */ } },
    _bytes(k, s) { return (String(k).length + String(s).length) * b64(); },
    _touch(k, bytes, items) {
      const m = this._meta();
      m[k] = { at: Math.floor(Date.now() / 1000), bytes: bytes, items: items || 0 };
      this._metaSave(m);
    },

    get(k, d) {
      try {
        const s = localStorage.getItem(PREFIX + k);
        if (s === null) return d;
        return JSON.parse(s);
      } catch (e) { return d; }
    },

    /* 真正落盘（内部用）。返回 true/false；配额满 → 降级并给一次提示 */
    _put(k, v, opt) {
      const full = PREFIX + k;
      const s = JSON.stringify(v);
      try {
        localStorage.setItem(full, s);
        this._writes++;
        this._touch(k, this._bytes(full, s), Array.isArray(v) ? v.length : 0);
        return true;
      } catch (e) {
        const quota = /quota/i.test(String(e && e.name) + String(e && e.message));
        this.degraded = true;
        this.lastError = (quota ? '配额满了' : '写不进去') + '：' + String((e && e.message) || e);
        if (!this.toldOnce) {
          this.toldOnce = true;
          try { HP.App.toast('本地存储满了：不再往手机存缓存（界面照常用）', 5000); } catch (e2) { /* 没界面就不弹 */ }
        }
        return false;
      }
    },

    /* 一行一件：按上限裁（丢最旧）+ 字节上限；返回处理后的值 */
    _fit(v, opt) {
      let out = v;
      if (opt.maxItems && Array.isArray(out) && out.length > opt.maxItems) {
        out = out.slice(out.length - opt.maxItems);          /* 丢最旧、留最近 */
      }
      if (opt.trim) { try { out = opt.trim(out); } catch (e) { /* 裁剪函数坏了就用原值 */ } }
      if (opt.maxBytes) {
        let s = JSON.stringify(out);
        let guard = 0;
        while (this._bytes(PREFIX + opt.key, s) > opt.maxBytes && Array.isArray(out) && out.length > 1 && guard++ < 500) {
          out = out.slice(Math.ceil(out.length / 10));        /* 每次丢最旧的 1/10，收敛快 */
          s = JSON.stringify(out);
        }
      }
      return out;
    },

    /**
     * 落盘（唯一入口）。
     * opts.throttle  合并窗口 ms（同一键在这段时间内的多次写只落一次，值取最后一次）
     * opts.maxItems  数组型缓存留多少条（超了丢最旧）
     * opts.maxBytes  这个键的字节上限（超了继续丢最旧）
     * opts.trim      自定义裁剪函数
     * opts.now       跳过节流直接落（清理/退出前用）
     */
    set(k, v, opts) {
      const o = opts || {};
      const fit = this._fit(v, Object.assign({ key: k }, o));
      if (this.degraded) { this._skipped++; return false; }    /* 降级后不再反复撞墙 */
      if (!o.throttle || o.now) return this._put(k, fit, o);
      this._pending[k] = fit;
      if (this._timers[k]) { this._skipped++; return true; }   /* 窗口内合并：等那一次定时落 */
      this._timers[k] = setTimeout(() => {
        delete this._timers[k];
        const val = this._pending[k];
        delete this._pending[k];
        if (val !== undefined) this._put(k, val, o);
      }, o.throttle);
      return true;
    },

    /* 把还没落盘的立刻写下去（切页/收工/测试台用） */
    flush() {
      Object.keys(this._pending).forEach((k) => {
        if (this._timers[k]) { clearTimeout(this._timers[k]); delete this._timers[k]; }
        const val = this._pending[k];
        delete this._pending[k];
        if (val !== undefined) this._put(k, val, {});
      });
      return this._writes;
    },

    del(k) {
      try { localStorage.removeItem(PREFIX + k); } catch (e) { /* 删不掉也不算错 */ }
      const m = this._meta(); delete m[k]; this._metaSave(m);
    },

    /* 现在占多少：每个键的字节/条数/最后用过 + 合计 + 原生侧（读得到就读） */
    report() {
      const items = [];
      let total = 0;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const full = localStorage.key(i);
          if (!full || full.indexOf(PREFIX) !== 0 || full === META) continue;
          const s = localStorage.getItem(full) || '';
          const k = full.slice(PREFIX.length);
          const b = this._bytes(full, s);
          const m = this._meta()[k] || {};
          let n = 0;
          try { const v = JSON.parse(s); n = Array.isArray(v) ? v.length : 0; } catch (e) { /* 数不出条数 */ }
          items.push({ k: k, bytes: b, items: n, at: m.at || null });
          total += b;
        }
      } catch (e) { this.lastError = String(e && e.message || e); }
      items.sort((a, b) => b.bytes - a.bytes);
      return {
        total: total, items: items, count: items.length,
        degraded: this.degraded, lastError: this.lastError,
        writes: this._writes, merged: this._skipped,
        quotaChars: 0
      };
    },

    /* 自动清理：① N 天没用过的整条删 ② 总量超预算 → 按「最后用过」最老的先删 */
    cleanup(opts) {
      const o = opts || {};
      const days = o.days == null ? 7 : o.days;
      const budget = o.budgetBytes || 0;
      const now = Math.floor(Date.now() / 1000);
      const rep = this.report();
      let removed = 0, freed = 0;
      const cut = (it) => {
        this.del(it.k);
        removed++; freed += it.bytes;
        return freed;
      };
      if (days > 0) {
        rep.items.filter((it) => it.at && (now - it.at) > days * 86400).forEach(cut);
      }
      if (budget > 0) {
        let left = rep.total - freed;
        rep.items.filter((it) => !(days > 0 && (now - it.at) > days * 86400))
          .sort((a, b) => (a.at || 0) - (b.at || 0))              /* 最老的先走 */
          .forEach((it) => { if (left > budget) left -= cut(it); });
      }
      return { removed: removed, freed: freed, after: this.report().total };
    },

    clearAll() {
      const rep = this.report();
      rep.items.forEach((it) => this.del(it.k));
      return { removed: rep.items.length };
    },

    /* 设置兜底：原生通道没起来时把设置存本地；配额满也不能把异常冒给调用方 */
    setPrefFallback(k, v) {
      this._put(PREF_PREFIX + k, v, {});
      return { ok: !this.degraded, degraded: this.degraded };
    },
    getPrefFallback(k) {
      try { return localStorage.getItem(PREF_PREFIX + k); } catch (e) { return null; }
    }
  };

  HP.Cache = Cache;
})();
