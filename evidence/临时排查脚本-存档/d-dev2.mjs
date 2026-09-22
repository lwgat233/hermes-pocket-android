/* 真机复验 第 2 批：把「导入密钥 → 新建主机 → 连接」走一遍真界面，然后读**真远端**回来的东西。
 * 用的是一把一次性密钥（/tmp/hpk-verify/id_ed25519，用完删）；私钥内容只在设备页面里出现，不进证据。
 * 注意：startCmd 用 `bash -l`，**故意不碰 tmux** —— 这台机器上的 `hermes` tmux 会话是用户自己在用的，
 * 设备去 attach 会互相干扰。
 */
import fs from 'node:fs';

const 私钥 = fs.readFileSync('/tmp/hpk-verify/id_ed25519', 'utf8');
const 目标地址 = '192.168.1.10';

export default {
  name: '真机·配置与连接（真界面操作 → 真 SSH）',

  check: async (page) => {
    const out = {};

    /* ① 密钥页：走真表单导入（填 textarea + 点按钮） */
    await page.evaluate(() => { HP.App.openBoard('keys'); });
    await page.waitForTimeout(1200);
    out.导入前密钥数 = await page.evaluate(async () => (await HP.App.rpcRaw('key.list')).length);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#tab-keys .btn')].find((b) => /导入私钥/.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(600);
    out.有导入表单 = await page.evaluate(() => !!document.getElementById('ki-pem'));
    await page.evaluate((pem) => {
      document.getElementById('ki-name').value = 'verify-key';
      document.getElementById('ki-pem').value = pem;
      document.getElementById('ki-go').click();
    }, 私钥);
    await page.waitForTimeout(2500);
    out.导入 = await page.evaluate(async () => {
      const list = await HP.App.rpcRaw('key.list');
      const k = list.find((x) => x.name === 'verify-key');
      return { 密钥数: list.length, 有verify: !!k, 指纹: k ? (k.fingerprint || '').slice(0, 40) : '', origin: k ? k.origin : '' };
    });

    /* ② 主机页：走真表单新建（地址/用户/密钥/startCmd=bash -l） */
    await page.evaluate(() => { HP.App.openBoard('hosts'); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#tab-hosts .btn')].find((b) => /新建主机/.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(600);
    out.有主机表单 = await page.evaluate(() => !!document.getElementById('hf-host'));
    const 密钥id = await page.evaluate(async () => {
      const list = await HP.App.rpcRaw('key.list');
      return (list.find((x) => x.name === 'verify-key') || {}).id || '';
    });
    await page.evaluate(({ 地址, kid }) => {
      document.getElementById('hf-name').value = '复验主机';
      document.getElementById('hf-host').value = 地址;
      document.getElementById('hf-port').value = '22';
      document.getElementById('hf-user').value = 'lwgat';
      document.getElementById('hf-auth').value = 'key';
      document.getElementById('hf-auth').dispatchEvent(new Event('change'));
      const sel = document.getElementById('hf-key');
      if (sel) sel.value = kid;
      document.getElementById('hf-cmd').value = 'bash -l';
      document.getElementById('hf-save').click();
    }, { 地址: 目标地址, kid: 密钥id });
    await page.waitForTimeout(2500);
    out.主机 = await page.evaluate(async () => {
      const list = await HP.App.rpcRaw('host.list');
      const h = list.find((x) => x.host === '192.168.1.10');
      return { 主机数: list.length, 有了: !!h, id: h ? h.id : '', user: h ? h.user : '', auth: h ? h.auth : '', 行数: document.querySelectorAll('#tab-hosts .card[data-host]').length };
    });

    /* ③ 连接：点主机卡片 → 菜单里的「▶ 连接」 */
    await page.evaluate(() => {
      const c = document.querySelector('#tab-hosts .card[data-host]');
      if (c) c.click();
    });
    await page.waitForTimeout(800);
    out.菜单项 = await page.evaluate(() => [...document.querySelectorAll('#ctxmenu button, #ctxmenu .ctx-item, #ctxmenu div')]
      .map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 8));
    await page.evaluate(() => {
      const it = [...document.querySelectorAll('#ctxmenu button, #ctxmenu .ctx-item, #ctxmenu div')]
        .find((b) => /连接/.test(b.textContent || ''));
      if (it) it.click();
    });
    // 等连接（远端 sshd + 认证 + PTY，模拟器上会慢）
    out.连接过程 = [];
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(1000);
      const s = await page.evaluate(() => ({ state: HP.App.state, sid: HP.App.sessionId ? '有' : '无' }));
      out.连接过程.push(s.state);
      if (s.state === 'connected' && s.sid === '有') break;
    }
    out.状态 = await page.evaluate(() => ({
      state: HP.App.state, sessionId: HP.App.sessionId,
      host: HP.App.host ? HP.App.host.host + ':' + HP.App.host.port : null,
      transport: HP.App.transport ? HP.App.transport.name : null
    }));

    /* ④ 真远端读：技能清单 / 系统提示词 / 模型（M3 的三行） */
    out.远端读 = await page.evaluate(async () => {
      const info = await HP.App.rpc('hermes.info', {}, 20000).catch((e) => ({ err: String(e) }));
      const prompt = await HP.Remote.prompt({ chars: 400 }).catch((e) => ({ err: String(e) }));
      const model = await HP.Remote.model().catch((e) => ({ err: String(e) }));
      return {
        '技能数': info && info.skills ? info.skills.length : info,
        '技能样本': info && info.skills ? info.skills.slice(0, 3).map((s) => s.rel) : [],
        '提示词': prompt && prompt.ok ? { 份数: prompt.files, 最长: prompt.maxChars, 当前: prompt.total, 开头: (prompt.text || '').slice(0, 40) } : prompt,
        '模型': model && model.ok ? { 模型: model.model, provider: model.provider, 可写: model.writable, 候选: model.candidates } : model
      };
    });
    return out;
  }
};
