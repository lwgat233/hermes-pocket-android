export default {
  name: 'debug: 驱动里的中文字面量',
  check: async (page) => {
    const 直接 = await page.evaluate(() => '新加的一行');
    const 变量 = await page.evaluate(() => { const s = '新加的一行'; return s; });
    const 追加 = await page.evaluate(() => {
      const ta = document.createElement('textarea');
      document.body.appendChild(ta);
      ta.value = '甲';
      ta.value = ta.value + '新加的一行';
      const v = ta.value;
      ta.remove();
      return v;
    });
    return { 直接, 变量, 追加, 直接对不对: 直接 === '新加的一行', 追加对不对: 追加 === '甲新加的一行' };
  }
};
