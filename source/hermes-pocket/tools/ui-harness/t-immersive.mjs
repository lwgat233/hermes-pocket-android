/* 用户报的「全屏（沉浸）模式」三条（N-3 / N-5）：
 *   ① 沉浸模式要**保留输入框**（以前连输入框一起藏了）
 *   ② 沉浸模式里顶栏与功能键条仍然要藏起来
 *   ③ **退出沉浸之后**，☰ 还能开抽屉、单指上下滑还能翻看历史（和进入前行为一致）
 * 判据全是读回来的事实：可见性、视口内、点 ☰ 之后抽屉的 show、以及真拖一次读 viewportY。
 */
export default {
  name: '沉浸（全屏）模式：保留输入框 · 退出后 ☰ 与上下滑照旧',

  check: async (page) => {
    const out = {};
    /* 先造出"能滚"的前提：喂 200 行，让缓冲比屏幕高 */
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      const lines = [];
      for (let i = 1; i <= 200; i += 1) lines.push('line ' + i);
      HP.App.onData({ data: HP.b64encode(HP.enc.encode(lines.join('\r\n') + '\r\n')), seq: 500 });
    });
    await page.waitForTimeout(500);

    out.visibility = await page.evaluate(() => {
      const readVis = () => {
        const c = document.getElementById('composer').getBoundingClientRect();
        return {
          composerDisplay: getComputedStyle(document.getElementById('composer')).display,
          composerInViewport: c.height > 0 && c.top >= 0 && c.bottom <= window.innerHeight + 1,
          topbarDisplay: getComputedStyle(document.getElementById('topbar')).display,
          keybarDisplay: getComputedStyle(document.getElementById('keybar')).display
        };
      };
      const before = readVis();
      HP.App.toggleImmersive();
      return new Promise((r) => setTimeout(() => {
        const mid = readVis();
        HP.App.toggleImmersive();       // 退出沉浸
        setTimeout(() => r({ before, mid, after: readVis() }), 700);
      }, 500));
    });

    /* 拖一次：手指往下拖 = 看更早的内容 ⇒ viewportY 必须变小 */
    const dragOnce = async (label) => {
      const before = await page.evaluate(() => HP.App.term.buffer.active.viewportY);
      await page.evaluate(() => {
        const th = document.getElementById('termhost').getBoundingClientRect();
        const x = Math.round(th.x + th.width / 2), y = Math.round(th.y + th.height * 0.3);
        const dispatch = (t, yy) => document.getElementById('stage').dispatchEvent(new PointerEvent(t, {
          pointerId: 3, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: yy
        }));
        dispatch('pointerdown', y);
        for (let i = 1; i <= 9; i += 1) dispatch('pointermove', y + i * 22);
        dispatch('pointerup', y + 198);
      });
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => HP.App.term.buffer.active.viewportY);
      return { label, viewportBefore: before, viewportAfter: after, scrolled: after < before };
    };

    out.drag = { beforeImmersive: await dragOnce('beforeImmersive') };
    await page.evaluate(() => { HP.App.scrollToBottom(); HP.App.toggleImmersive(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { HP.App.toggleImmersive(); });
    await page.waitForTimeout(800);
    out.drag.afterImmersive = await dragOnce('afterImmersive');

    /* 退出沉浸后点 ☰ */
    out.afterTap = await page.evaluate(async () => {
      const b = document.getElementById('btn-panel');
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const drawerBefore = document.getElementById('drawer').classList.contains('show');
      b.click();
      await new Promise((r2) => setTimeout(r2, 450));
      const drawerAfter = document.getElementById('drawer').classList.contains('show');
      HP.App.closeDrawer();
      return { drawerBefore, drawerAfter, topElement: hit ? hit.tagName + '.' + String(hit.className || '').slice(0, 24) : null };
    });

    out.verdict = {
      composerVisibleInImmersive: out.visibility.mid.composerDisplay !== 'none' && out.visibility.mid.composerInViewport === true,
      topbarAndKeybarHiddenInImmersive: out.visibility.mid.topbarDisplay === 'none' && out.visibility.mid.keybarDisplay === 'none',
      allThreeBackAfterExit: out.visibility.after.composerDisplay !== 'none' && out.visibility.after.topbarDisplay !== 'none' && out.visibility.after.keybarDisplay !== 'none',
      swipeScrollsBeforeImmersive: out.drag.beforeImmersive.scrolled === true,
      swipeScrollsAfterExit: out.drag.afterImmersive.scrolled === true,
      'tapHamburgerOpensDrawerAfterExit': out.afterTap.drawerAfter === true,
      'tapHitsButton': /tb-btn|btn-panel/.test(String(out.afterTap.topElement))
    };
    return out;
  }
};
