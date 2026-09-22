/* 用户的追加要求（原话拆开）：**「攒着不丢，实时就实时，有不存储在输入框」**
 *  ① 攒着不丢 —— 见 t-keep.mjs（切栏目/断线重连不清屏、后台暂存、按序补发、草稿不丢）
 *  ② 实时就实时 —— 「实时」模式下**敲一个字立刻进终端**，不是攒在框里等发送
 *  ③ 不存储在输入框 —— 实时模式直通之后输入框**立刻为空**（不在框里留一份）
 * 这里验 ②③：真实键盘敲（playwright 的真按键，不是合成事件）；中文输入法的组合上屏只能合成模拟，
 * 会在读数里标明哪几条是模拟的。
 */
const readInput = (page) => page.evaluate(() => document.getElementById('cinput').value);
const readSent = (page) => page.evaluate(() => window.__sent.slice());
/** 用字符码读回，避免 \x7f 这种控制字符在 JSON 里看着像空串（上一版就吃了这个亏） */
const readSentCodes = (page) => page.evaluate(() => window.__sent.map((s) => [...s].map((c) => c.charCodeAt(0))));
const clearSent = (page) => page.evaluate(() => { window.__sent.length = 0; });
/** 与下面组合上屏用的那两个字一致（页面那侧写死，这里只用来算期望的那份 JSON） */
const CJK_TEXT = '你好';

