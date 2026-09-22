export default {
  name: 'debug: 网络栏目',
  check: async (page) => {
    const 错误 = [];
    page.on('pageerror', (e) => 错误.push(String(e.message).slice(0, 200)));
    await page.evaluate(() => {
      HP.App.sessionId = 's1'; HP.App.state = 'connected';
      HP.App.host = { id: 'h1', host: '192.168.1.10', port: 22 };
      HP.App.openBoard('net');
    });
    await page.waitForTimeout(1200);
    return page.evaluate((错误) => {
      const el = document.getElementById('tab-net');
      return {
        '有HP_Net': typeof HP.Net,
        '有netjs方法': HP.Net ? Object.keys(HP.Net) : null,
        '列_Net': HP.Registry.boards.length,
        'net登记': HP.Registry.get('net'),
        '标签on': el ? el.classList.contains('on') : null,
        HTMLLength: el ? el.innerHTML.length : null,
        'HTML头': el ? el.innerHTML.slice(0, 300) : null,
        testids: el ? [...el.querySelectorAll('[data-testid]')].map((r) => r.dataset.testid) : null,
        '自检': HP.Registry.check(),
        错误
      };
    }, 错误);
  }
};
