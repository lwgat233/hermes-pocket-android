/* Hermes Pocket — 远端只读信息（HP.Remote）
 * ===========================================================================
 * 干什么：把原生 op 回回来的**带标记的原始文本**解析成结构化数据，供界面显示。
 * 为什么单独一层：解析是纯函数，测试台可以直接喂**真实输出**做断言（不用连远端）；
 * 界面只消费解析结果（`HP.UI.row` / `HP.UI.sheet`），不再自己拆字符串。
 *
 * 现有：系统提示词（`hermes.prompt`）。后续 item 5「改模型」也放这里。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  /** 取 @@XXX 标记那一段（标记行本身不要） */
  const section = (raw, mark) => {
    const text = String(raw == null ? '' : raw);
    const i = text.indexOf('@@' + mark);
    if (i < 0) return '';
    const rest = text.slice(i + mark.length + 2);
    const end = rest.search(/\n@@[A-Z]+/);
    return (end < 0 ? rest : rest.slice(0, end)).replace(/^\s*\n?/, '').replace(/\s+$/, '');
  };
  const has = (raw, mark) => String(raw == null ? '' : raw).indexOf('@@' + mark) >= 0;

  const Remote = {
    section,
    has,

    /**
     * 解析 `hermes.prompt` 的输出。返回：
     *   { ok, err, files, maxChars, minChars, hash, total, head, text }
     * 远端没装 python3 / 打不开 state.db 时，原生会把原因写进 @@ERR —— 这里如实带出来。
     */
    parsePrompt(raw) {
      const out = { ok: false, err: '', files: 0, maxChars: 0, minChars: 0, hash: '', total: 0, head: '', text: '' };
      const rawS = String(raw == null ? '' : raw);
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '取不到（原因没写清）'; return out; }
      if (!has(rawS, 'STAT')) { out.err = '远端没有回预期内容（可能需要 python3 读 state.db）'; return out; }
      const stat = (section(rawS, 'STAT') || '').split('|');
      out.files = parseInt(stat[0], 10) || 0;
      out.maxChars = parseInt(stat[1], 10) || 0;
      out.minChars = parseInt(stat[2], 10) || 0;
      out.hash = section(rawS, 'HASH') || '';
      out.total = parseInt(section(rawS, 'TOTAL'), 10) || 0;
      out.head = section(rawS, 'HEAD') || '';
      out.text = section(rawS, 'TEXT') || '';
      out.ok = out.files > 0 || out.total > 0;
      return out;
    },

    /** 取系统提示词（只读 op）。offset 从 1 开始；chars 上限由原生侧夹住 */
    async prompt(opts) {
      const o = opts || {};
      let raw = '';
      try { raw = await HP.App.rpc('hermes.prompt', { offset: o.offset || 1, chars: o.chars || 1500 }, 20000); }
      catch (e) { return Object.assign(this.parsePrompt(''), { err: String(e.message || e) }); }
      const r = this.parsePrompt(raw && (raw.raw !== undefined ? raw.raw : raw));
      r.offset = o.offset || 1;
      r.chars = o.chars || 1500;
      return r;
    },

    /** 一行字摘要（界面直接用，别在界面里再拼） */
    promptSummary(p) {
      if (!p || !p.ok) return p && p.err ? ('取不到：' + p.err) : '取不到';
      return p.files + ' 份 · 当前会话 ' + p.total + ' 字符 · 最长 ' + p.maxChars + ' 字符';
    },

    /* ------------------------------------------------------------ 远端模型 */

    /**
     * 解析 `hermes.model` 的输出 → { ok, err, path, writable, model, provider, base, candidates[], backups[] }
     * 模型名与 provider 来自远端 `~/.hermes/config.yaml` 的 `model:` 段；候选来自 `provider_models_cache.json`。
     */
    parseModel(raw) {
      const out = { ok: false, err: '', path: '', writable: false, model: '', provider: '', base: '', candidates: [], backups: [] };
      const rawS = String(raw == null ? '' : raw);
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '取不到'; return out; }
      if (!has(rawS, 'MODEL')) { out.err = '远端没回预期内容（config.yaml 里没有 model 段？）'; return out; }
      out.path = section(rawS, 'PATH') || '';
      out.writable = section(rawS, 'W') === '1';
      out.model = section(rawS, 'MODEL') || '';
      out.provider = section(rawS, 'PROVIDER') || '';
      out.base = section(rawS, 'BASE') || '';
      out.candidates = (section(rawS, 'CAND') || '').split(',').map((x) => x.trim()).filter(Boolean);
      out.backups = (section(rawS, 'BAKS') || '').split(',').map((x) => x.trim()).filter(Boolean);
      out.ok = !!out.model || has(rawS, 'PATH');
      return out;
    },

    /** 读远端模型（只读） */
    async model() {
      let raw = '';
      try { raw = await HP.App.rpc('hermes.model', {}, 20000); }
      catch (e) { return Object.assign(this.parseModel(''), { err: String(e.message || e) }); }
      return this.parseModel(raw && (raw.raw !== undefined ? raw.raw : raw));
    },

    /**
     * 改远端模型：远端**先备份再改**，改完**读回校验**（并用 yaml 解析一遍确认没改坏）。
     * 返回 { ok, err, old, model, yaml, backup }；只有 ok 为真才算改成功。
     */
    async setModel(name) {
      const out = { ok: false, err: '', old: '', model: '', yaml: '', backup: '' };
      let raw = '';
      try { raw = await HP.App.rpc('hermes.model.set', { model: String(name || '') }, 25000); }
      catch (e) { out.err = String(e.message || e); return out; }
      const rawS = String((raw && raw.raw !== undefined) ? raw.raw : raw || '');
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '写回失败'; return out; }
      out.old = section(rawS, 'OLD') || '';
      out.model = section(rawS, 'NEW') || '';
      out.yaml = section(rawS, 'YAML') || '';
      out.backup = section(rawS, 'BAK') || '';
      out.ok = section(rawS, 'OK') === '1';
      if (!out.ok && !out.err) out.err = '写回后读回的值和写进去的不一样';
      return out;
    },

    /** 还原：从最新备份恢复（能撤销，就不拦人） */
    async undoModel() {
      const out = { ok: false, err: '', from: '', model: '' };
      let raw = '';
      try { raw = await HP.App.rpc('hermes.model.undo', {}, 20000); }
      catch (e) { out.err = String(e.message || e); return out; }
      const rawS = String((raw && raw.raw !== undefined) ? raw.raw : raw || '');
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '还原失败'; return out; }
      out.from = section(rawS, 'FROM') || '';
      out.model = section(rawS, 'MODEL') || '';
      out.ok = section(rawS, 'OK') === '1';
      return out;
    },

    /** 模型那一行的一行字摘要 */
    modelSummary(m) {
      if (!m || !m.ok) return m && m.err ? ('取不到：' + m.err) : '取不到';
      return (m.provider ? m.provider + ' · ' : '') + (m.writable ? '可改（改前自动备份）' : '配置文件只读') +
        (m.backups && m.backups.length ? ' · 有 ' + m.backups.length + ' 份备份' : '');
    },

    /* --------------------------------------------- skill：读 / 改回写 / 存手机 */

    /** 文本 → base64（UTF-8 安全：正文里的中文、emoji 都不会坏） */
    b64enc(text) {
      const bytes = new TextEncoder().encode(String(text == null ? '' : text));
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },

    /** base64 → 文本 */
    b64dec(b64) {
      const bin = atob(String(b64 == null ? '' : b64).replace(/\s+/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    },

    /** 取「`@@KEY` 单独一行、内容在下一行」的那种体（base64 正文用这个） */
    bodyAfter(raw, key) {
      const m = String(raw == null ? '' : raw).match(new RegExp('@@' + key + '\\n([^\\n]*)'));
      return m ? m[1].trim() : '';
    },

    /** 解析 `skill.read` 的输出 → { ok, err, size, sha, text }（正文按字节解回来） */
    parseSkill(raw) {
      const out = { ok: false, err: '', size: 0, sha: '', text: '' };
      const rawS = String(raw == null ? '' : raw);
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '读不到'; return out; }
      out.size = parseInt(section(rawS, 'SIZE'), 10) || 0;
      out.sha = section(rawS, 'SHA') || '';
      try { out.text = this.b64dec(this.bodyAfter(rawS, 'B64')); }
      catch (e) { out.err = '正文解码失败：' + (e.message || e); return out; }
      out.ok = !!out.sha;
      return out;
    },

    /** 读远端 skill / 记忆文件（只读） */
    async skillRead(path) {
      let raw = '';
      try { raw = await HP.App.rpc('skill.read', { path: path }, 25000); }
      catch (e) { return Object.assign(this.parseSkill(''), { err: String(e.message || e) }); }
      return this.parseSkill((raw && raw.raw !== undefined) ? raw.raw : raw);
    },

    /**
     * 编辑后回写。带上**打开时那一版的 sha256**：远端对不上就拒绝写（远端文件被别人改过时，
     * 宁可不写也不静默覆盖）。返回 { ok, err, old, sha, size, backup }。
     */
    async skillWrite(path, text, sha) {
      const out = { ok: false, err: '', old: '', sha: '', size: 0, backup: '' };
      let raw = '';
      try { raw = await HP.App.rpc('skill.write', { path: path, b64: this.b64enc(text), sha: sha || '' }, 40000); }
      catch (e) { out.err = String(e.message || e); return out; }
      const rawS = String((raw && raw.raw !== undefined) ? raw.raw : raw || '');
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '回写失败'; return out; }
      out.old = section(rawS, 'OLD') || '';
      out.sha = section(rawS, 'NEW') || '';
      out.size = parseInt(section(rawS, 'SIZE'), 10) || 0;
      out.backup = section(rawS, 'BAK') || '';
      out.ok = section(rawS, 'OK') === '1';
      if (!out.ok && !out.err) out.err = '读回来的和写进去的不一样';
      return out;
    },

    /** 存到手机本地：远端/手机两侧 sha256 要一致才算成功（对不上就是没存对） */
    async localSave(name, text) {
      const out = { ok: false, err: '', path: '', sha: '', size: 0 };
      let raw = '';
      try { raw = await HP.App.rpc('local.save', { name: name, b64: this.b64enc(text) }, 30000); }
      catch (e) { out.err = String(e.message || e); return out; }
      const rawS = String((raw && raw.raw !== undefined) ? raw.raw : raw || '');
      if (has(rawS, 'ERR')) { out.err = section(rawS, 'ERR') || '存到手机失败'; return out; }
      out.path = section(rawS, 'PATH') || '';
      out.sha = section(rawS, 'SHA') || '';
      out.size = parseInt(section(rawS, 'SIZE'), 10) || 0;
      out.ok = section(rawS, 'OK') === '1';
      if (!out.ok && !out.err) out.err = '存完之后读回来对不上（sha256/字节数不一致）';
      return out;
    }
  };

  HP.Remote = Remote;
})();
