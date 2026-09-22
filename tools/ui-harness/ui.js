/* Hermes Pocket — 渲染器层（HP.UI）
 * ===========================================================================
 * 界面只把**数据**交给它，不自己拼 HTML：一行信息长什么样、小窗怎么排，
 * 全项目只有这一个文件说了算（同一个东西两个渲染入口，就会出现"这儿改了那儿没改"）。
 *
 * 行规范 = 两行制（左列大标题 + 小灰次行；右列固定、数值完整不许截断），
 * 来自 cdp 项目定下并被验收过的那一套：见归档 `docs/界面渲染规范.md`。
 * ===========================================================================*/
(function () {
  const HP = (window.HP = window.HP || {});

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
  };

  const UI = {
    el,

    /**
     * 一行信息：`.row-item` = 左列（`.ri-main` ▸ `.ri-t` 标题 + `.ri-s` 次行）+ 右列（`.ri-r`）。
     * `right` 是"数值类"信息（时间/流量/大小/状态），CSS 上固定宽度且**不许省略**。
     */
    row({ title, sub, right, onTap, testid, cls }) {
      const r = el('div', 'row-item' + (right ? '' : ' ri-noright') + (cls ? ' ' + cls : ''));
      if (testid) r.dataset.testid = testid;
      const main = el('div', 'ri-main');
      main.appendChild(el('div', 'ri-t', title));
      if (sub) main.appendChild(el('div', 'ri-s', sub));
      r.appendChild(main);
      if (right) r.appendChild(el('div', 'ri-r', right));
      if (onTap) { r.setAttribute('role', 'button'); r.tabIndex = 0; r.addEventListener('click', onTap); }
      return r;
    },

    /** 列表：一组行 + 空态**一句**（空态要能照做，不解释为什么） */
    list(rows, empty) {
      const box = el('div', 'ui-list');
      if (!rows || !rows.length) { box.appendChild(el('div', 'sub', empty || '还没有内容')); return box; }
      rows.forEach((x) => box.appendChild(x instanceof HTMLElement ? x : this.row(x)));
      return box;
    },

    /** 状态一律**一行字**，不要用一排按钮表示状态 */
    status(text) { return el('div', 'sub ui-status', text); },

    /**
     * 点行弹出的小窗：抬头 + 键值对（标签小字在上、值大字在下、每对一条横线）+ 底部一组动作。
     * 默认给一个〔关闭〕，调用方可以只给〔取消〕〔确定〕两个。
     */
    sheet({ title, fields, actions, onClose }) {
      const back = el('div', 'hp-dialog ui-sheet');
      back.style.cssText = 'position:absolute;inset:0;background:rgba(4,8,12,.9);z-index:84;display:flex;align-items:center;justify-content:center;padding:10px';
      const card = el('div', 'card');
      card.style.cssText = 'max-width:680px;width:100%;max-height:88%;display:flex;flex-direction:column';
      card.appendChild(el('div', 'sheet-t', title || ''));
      const body = el('div', 'sheet-body');
      (fields || []).forEach((f) => {
        const fw = el('div', 'field');
        fw.appendChild(el('label', null, f.label));
        fw.appendChild(el('div', 'val', (f.value === undefined || f.value === null || f.value === '') ? '—' : f.value));
        body.appendChild(fw);
      });
      card.appendChild(body);
      const bar = el('div', 'btnrow');
      const acts = (actions && actions.length) ? actions : [{ label: '关闭' }];
      acts.forEach((a) => {
        const b = el('button', 'btn' + (a.primary ? ' primary' : ''), a.label);
        b.addEventListener('click', () => { if (a.fn) a.fn(back); else back.remove(); });
        bar.appendChild(b);
      });
      card.appendChild(bar);
      back.appendChild(card);
      back.addEventListener('click', (e) => { if (e.target === back) back.remove(); });
      document.getElementById('stage').appendChild(back);
      if (onClose) back.addEventListener('click', (e) => { if (e.target === back) onClose(); });
      return back;
    }
  };

  HP.UI = UI;
})();