export default {
  name: '输入框：实时就实时 · 不存储在框里（真实按键）',

  check: async (page) => {
    const out = {};
    await page.evaluate(async () => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      window.__sent = [];
      const origSend = HP.App.send.bind(HP.App);
      HP.App.send = (d) => { window.__sent.push(String(d)); return origSend(d); };
      await HP.App.setPref('liveComposer', true, { apply: false });      // 实时模式
      HP.App.closePanel();
    });
    await page.waitForTimeout(400);

    /* 真点一下输入框，让它拿到焦点（就是用户手点的路径） */
    const clickAt = await page.evaluate(() => {
      const r = document.getElementById('cinput').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await page.mouse.click(clickAt.x, clickAt.y);
    await page.waitForTimeout(250);
    out.focusAfterClick = await page.evaluate(() => {
      const ae = document.activeElement;
      return { tag: ae && ae.tagName, isInput: !!(ae && ae.id === 'cinput') };
    });

    /* ② 真实按键：敲两个字符、退格、回车、上箭头 */
    await clearSent(page);
    await page.keyboard.type('a');
    await page.waitForTimeout(150);
    out.pressA = { sent: await readSent(page), input: await readInput(page) };

    await clearSent(page);
    await page.keyboard.type('bc');
    await page.waitForTimeout(200);
    out.pressBc = { sent: await readSent(page), input: await readInput(page) };

    await clearSent(page);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);
    out.backspace = { sent: await readSent(page), sentCodes: await readSentCodes(page), input: await readInput(page) };

    await clearSent(page);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(150);
    out.arrowUp = { sent: await readSent(page), input: await readInput(page) };

    await clearSent(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    out.enter = { sent: await readSent(page), sentCodes: await readSentCodes(page), input: await readInput(page) };

    /* ③ 中文输入法的组合上屏（只能合成模拟：先 input（组合中不给发）→ compositionend 补发一次并清空） */
    out.composition = await page.evaluate(async () => {
      const ta = document.getElementById('cinput');
      ta.focus();
      window.__sent.length = 0;
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      ta.value = '你好';
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      const sentDuringComposition = window.__sent.slice();
      ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你好' }));
      await new Promise((r) => setTimeout(r, 120));
      return { sentDuringComposition, sentAfterCommit: window.__sent.slice(), inputAfterCommit: ta.value };
    });

    /* ④ 攒着模式：敲字不发送、留在框里；点发送才整行走 */
    await page.evaluate(async () => { await HP.App.setPref('liveComposer', false, { apply: false }); });
    await clearSent(page);
    await page.evaluate(() => { document.getElementById('cinput').value = ''; });
    await page.evaluate(() => document.getElementById('cinput').focus());
    await page.keyboard.type('mk');
    await page.waitForTimeout(200);
    out.batchTyping = { sent: await readSent(page), input: await readInput(page) };
    await page.evaluate(() => HP.App.sendComposer());
    await page.waitForTimeout(200);
    out.batchSendClick = { sent: await readSent(page), input: await readInput(page) };

    /* ⑤ 终端输出不许落进输入框 */
    out.outputNotInInput = await page.evaluate(async () => {
      const before = document.getElementById('cinput').value;
      HP.App.onData({ data: HP.b64encode(HP.enc.encode('远端输出一行\r\n')), seq: 201 });   // 走真入口（原生事件那条路）
      await new Promise((r) => setTimeout(r, 100));
      return { before, after: document.getElementById('cinput').value };
    });

    /* ⑥ 切模式不清掉框里已有的字（用户手误切模式不该丢草稿） */
    out.modeSwitchKeepsDraft = await page.evaluate(async () => {
      const c = document.getElementById('cinput');
      c.value = '草稿ABC';
      await HP.App.setPref('liveComposer', true, { apply: false });
      const afterLive = c.value;
      await HP.App.setPref('liveComposer', false, { apply: false });
      return { afterLive, afterBatch: c.value };
    });

    const asJson = (arr) => JSON.stringify(arr);

    /* ③ 键条上的「⏎」是**用户显式要回车**的那条路 —— 它必须还能发出 0x0d（'\r'）。
     * 为什么要单测：我们把"自动补回车"取消了，回车就只能靠这个键；它要是也发不出去，用户就没法提交了。 */
    out.keybarEnter = await page.evaluate(async () => {
      window.__sent.length = 0;
      const btn = [...document.querySelectorAll('#keybar button')].find((b) => b.textContent.trim() === '⏎');
      if (!btn) return { found: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
      return { found: true, sent: window.__sent.slice(), codes: window.__sent.map((s) => [...s].map((c) => c.charCodeAt(0))) };
    });
    out.conclusion = {
      focusAfterClickIsInput: out.focusAfterClick.isInput === true,
      livePressASentAtOnceAndBoxEmpty: asJson(out.pressA.sent) === '["a"]' && out.pressA.input === '',
      liveTwoCharsSentOneByOne: asJson(out.pressBc.sent) === '["b","c"]' && out.pressBc.input === '',
      liveBackspaceSendsDel: JSON.stringify(out.backspace.sentCodes) === '[[127]]' && out.backspace.input === '',
      liveArrowUpSendsEscapeSequence: asJson(out.arrowUp.sent) === '["\\u001b[A"]' && out.arrowUp.input === '',
      liveEnterSendsSingleCr: JSON.stringify(out.enter.sentCodes) === '[[13]]' && out.enter.input === '',
      imeCompositionSendsNothing: asJson(out.composition.sentDuringComposition) === '[]',
      imeCommitSendsOnceAndClearsBox: asJson(out.composition.sentAfterCommit) === asJson([CJK_TEXT]) && out.composition.inputAfterCommit === '',
      batchTypingSendsNothingAndStaysInBox: asJson(out.batchTyping.sent) === '[]' && out.batchTyping.input === 'mk',
      /* 用户要求：**不自动补回车** —— 「写入」只把内容送进终端；要回车请点功能键条上的「⏎」 */
      batchSendClickSendsTextWithoutEnter: out.batchSendClick.sent.length === 1 &&
        out.batchSendClick.sent[0] === 'mk' && out.batchSendClick.input === '',
      batchSendClickAddsNoCarriageReturn: out.batchSendClick.sent[0].indexOf(String.fromCharCode(13)) < 0 &&
        out.batchSendClick.sent[0].indexOf(String.fromCharCode(10)) < 0,
      terminalOutputNeverLandsInBox: out.outputNotInInput.after === out.outputNotInInput.before,
      keybarEnterStillSendsCarriageReturn: out.keybarEnter.found === true && JSON.stringify(out.keybarEnter.codes) === '[[13]]',
      modeSwitchKeepsDraft: out.modeSwitchKeepsDraft.afterLive === '草稿ABC' && out.modeSwitchKeepsDraft.afterBatch === '草稿ABC'
    };
    return out;
  }
};
