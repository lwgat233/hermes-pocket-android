/* R-34 验收探针：角色卡「接入频道」一行 + 信息窗键名，以及 this.channels / r.channels 不串
 * 走真页面：stub talk.roles 喂两个同名不同物的 channels（顶层注册表 vs 每角色数组），跑真 render/paintChannel/roleCard/openRoleSheet。
 * 用法： cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r34-chans.mjs
 */
export default {
  name: 'R-34 验收：角色卡一行「接入频道：qqbot」（空的不显示、卡片不撑高）+ 信息窗「接入频道/未接」+ 顶层注册表不串',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};

    /* 装假桥：talk.roles 回我造的 5 个角色（1 个有频道 qqbot，4 个空）+ 顶层频道注册表 */
    const payload = {
      scenes: [{
        scene: 'pipeline',
        roles: [
          { full_name: 'pipeline.author', title: '功能创造者', name: 'author', scene: 'pipeline', state: 'running', online: true, pending: 0, channels: ['qqbot'] },
          { full_name: 'pipeline.renderer', title: '渲染者', name: 'renderer', scene: 'pipeline', state: 'running', online: true, pending: 0, channels: [] },
          { full_name: 'pipeline.tester', title: '测试者', name: 'tester', scene: 'pipeline', state: 'running', online: false, pending: 2, channels: [] },
          { full_name: 'owner.me', title: '经理', name: 'owner', scene: 'pipeline', state: 'running', online: true, pending: 0, channels: [] },
          { full_name: 'home.maid', title: '女仆', name: 'maid', scene: 'home', state: 'paused', online: false, pending: 0, channels: [] }
        ]
      }],
      /* 顶层注册表：喂「频道（N）」折叠区用的，跟每角色数组同名不同物 */
      channels: { qqbot: ['home.maid', 'owner.me'], wechat: ['home.maid'] }
    };
    await page.evaluate((payload) => {
      HP.Talk.pullRoleOutput = () => { };
      window.__r34Orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (m && m.t === 'talk.roles') { setTimeout(() => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: m._rid, ok: true, data: payload }) }), 20); return; }
        return window.__r34Orig(t);
      };
      HP.App.showBoard('talk');
    }, payload);
    await page.waitForTimeout(700);
    out['①_角色卡'] = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid="talk-role"]')];
      const dict = {};
      cards.forEach((c) => {
        const rch = c.querySelector('[data-testid="talk-rolechans"]');
        dict[c.getAttribute('data-role')] = {
          高: Math.round(c.getBoundingClientRect().height),
          接入频道那行: rch ? rch.textContent : null,
          用的类: rch ? rch.className : null,
          标签行还在吗: !!c.querySelector('.tags, .tk-tag'),
          整卡文字: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 60)
        };
      });
      const hs = cards.map((c) => Math.round(c.getBoundingClientRect().height));
      return {
        卡片数: cards.length,
        各卡: dict,
        无频道卡的高: dict['pipeline.renderer'] && dict['pipeline.renderer'].高,
        有频道卡的高: dict['pipeline.author'] && dict['pipeline.author'].高,
        无频道的卡高都一致: ['pipeline.renderer', 'pipeline.tester', 'owner.me', 'home.maid'].map((k) => dict[k] && dict[k].高).filter((x, i, a) => x === a[0]).length === 4,
        没有卡被撑到两行: !cards.some((c) => Math.round(c.getBoundingClientRect().height) > (dict['pipeline.author'] ? dict['pipeline.author'].高 : 999))
      };
    });

    /* ② 信息窗：键名与空值 */
    out['②_信息窗'] = await page.evaluate(async () => {
      const read = () => [...document.querySelectorAll('.tk-sheetrow')].map((d) => d.innerText.replace(/\s+/g, ' ').trim());
      HP.Talk.openRoleSheet('pipeline.author');                 /* 有频道：qqbot */
      await new Promise((r) => setTimeout(r, 300));
      const withChan = read();
      HP.Talk.closeSheet();
      await new Promise((r) => setTimeout(r, 150));
      HP.Talk.openRoleSheet('pipeline.tester');                 /* 没频道 */
      await new Promise((r) => setTimeout(r, 300));
      const noChan = read();
      HP.Talk.closeSheet();
      const pick = (rows, key) => (rows.find((r) => r.indexOf(key) === 0) || null);
      return {
        有频道_接入频道那行: pick(withChan, '接入频道'),
        有频道_旧的能接入还在吗: !!pick(withChan, '能接入'),
        没频道_接入频道那行: pick(noChan, '接入频道'),
        没频道_出现未接: !!(pick(noChan, '接入频道') || '').includes('未接'),
        没频道_出现旧的无: /（无）/.test(pick(noChan, '接入频道') || '')
      };
    });

    /* ③ 顶层注册表 vs 每角色数组：别串（「频道（N）」区走顶层，卡片走每角色） */
    out['③_不串'] = await page.evaluate(() => {
      const sec = document.getElementById('tk-channels-toggle');
      const box = document.getElementById('tk-channels');
      const cards = [...document.querySelectorAll('[data-testid="talk-role"]')];
      const author = cards.find((c) => c.getAttribute('data-role') === 'pipeline.author');
      const maid = cards.find((c) => c.getAttribute('data-role') === 'home.maid');
      return {
        顶层注册表: Object.keys(HP.Talk.channels || {}),
        频道区标题: sec ? sec.textContent.trim().slice(0, 20) : null,
        频道区内容: box ? box.innerText.replace(/\s+/g, ' ').trim().slice(0, 80) : null,
        author卡片那行: author ? (author.querySelector('[data-testid="talk-rolechans"]') || {}).textContent : null,
        maid卡片有没有接入频道行: !!(maid && maid.querySelector('[data-testid="talk-rolechans"]')),
        卡片没被顶层注册表污染: !!(author && (author.querySelector('[data-testid="talk-rolechans"]') || {}).textContent === '接入频道：qqbot')
      };
    });

    /* ④ 「频道（N）」折叠区行为没动：点标题能折叠/展开 */
    out['④_折叠区'] = await page.evaluate(async () => {
      const sec = document.getElementById('tk-channels-toggle');
      const before = document.getElementById('tk-channels');
      const st1 = before ? getComputedStyle(before).display : null;
      sec.click();
      await new Promise((r) => setTimeout(r, 250));
      const after = document.getElementById('tk-channels');
      const st2 = after ? getComputedStyle(after).display : null;
      return { 标题在: !!sec, 点之前display: st1, 点之后display: st2, 折叠有反应: st1 !== st2 };
    });

    await page.waitForTimeout(200);
    out['⑤_报错'] = { 条数: errs.length, 明细: errs.slice(0, 5) };
    return out;
  }
};
