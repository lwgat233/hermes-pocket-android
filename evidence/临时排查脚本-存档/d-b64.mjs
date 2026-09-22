export default {
  name: 'debug: b64 往返与编辑框',
  check: async (page) => {
    const r = await page.evaluate(() => {
      const s = '新加的一行\n';
      const enc = HP.Remote.b64enc(s);
      const dec = HP.Remote.b64dec(enc);
      const 带中文 = '正文一行（中文）/ emoji ✅\n第二行\n';
      return {
        '单句原文': s,
        '编码': enc,
        '解回': dec,
        '同': dec === s,
        '长串同': HP.Remote.b64dec(HP.Remote.b64enc(带中文)) === 带中文,
        '类型': typeof HP.Remote.b64enc,
        '源码': String(HP.Remote.b64enc).slice(0, 260)
      };
    });
    return r;
  }
};
