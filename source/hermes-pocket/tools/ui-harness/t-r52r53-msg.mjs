/* R-52 / R-53 acceptance probe (local harness = real render path):
 *   1) three states (pending circle / sent check / failed red mark) + icon size <= 14px + bubble height delta 0px
 *   2) `#tk-sends` node count = 0 when everything is settled-sent (1 when something is not)
 *   3) tapping the red mark => `talk.say` +1, bubble count unchanged, 3 rapid taps => 1 call
 *   4) long press a bubble => two-row menu; "delete" => list -1 (server truth: thread no longer returns it)
 *   5) "show deleted" => recovers it via `talk.since --show-hidden` (greyed)
 * Fixture shapes follow roles-chat real replies (author recipe 03-给renderer-配方.md).
 * Note: the page keeps two same-id containers on first paint (known quirk) -> always use the LAST #tk-chat.
 * Usage: cd source/hermes-pocket/tools/ui-harness && node harness.mjs t-r52r53-msg.mjs
 */
export default {
  name: 'R-52/R-53 验收：气泡三态 + 长按两档菜单（删除 / 显示已删除）',

  check: async (page) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
    const out = {};
    const sec = async (name, fn) => { try { out[name] = await page.evaluate(fn); } catch (e) { out[name] = { error: String((e && e.message) || e) }; } };

    await page.evaluate(() => {
      window.__c = { say: 0, hidden: 0, since: 0, sinceShowHidden: 0, thread: 0 };
      window.__hid = {};
      window.__threadItems = [
        { id: 101, who: 'him', body: '他说的第一条', at: 1000 },
        { id: 102, who: 'me', body: '成功那条', at: 1100, send_state: 'sent',
          send_note: { at: 1100, ms: 3330, attempts: 1, result: '投出但未确证' } },
        { id: 103, who: 'me', body: '还在发那条', at: 1200, send_state: 'pending', send_note: { at: 1200, state: 'pending' } },
        { id: 104, who: 'me', body: '失败那条', at: 1300, send_state: 'failed',
          send_note: { reason: '角色 r52.nosuch 没有会话（先 spawn）', result: '投递失败', attempts: 0, ms: 0 } },
        { id: 105, who: 'him', body: '他说的第二条', at: 1400 }
      ];
      window.__allMsgs = () => window.__threadItems.map((x) => ({
        id: x.id, kind: 'private',
        from: x.who === 'me' ? 'me' : 'pipeline.author',
        to: x.who === 'me' ? 'pipeline.author' : 'me',
        topic: null, body: x.body, at: x.at, must_reply: false,
        send_state: x.send_state || null, send_note: x.send_note || null,
        hidden_by_user: !!window.__hid[x.id], hidden: false
      }));
      const orig = window.HermesPocket.postMessage.bind(window.HermesPocket);
      const reply = (rid, data) => window.HermesPocket.onmessage({ data: JSON.stringify({ t: 'res', _rid: rid, ok: true, data }) });
      window.HermesPocket.postMessage = (t) => {
        let m = null; try { m = JSON.parse(t); } catch (e) { }
        if (!m || !m.t || m.t.indexOf('talk.') !== 0) return orig(t);
        if (m.t === 'talk.roles') return reply(m._rid, { scenes: [{ name: 's', roles: [{ full_name: 'pipeline.author', title: '作者', online: true }] }], channels: [] });
        if (m.t === 'talk.sessions') return reply(m._rid, { sessions: [] });
        if (m.t === 'talk.thread') {
          window.__c.thread++;
          const items = window.__threadItems.filter((x) => !window.__hid[x.id]);
          return reply(m._rid, { role: m.role, count: items.length, items: items });
        }
        if (m.t === 'talk.since') {
          window.__c.since++;
          if (m.show_hidden) window.__c.sinceShowHidden++;
          const all = window.__allMsgs();
          const vis = m.show_hidden ? all : all.filter((x) => !x.hidden_by_user);
          return reply(m._rid, { last: 200, count: vis.length, hidden_count: Object.keys(window.__hid).length,
            show_hidden: !!m.show_hidden, messages: vis });
        }
        if (m.t === 'talk.hidden') {
          window.__c.hidden++;
          if (m.action === 'hide') window.__hid[m.id] = true; else delete window.__hid[m.id];
          window.__lastHidden = { id: m.id, action: m.action };
          return reply(m._rid, { id: m.id, action: m.action, hidden_by_user: m.action === 'hide' ? 1 : 0, changed: 1,
            visible_count: 3, hidden_count: Object.keys(window.__hid).length, total_rows_unchanged: 1050 });
        }
        if (m.t === 'talk.say') { window.__c.say++; window.__lastSay = m; return reply(m._rid, { id: 900, delivered: null, send_state: 'pending' }); }
        return reply(m._rid, {});
      };
      /* 首屏会留下两份同名容器（已知现象）⇒ 取气泡最多的那一份用（先清空再异步填，取"最后一份"可能是空的） */
      window.__chat = () => {
        if (window.__chatEl && document.contains(window.__chatEl)) return window.__chatEl;
        const a = [...document.querySelectorAll('#tk-chat')];
        a.sort((x, y) => y.querySelectorAll('.tk-bub').length - x.querySelectorAll('.tk-bub').length);
        window.__chatEl = a[0];
        return window.__chatEl;
      };
      window.__bubs = () => [...window.__chat().querySelectorAll('.tk-bub')];
      window.__snap = () => {
        const chat = window.__chat();
        const bubs = window.__bubs();
        const uniq = [...new Set(bubs.map((b) => b.getAttribute('data-msg')))];
        const ic = (cls) => chat.querySelectorAll('.tk-ic-' + cls).length;
        const rect = (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
        const one = (cls) => { const e = chat.querySelector('.tk-ic-' + cls); return e ? rect(e) : null; };
        return {
          chatContainers: document.querySelectorAll('#tk-chat').length,
          bubbleCount: uniq.length,
          bubbleIds: uniq,
          pending: ic('sending'), sent: ic('sent'), fail: ic('fail'),
          iconSize: { pending: one('sending'), sent: one('sent'), fail: one('fail') },
          tkSendsCount: document.querySelectorAll('#tk-sends').length,
          menuOpen: !!document.getElementById('tk-msgmenu'),
          menuItems: [...document.querySelectorAll('#tk-msgmenu .tk-msgitem')].map((b) => b.textContent),
          hiddenBubbles: chat.querySelectorAll('.tk-bub-hidden').length,
          topbarKeys: document.querySelectorAll('#topbar .tb-btn').length
        };
      };
      window.__bub = (id) => window.__bubs().find((b) => b.getAttribute('data-msg') === String(id));
      window.__press = async (el, ms) => {
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        try {
          const t = new Touch({ identifier: 7, target: el, clientX: cx, clientY: cy });
          el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [t], targetTouches: [t], changedTouches: [t] }));
        } catch (e) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: cx, clientY: cy })); }
        await new Promise((r2) => setTimeout(r2, ms));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      };
    });

    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.showBoard('talk');
      HP.Talk.roles = [{ full_name: 'pipeline.author', title: '作者', online: true }];
      await HP.Talk.openRole('pipeline.author');
      await new Promise((r) => setTimeout(r, 400));
      /* 首屏会留下两份同名容器（页面自己的"先清空再异步填"竞态，已单独登记）——
       * 这里再重画一次让它落定成单份，后面的读数才是干净的。 */
      HP.Talk.render();
      await new Promise((r) => setTimeout(r, 500));
    });
    await page.waitForTimeout(500);

    await sec('00_state', async () => ({ ...window.__snap(), view: HP.Talk.view, calls: JSON.parse(JSON.stringify(window.__c)) }));

    await sec('01_three_states', async () => {
      const snap = window.__snap();
      const bu = window.__bub(102);
      const hWithIcon = bu.getBoundingClientRect().height;
      const ic = bu.querySelector('.tk-ic');
      const kept = ic.parentNode;
      ic.remove();
      const hNoIcon = bu.getBoundingClientRect().height;
      kept.appendChild(ic);
      const hBack = bu.getBoundingClientRect().height;
      /* 命中区：图标中心往右 16px 那一点还应落在图标上（::after 撑的 44dp 热区） */
      bu.scrollIntoView({ block: 'center' });
      const fi = window.__chat().querySelector('.tk-ic-fail');
      fi.scrollIntoView({ block: 'center' });
      const r = fi.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.round(r.left + r.width / 2 + 16), Math.round(r.top + r.height / 2));
      return { ...snap, bubbleHeightWithIcon: Math.round(hWithIcon * 10) / 10,
        bubbleHeightNoIcon: Math.round(hNoIcon * 10) / 10,
        bubbleHeightAfterReadd: Math.round(hBack * 10) / 10,
        bubbleHeightDelta: Math.round((hBack - hNoIcon) * 10) / 10,
        hit16pxRightOfFailIcon: hit ? (hit.className || hit.tagName) : null,
        failNote: fi.getAttribute('data-note') };
    });

    await sec('02_sendrow_only_when_unsettled', async () => {
      HP.Talk.sends = [{ n: 1, target: 'pipeline.author', kind: 'private', body: 'x', t0: 0, state: 'sent', ms: 3330, note: '' }];
      HP.Talk.paintSends(window.__chat());
      const allSent = document.querySelectorAll('#tk-sends').length;
      HP.Talk.sends.push({ n: 2, target: 'pipeline.author', kind: 'private', body: 'y', t0: 0, state: 'timeout', ms: null, note: '超时（8 秒没回执）' });
      HP.Talk.paintSends(window.__chat());
      const oneFailed = document.querySelectorAll('#tk-sends').length;
      HP.Talk.sends = [];
      HP.Talk.paintSends(window.__chat());
      const cleared = document.querySelectorAll('#tk-sends').length;
      return { allSent, oneFailed, cleared };
    });

    await sec('03_tap_fail_mark', async () => {
      const before = window.__snap();
      const say0 = window.__c.say;
      const fail = window.__chat().querySelector('.tk-ic-fail');
      if (!fail) return { error: 'no .tk-ic-fail rendered', snap: before };
      const later = () => ({ say: window.__c.say, bubbles: window.__snap().bubbleCount,
        iconClass: (window.__chat().querySelector('.tk-ic[data-msg="104"]') || {}).className || null });
      fail.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 60));
      const oneTap = later();
      for (let i = 0; i < 3; i++) {
        fail.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 100));
      }
      const threeTaps = later();
      return { bubblesBefore: before.bubbleCount, bubblesAfter: later().bubbles,
        sayDeltaOneTap: oneTap.say - say0, sayDeltaThreeTaps: threeTaps.say - say0,
        lastSay: window.__lastSay, iconClassAfterTap: oneTap.iconClass };
    });

    await sec('04_longpress_and_delete', async () => {
      const before = window.__snap();
      const bu = window.__bub(103);
      await window.__press(bu, 620);
      const opened = window.__snap();
      const delBtn = document.querySelector('#tk-msgmenu .tk-msgitem[data-testid="talk-msgmenu-del"]');
      if (!delBtn) return { error: 'menu did not open', opened };
      delBtn.click();
      await new Promise((r) => setTimeout(r, 300));
      const after = window.__snap();
      return { menuOpen: opened.menuOpen, menuItems: opened.menuItems, topbarKeysWithMenuOpen: opened.topbarKeys,
        hiddenCalls: window.__c.hidden, hiddenArgs: window.__lastHidden,
        bubblesBefore: before.bubbleCount, bubblesAfter: after.bubbleCount, bubbleIdsAfter: after.bubbleIds,
        menuGoneAfterAction: !after.menuOpen };
    });

    await sec('05_show_deleted_recover', async () => {
      const bu = window.__bub(105);
      await window.__press(bu, 620);
      const items = [...document.querySelectorAll('#tk-msgmenu .tk-msgitem')].map((b) => b.textContent);
      const showBtn = document.querySelector('#tk-msgmenu .tk-msgitem[data-testid="talk-msgmenu-show"]');
      if (!showBtn) return { error: 'menu did not open', items };
      showBtn.click();
      await new Promise((r) => setTimeout(r, 600));
      const after = window.__snap();
      return { menuItems: items, showHidden: HP.Talk.showHidden, sinceShowHiddenCalls: window.__c.sinceShowHidden,
        bubblesAfter: after.bubbleCount, bubbleIdsAfter: after.bubbleIds,
        hiddenStyledBubbles: after.hiddenBubbles,
        delMarks: window.__chat().querySelectorAll('[data-testid="talk-hidden-mark"]').length,
        tkSendsCount: after.tkSendsCount };
    });

    out['06_errors'] = { count: errs.length, detail: errs.slice(0, 4) };
    return out;
  }
};
